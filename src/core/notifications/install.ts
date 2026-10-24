import { createHash } from 'node:crypto'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import { safeOpenCodePath } from '../materializer/opencode-v2-config'
import { type BoundaryFailure, capture, type Result } from '../result'
import { renderOpenCodeV2Plugin } from './opencode-v2'
import { type NotificationProvider, OpenCodeTurnTracker } from './providers'

export interface InstallationInfo {
  provider: NotificationProvider
  files: string[]
  preserved: string[]
  manual: string[]
}
export interface CommandRuntime {
  node: string
  cli: string
}
type Entry = Record<string, unknown>
interface Ownership {
  version: 1
  path: string
  entries?: Record<string, Entry>
  hash?: string
}
const equal = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)
const digest = (text: string): string => createHash('sha256').update(text).digest('hex')
async function optional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}
function object(value: unknown): Entry {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Existing hook configuration must be a JSON object')
  return value as Entry
}
function quote(value: string): string {
  if (/[\r\n\0]/.test(value)) throw new Error('Invalid executable path')
  if (process.platform === 'win32') {
    if (/["%!^&|<>]/.test(value))
      throw new Error('Windows hook executable path requires manual configuration')
    return `"${value}"`
  }
  return `'${value.replaceAll("'", "'\\''")}'`
}
function entries(provider: NotificationProvider, runtime: CommandRuntime): Record<string, Entry> {
  const names =
    provider === 'cursor'
      ? ['afterMCPExecution', 'stop']
      : provider === 'claude-code'
        ? ['PostToolUse', 'Stop', 'Notification']
        : ['PostToolUse', 'Stop', 'PermissionRequest']
  return Object.fromEntries(
    names.map((event) => {
      const command = `${quote(runtime.node)} ${quote(runtime.cli)} notifications hook --provider ${provider} --event ${event}`
      const entry: Entry =
        provider === 'cursor' ? { command } : { hooks: [{ type: 'command', command, timeout: 5 }] }
      if (event === 'PostToolUse') entry.matcher = '^mcp__'
      if (event === 'Notification')
        entry.matcher = 'permission_prompt|idle_prompt|elicitation_dialog'
      return [event, entry]
    })
  )
}
function plugin(runtime: CommandRuntime, cwd: string): string {
  return `// Agent Harness Kit notification plugin. Ownership is verified by SHA-256.\nimport { spawn } from 'node:child_process';\nconst __name = (value, name) => Object.defineProperty(value, "name", {value:name,configurable:true});\nconst Tracker = ${OpenCodeTurnTracker.toString()};\nexport default async function ({client} = {}) {\n const tracker = new Tracker();\n const queues = new Map(); let queued=0;\n const enqueue = (session, work) => {\n  if (typeof session !== 'string' || !session || session.length>256) return Promise.resolve();\n  const previous=queues.get(session);\n  if (queued>=128 || (previous?.count ?? 0)>=16 || (!previous && queues.size>=64)) return Promise.resolve();\n  const entry=previous ?? {count:0,promise:Promise.resolve()}; entry.count++;queued++;queues.set(session,entry);\n  const pending=entry.promise.catch(() => {}).then(work).catch(() => {}).finally(() => {entry.count--;queued--;if(!entry.count)queues.delete(session)});\n  entry.promise=pending;return pending;\n };\n const lookups = new Set();\n const classify = async session => {\n  if (tracker.hasSessionInfo(session) || !client?.session?.get || lookups.has(session) || lookups.size >= 64) return;\n  lookups.add(session); let timer;\n  try {\n   const request = Promise.resolve().then(() => client.session.get({path:{id:session}})).catch(() => undefined).finally(() => lookups.delete(session));\n   const response = await Promise.race([request, new Promise(resolve => {timer=setTimeout(() => resolve(undefined), 200)})]);\n   if (response?.data?.id === session) tracker.observeSession(response.data);\n  } catch {} finally {clearTimeout(timer)}\n };\n const send = action => new Promise(resolve => {\n  const child = spawn(${JSON.stringify(runtime.node)}, [${JSON.stringify(runtime.cli)}, 'notifications', 'hook', '--provider', 'opencode', '--event', action.type], { cwd: ${JSON.stringify(cwd)}, stdio: ['pipe','ignore','ignore'], shell: false });\n  child.on('error', () => resolve()); child.on('close', () => resolve());\n  child.stdin.on('error', () => {}); child.stdin.end(JSON.stringify({session_id:action.session,turn_id:action.turn,request_id:action.requestId,response:action.response}));\n  const timer = setTimeout(() => {child.kill();resolve()}, 4000); timer.unref(); child.on('close', () => clearTimeout(timer));\n });\n return {\n  'tool.execute.after': async (input, output) => enqueue(input.sessionID, async () => { for (const action of tracker.process('tool.execute.after',{...input,output})) await send(action) }),\n  event: async ({event}) => { const properties=event.properties ?? {}; return enqueue(properties.sessionID ?? properties.info?.id, async () => { if(event.type==='session.status' && (properties.status==='idle' || properties.status?.type==='idle') && typeof properties.sessionID==='string') await classify(properties.sessionID); for (const action of tracker.process(event.type,properties)) await send(action) }); }\n };\n}\n`
}

function paths(cwd: string, provider: NotificationProvider): { target: string; manifest: string } {
  const relative =
    provider === 'cursor'
      ? '.cursor/hooks.json'
      : provider === 'claude-code'
        ? '.claude/settings.json'
        : provider === 'codex-cli'
          ? '.codex/hooks.json'
          : provider === 'opencode-v2' ? '.opencode/plugins/ahk-notifications-v2/index.js' : '.opencode/plugins/ahk-notifications.js'
  return {
    target: join(cwd, relative),
    manifest: join(cwd, '.harness', `notifications-hooks-${provider}.json`),
  }
}
const manualNotes = (provider: NotificationProvider): string[] => [
  'Enable notifications explicitly in the project config. Adjust native completion sounds manually; native preferences are unchanged.',
  ...(provider === 'cursor'
    ? ['Cursor has no documented universal attention hook; use explicit attention notifications.']
    : []),
  ...(provider === 'codex-cli'
    ? [
        'Review and trust project hooks using /hooks. Existing inline TOML hooks and feature settings are unchanged; both sources may trigger a startup warning.',
      ]
    : []),
]

export function installNotificationHooks(
  cwd: string,
  provider: NotificationProvider,
  commandRuntime?: CommandRuntime
): Promise<Result<InstallationInfo, BoundaryFailure>> {
  return capture(async () => {
    cwd = resolve(cwd)
    const runtime = commandRuntime ?? { node: process.execPath, cli: resolve(process.argv[1]) }
    const { target, manifest } = paths(cwd, provider)
    const existing = await optional(target)
    const ownedText = await optional(manifest)
    const owned = ownedText ? (JSON.parse(ownedText) as Ownership) : undefined
    if (owned && (owned.version !== 1 || owned.path !== target))
      throw new Error('Incompatible notification hook ownership record')
    const info: InstallationInfo = {
      provider,
      files: [],
      preserved: [],
      manual: manualNotes(provider),
    }
    let nextOwnership: Ownership
    let next: string
    if (provider === 'opencode' || provider === 'opencode-v2') {
      safeOpenCodePath(cwd, target); safeOpenCodePath(cwd, manifest)
      const other = paths(cwd, provider === 'opencode' ? 'opencode-v2' : 'opencode')
      if (await optional(other.target) !== undefined) throw new Error('Conflicting OpenCode notification plugin: uninstall the other version using its ownership manifest before installing this provider.')
      next = provider === 'opencode-v2' ? renderOpenCodeV2Plugin(runtime, cwd) : plugin(runtime, cwd)
      if (existing !== undefined && (!owned?.hash || digest(existing) !== owned.hash)) {
        info.preserved.push(target)
        return info
      }
      nextOwnership = { version: 1, path: target, hash: digest(next) }
    } else {
      const config = existing === undefined ? {} : object(JSON.parse(existing))
      const hooks = config.hooks === undefined ? {} : object(config.hooks)
      const added: Record<string, Entry> = {}
      for (const [event, entry] of Object.entries(entries(provider, runtime))) {
        if (hooks[event] !== undefined && !Array.isArray(hooks[event]))
          throw new Error(`Existing ${event} hooks must be an array`)
        const list = (hooks[event] as unknown[] | undefined) ?? []
        const previous = owned?.entries?.[event]
        const oldIndex = previous ? list.findIndex((item) => equal(item, previous)) : -1
        if (oldIndex >= 0) {
          list[oldIndex] = entry
          added[event] = entry
        } else if (previous) {
          info.preserved.push(`${target}:${event}`)
          added[event] = previous
        } else {
          list.push(entry)
          added[event] = entry
        }
        hooks[event] = list
      }
      config.hooks = hooks
      if (provider === 'cursor' && config.version === undefined) config.version = 1
      next = `${JSON.stringify(config, null, 2)}\n`
      nextOwnership = { version: 1, path: target, entries: added }
    }
    await mkdir(dirname(target), { recursive: true })
    await mkdir(dirname(manifest), { recursive: true })
    await writeFile(target, next, 'utf8')
    await writeFile(manifest, `${JSON.stringify(nextOwnership, null, 2)}\n`, 'utf8')
    info.files.push(target, manifest)
    return info
  }, 'install notification hooks')
}

export function uninstallNotificationHooks(
  cwd: string,
  provider: NotificationProvider
): Promise<Result<InstallationInfo, BoundaryFailure>> {
  return capture(async () => {
    cwd = resolve(cwd)
    const { target, manifest } = paths(cwd, provider)
    if (provider === 'opencode' || provider === 'opencode-v2') { safeOpenCodePath(cwd, target); safeOpenCodePath(cwd, manifest) }
    const info: InstallationInfo = {
      provider,
      files: [],
      preserved: [],
      manual: manualNotes(provider),
    }
    const ownedText = await optional(manifest)
    if (!ownedText) return info
    const owned = JSON.parse(ownedText) as Ownership
    if (owned.version !== 1 || owned.path !== target)
      throw new Error('Incompatible notification hook ownership record')
    const existing = await optional(target)
    if (existing !== undefined && (provider === 'opencode' || provider === 'opencode-v2')) {
      if (owned.hash && digest(existing) === owned.hash) {
        await unlink(target)
        info.files.push(target)
      } else info.preserved.push(target)
    } else if (existing !== undefined) {
      const config = object(JSON.parse(existing))
      const hooks = config.hooks === undefined ? {} : object(config.hooks)
      for (const [event, entry] of Object.entries(owned.entries ?? {})) {
        const list = hooks[event]
        if (!Array.isArray(list)) {
          info.preserved.push(`${target}:${event}`)
          continue
        }
        const index = list.findIndex((item) => equal(item, entry))
        if (index < 0) info.preserved.push(`${target}:${event}`)
        else {
          list.splice(index, 1)
          if (!list.length) delete hooks[event]
        }
      }
      config.hooks = hooks
      await writeFile(target, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
      info.files.push(target)
    }
    if (!info.preserved.length) {
      await unlink(manifest)
      info.files.push(manifest)
    }
    return info
  }, 'uninstall notification hooks')
}

/** Read-only preflight for switching providers sharing auto-discovered plugin paths. */
export async function inspectOpenCodeNotificationPlugin(cwd: string, provider: 'opencode' | 'opencode-v2') {
  const { target, manifest } = paths(resolve(cwd), provider)
  safeOpenCodePath(cwd, target); safeOpenCodePath(cwd, manifest)
  const text = await optional(target)
  if (text === undefined) return { present: false, owned: false }
  const saved = await optional(manifest)
  if (!saved) return { present: true, owned: false }
  try { const owned = JSON.parse(saved) as Ownership; return { present: true, owned: owned.version === 1 && owned.path === target && owned.hash === digest(text) } }
  catch { return { present: true, owned: false } }
}
