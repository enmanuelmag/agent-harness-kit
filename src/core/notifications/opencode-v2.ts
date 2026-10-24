import type { HookAction } from './providers'

/** Normalize public OpenCode 2.1 events; a durable execution start is the turn identity. */
export class OpenCodeV2TurnTracker {
  private sessions = new Map<string, { child: boolean; directory: string }>()
  private turns = new Map<string, string>()
  constructor(private directory: string) {}
  hasSessionInfo(session: string) { return this.sessions.has(session) }
  observeSession(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return
    const info = value as { id?: unknown; sessionID?: unknown; parentID?: unknown; location?: { directory?: unknown } }
    const session = info.id ?? info.sessionID
    if (typeof session !== 'string' || !session || session.length > 256 || typeof info.location?.directory !== 'string') return
    if (info.location.directory !== this.directory) return
    if (info.parentID !== undefined && (typeof info.parentID !== 'string' || !info.parentID)) return
    this.sessions.delete(session)
    this.sessions.set(session, { child: info.parentID !== undefined, directory: info.location.directory })
    if (this.sessions.size > 64) { const oldest = this.sessions.keys().next().value!; this.sessions.delete(oldest); this.turns.delete(oldest) }
  }
  process(event: { id?: unknown; type?: unknown; location?: { directory?: unknown }; data?: unknown }): HookAction[] {
    if (!event.data || typeof event.data !== 'object' || Array.isArray(event.data)) return []
    const data = event.data as Record<string, unknown>
    const session = data.sessionID
    if (typeof session !== 'string' || !session || session.length > 256) return []
    if (event.location?.directory && event.location.directory !== this.directory) return []
    if (event.type === 'session.created') { this.observeSession({ ...data, location: data.location ?? event.location }); return [] }
    if (event.type === 'session.execution.started') {
      if (typeof event.id !== 'string' || !event.id || event.id.length > 256) return []
      this.turns.delete(session); this.turns.set(session, event.id)
      if (this.turns.size > 64) this.turns.delete(this.turns.keys().next().value!)
      return []
    }
    if (event.type === 'session.execution.failed' || event.type === 'session.execution.interrupted') { this.turns.delete(session); return [] }
    const turn = this.turns.get(session)
    if (event.type === 'session.execution.succeeded') {
      this.turns.delete(session)
      return turn && this.sessions.get(session)?.child === false ? [{ type: 'complete', provider: 'opencode-v2', session, turn, requestId: turn }] : []
    }
    if (event.type === 'permission.asked' && this.sessions.get(session)?.child === false && typeof data.id === 'string') return [{ type: 'attention', provider: 'opencode-v2', session, turn, requestId: data.id }]
    return []
  }
  tool(value: unknown): HookAction[] {
    if (!value || typeof value !== 'object') return []
    const event = value as { sessionID?: unknown; tool?: unknown; status?: unknown; result?: { output?: unknown; content?: unknown; metadata?: unknown } }
    if (typeof event.sessionID !== 'string' || event.status !== 'completed' || typeof event.tool !== 'string' || !event.tool.startsWith('agent-harness-kit_')) return []
    const turn = this.turns.get(event.sessionID)
    if (!turn || this.sessions.get(event.sessionID)?.child !== false) return []
    const result = event.result
    let response: unknown
    for (const candidate of [result?.output, result?.metadata]) {
      if (candidate && typeof candidate === 'object' && ('content' in candidate || 'notificationSchemaVersion' in candidate)) { response = candidate; break }
    }
    if (response === undefined && Array.isArray(result?.content)) response = { content: result.content }
    if (response === undefined && typeof result?.content === 'string' && result.content.length <= 262144) {
      try { const parsed = JSON.parse(result.content); if (parsed && typeof parsed === 'object' && ('content' in parsed || 'notificationSchemaVersion' in parsed)) response = parsed } catch { return [] }
    }
    if (response && typeof response === 'object' && 'notificationSchemaVersion' in response) response = { content: [{ type: 'text', text: JSON.stringify(response) }] }
    return response === undefined ? [] : [{ type: 'bind', provider: 'opencode-v2', session: event.sessionID, turn, response }]
  }
}

export function renderOpenCodeV2Plugin(runtime: { node: string; cli: string }, cwd: string): string {
  return `// Agent Harness Kit OpenCode V2 notification adapter. SHA-256 ownership.\nimport { Plugin } from '@opencode/plugin';\nimport { spawn } from 'node:child_process';\nconst __name = (value, name) => Object.defineProperty(value, 'name', {value:name,configurable:true});\nconst Tracker = ${OpenCodeV2TurnTracker.toString()};\nexport default Plugin.define({id:'ahk.notifications.v2',async setup(ctx){\n const tracker=new Tracker(${JSON.stringify(cwd)});const controller=new AbortController();const children=new Set();const queues=new Map();const lookups=new Set();let queued=0;let closed=false;\n const enqueue=(session,work)=>{if(closed||typeof session!=='string'||session.length>256||queued>=128||(!queues.has(session)&&queues.size>=64))return Promise.resolve();const previous=queues.get(session)??Promise.resolve();queued++;const pending=previous.catch(()=>{}).then(work).catch(()=>{}).finally(()=>{queued--;if(queues.get(session)===pending)queues.delete(session)});queues.set(session,pending);return pending};\n const classify=async session=>{if(closed||tracker.hasSessionInfo(session)||lookups.has(session)||lookups.size>=64)return;lookups.add(session);let timer;try{const request=Promise.resolve().then(()=>ctx.session.get({sessionID:session},{signal:controller.signal})).catch(()=>undefined).finally(()=>lookups.delete(session));const info=await Promise.race([request,new Promise(resolve=>{timer=setTimeout(()=>resolve(undefined),200)})]);if(info)tracker.observeSession(info)}catch{}finally{clearTimeout(timer)}};\n const send=action=>new Promise(resolve=>{if(closed)return resolve();const payload=JSON.stringify({session_id:action.session,turn_id:action.turn,request_id:action.requestId,response:action.response});if(payload.length>262144)return resolve();const child=spawn(${JSON.stringify(runtime.node)},[${JSON.stringify(runtime.cli)},'notifications','hook','--provider','opencode-v2','--event',action.type],{cwd:${JSON.stringify(cwd)},stdio:['pipe','ignore','ignore'],shell:false});children.add(child);const timer=setTimeout(()=>{child.kill();resolve()},4000);timer.unref();const finish=()=>{clearTimeout(timer);children.delete(child);resolve()};child.on('error',finish);child.on('close',finish);child.stdin.on('error',()=>{});child.stdin.end(payload)});\n await ctx.tool.hook('execute.after',event=>enqueue(event.sessionID,async()=>{await classify(event.sessionID);for(const action of tracker.tool(event))await send(action)}));\n void(async()=>{try{for await(const event of ctx.event.subscribe({signal:controller.signal})){if(closed)break;const session=event.data?.sessionID;if(typeof session!=='string')continue;await enqueue(session,async()=>{if(event.type==='session.execution.succeeded'||event.type==='permission.asked')await classify(session);for(const action of tracker.process(event))await send(action)})}}catch{}})();\n return()=>{closed=true;controller.abort();for(const child of children)child.kill();children.clear();queues.clear();lookups.clear()};\n}});\n`
}
