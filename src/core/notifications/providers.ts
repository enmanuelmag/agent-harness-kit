import { randomUUID } from 'node:crypto'

export type NotificationProvider = 'cursor' | 'claude-code' | 'codex-cli' | 'opencode' | 'opencode-v2'
export type HookAction =
  | {
      type: 'bind'
      provider: NotificationProvider
      session: string
      turn: string
      response: unknown
    }
  | {
      type: 'complete' | 'attention'
      provider: NotificationProvider
      session?: string
      turn?: string
      requestId: string
    }

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
const id = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 && value.length <= 256 ? value : undefined
function json(value: unknown): unknown {
  if (typeof value !== 'string') return value
  if (value.length > 262144) return undefined
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

/** Normalize documented host fields only. Missing true turn identity never binds. */
export function normalizeProviderHook(
  provider: NotificationProvider,
  event: string,
  payload: unknown
): HookAction[] {
  const p = record(payload)
  const secondary = Boolean(
    p.agent_id || p.subagent_id || p.is_subagent === true || p.background_task_id
  )
  const session = id(provider === 'cursor' ? p.conversation_id : p.session_id)
  const turn = id(
    provider === 'cursor' ? p.generation_id : provider === 'claude-code' ? p.prompt_id : p.turn_id
  )
  const causeId = id(p.request_id) ?? id(p.tool_use_id) ?? id(p.call_id)
  const requestId = causeId ?? (session && turn ? `${session}:${turn}:${event}` : randomUUID())
  if (provider === 'opencode' || provider === 'opencode-v2') {
    if (event === 'bind' && session && turn)
      return [{ type: 'bind', provider, session, turn, response: p.response }]
    if (event === 'complete' && secondary) return []
    if (event === 'complete' || event === 'attention')
      return [
        {
          type: event,
          provider,
          session,
          turn,
          requestId: event === 'attention' ? (causeId ?? randomUUID()) : requestId,
        },
      ]
    return []
  }
  const toolEvent = provider === 'cursor' ? event === 'afterMCPExecution' : event === 'PostToolUse'
  if (toolEvent) {
    if (!session || !turn) return []
    if (
      provider !== 'cursor' &&
      !(typeof p.tool_name === 'string' && p.tool_name.startsWith('mcp__'))
    )
      return []
    const response = json(provider === 'cursor' ? p.result_json : p.tool_response)
    return response === undefined ? [] : [{ type: 'bind', provider, session, turn, response }]
  }
  if (
    (provider === 'cursor' && event === 'stop' && p.status === 'completed') ||
    (provider !== 'cursor' && event === 'Stop' && !p.error && p.stop_hook_active !== true)
  ) {
    if (secondary) return []
    return [{ type: 'complete', provider, session, turn, requestId }]
  }
  if (
    provider === 'claude-code' &&
    event === 'Notification' &&
    ['permission_prompt', 'idle_prompt', 'elicitation_dialog'].includes(String(p.notification_type))
  ) {
    return [{ type: 'attention', provider, session, turn, requestId: causeId ?? randomUUID() }]
  }
  if (provider === 'codex-cli' && event === 'PermissionRequest')
    return [{ type: 'attention', provider, session, turn, requestId: causeId ?? randomUUID() }]
  return []
}

/** Bounded plugin-local generations; unknown initial busy is intentionally uncorrelated. */
export class OpenCodeTurnTracker {
  private identities = new Map<string, 'main' | 'child'>()
  private states = new Map<string, { status: string; generation?: string; count: number }>()
  constructor(private epoch: string = globalThis.crypto.randomUUID()) {}

  observeSession(info: unknown): void {
    if (!info || typeof info !== 'object' || Array.isArray(info)) return
    const session = info as { id?: unknown; parentID?: unknown; projectID?: unknown; directory?: unknown; title?: unknown; version?: unknown; slug?: unknown; time?: { created?: unknown; updated?: unknown } }
    if (typeof session.id !== 'string' || !session.id || session.id.length > 256) return
    if (![session.projectID, session.directory, session.title, session.version, session.slug].every(value => typeof value === 'string')) return
    if (!session.time || typeof session.time.created !== 'number' || !Number.isFinite(session.time.created) || typeof session.time.updated !== 'number' || !Number.isFinite(session.time.updated)) return
    if (session.parentID !== undefined && (typeof session.parentID !== 'string' || !session.parentID)) return
    this.identities.delete(session.id)
    this.identities.set(session.id, session.parentID === undefined ? 'main' : 'child')
    if (this.identities.size > 64) this.identities.delete(this.identities.keys().next().value!)
  }

  hasSessionInfo(session: string): boolean { return this.identities.has(session) }

  process(event: string, payload: Record<string, unknown>): HookAction[] {
    if (event === 'session.created' || event === 'session.updated') {
      this.observeSession(payload.info)
      return []
    }
    const session = typeof payload.sessionID === 'string' ? payload.sessionID : undefined
    if (!session || session.length > 256) return []
    const previous = this.states.get(session)
    const state = previous ?? { status: 'unknown', count: 0 }
    if (event === 'session.status') {
      const status =
        typeof payload.status === 'string'
          ? payload.status
          : (payload.status as { type?: string } | undefined)?.type
      if (status === 'busy' || status === 'retry') {
        if (state.status === 'idle') state.generation = `${this.epoch}:${++state.count}`
        state.status = status
      } else if (status === 'idle') {
        const completed = state.status === 'busy' || state.status === 'retry'
        const turn = state.generation
        state.status = 'idle'
        state.generation = undefined
        this.save(session, state)
        return completed && this.identities.get(session) === 'main'
          ? [
              {
                type: 'complete',
                provider: 'opencode',
                session,
                turn,
                requestId: turn ?? globalThis.crypto.randomUUID(),
              },
            ]
          : []
      } else return []
      this.save(session, state)
    } else if (event === 'session.error') {
      state.status = 'error'
      state.generation = undefined
      this.save(session, state)
    } else if (event === 'permission.asked') {
      return [
        {
          type: 'attention',
          provider: 'opencode',
          session,
          turn: state.generation,
          requestId: typeof payload.id === 'string' ? payload.id : globalThis.crypto.randomUUID(),
        },
      ]
    } else if (event === 'tool.execute.after' && state.generation) {
      const output = payload.output as { output?: unknown; metadata?: unknown } | undefined
      let response: unknown = output?.metadata
      if (
        !response ||
        typeof response !== 'object' ||
        (!('notificationSchemaVersion' in response) && !('content' in response))
      ) {
        try {
          response =
            typeof output?.output === 'string' && output.output.length <= 262144
              ? JSON.parse(output.output)
              : undefined
        } catch {
          return []
        }
      }
      if (response && typeof response === 'object' && 'notificationSchemaVersion' in response) {
        response = { content: [{ type: 'text', text: JSON.stringify(response) }] }
      }
      if (response !== undefined)
        return [{ type: 'bind', provider: 'opencode', session, turn: state.generation, response }]
    }
    return []
  }

  private save(
    session: string,
    state: { status: string; generation?: string; count: number }
  ): void {
    this.states.delete(session)
    this.states.set(session, state)
    if (this.states.size > 64) this.states.delete(this.states.keys().next().value!)
  }
}
