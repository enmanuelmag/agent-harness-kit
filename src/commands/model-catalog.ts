import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

export interface CursorModel {
  id: string
  label: string
}

export interface CursorModelGroup {
  id: string
  label: string
  models: CursorModel[]
}

export interface CodexModel {
  id: string
  label: string
  supportedReasoningEfforts: string[]
  defaultReasoningEffort?: string
}

export interface CodexModelPage {
  data: CodexModel[]
  nextCursor?: string | null
}

export type CatalogResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string }

export type CommandRunner = (command: string, args: string[]) => Promise<{ stdout: string }>

/** Manual values are written into YAML/TOML agent files. Restrict them to the
 * model-token syntax accepted by the provider CLIs instead of relying on those
 * serializers to escape user-controlled frontmatter. */
export function validateManualModelId(value: string): string | undefined {
  return /^[A-Za-z0-9][A-Za-z0-9._/\-[\],=]*$/.test(value)
    ? undefined
    : 'Model IDs may contain only letters, numbers, dot, dash, underscore, slash, brackets, comma, and equals.'
}

export function validateManualReasoningEffort(value: string): string | undefined {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)
    ? undefined
    : 'Reasoning effort may contain only letters, numbers, dot, dash, and underscore.'
}

export function codexInitializedNotification(): { method: 'initialized'; params: Record<string, never> } {
  return { method: 'initialized', params: {} }
}

export function parseCursorModels(output: string): CursorModel[] {
  const models = output
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*([^\s-][^\s]*?)\s+-\s+(.+?)\s*$/))
    .filter((match): match is RegExpMatchArray => match !== null)
    .map((match) => ({ id: match[1], label: match[2] }))

  const seen = new Set<string>()
  return models
    .filter(({ id }) => {
      if (seen.has(id)) return false
      seen.add(id)
      return true
    })
    .sort((left, right) => compareCursorModels(left.id, right.id))
}

const CURSOR_MODEL_FAMILIES: Omit<CursorModelGroup, 'models'>[] = [
  { id: 'openai', label: 'OpenAI' },
  { id: 'claude', label: 'Claude' },
  { id: 'grok', label: 'Grok' },
  { id: 'gemini', label: 'Gemini' },
  { id: 'composer', label: 'Composer' },
  { id: 'muse', label: 'Muse' },
  { id: 'kimi', label: 'Kimi' },
  { id: 'glm', label: 'GLM' },
]

/** Groups the live Cursor catalog for a compact, two-step picker. `auto` is
 * deliberately excluded: it is a special selection, not a model provider. */
export function groupCursorModels(models: CursorModel[]): CursorModelGroup[] {
  const grouped = new Map(CURSOR_MODEL_FAMILIES.map((family) => [family.id, [] as CursorModel[]]))
  const others: CursorModel[] = []

  for (const model of models) {
    if (model.id === 'auto') continue
    const familyId = cursorModelFamilyId(model.id)
    if (familyId) grouped.get(familyId)!.push(model)
    else others.push(model)
  }

  const knownGroups = CURSOR_MODEL_FAMILIES.flatMap((family) => {
    const familyModels = grouped.get(family.id)!
    return familyModels.length === 0 ? [] : [{ ...family, models: familyModels.sort(compareCursorModel) }]
  })

  return others.length === 0
    ? knownGroups
    : [...knownGroups, { id: 'others', label: 'Others', models: others.sort(compareCursorModel) }]
}

/** Keep the interactive Cursor picker useful when an account exposes many
 * provider families. Provider discovery stays dynamic; this only presents the
 * exact IDs in the requested, stable family order. */
function compareCursorModels(left: string, right: string): number {
  const familyDifference = cursorModelFamilyRank(left) - cursorModelFamilyRank(right)
  if (familyDifference !== 0) return familyDifference

  return compareCursorModel({ id: left, label: '' }, { id: right, label: '' })
}

function compareCursorModel(left: CursorModel, right: CursorModel): number {
  return left.id.localeCompare(right.id, undefined, { sensitivity: 'base' }) || left.id.localeCompare(right.id)
}

function cursorModelFamilyRank(id: string): number {
  const familyId = cursorModelFamilyId(id)
  if (familyId === 'openai') return 0
  if (familyId === 'claude') return 1
  if (familyId === 'grok') return 2
  return 3
}

function cursorModelFamilyId(id: string): string | undefined {
  const normalized = id.toLowerCase()
  if (normalized.startsWith('gpt-') || normalized.startsWith('openai-')) return 'openai'
  if (normalized.startsWith('claude-')) return 'claude'
  if (normalized.startsWith('grok-') || normalized.startsWith('cursor-grok-')) return 'grok'
  if (normalized.startsWith('gemini-')) return 'gemini'
  if (normalized.startsWith('composer-')) return 'composer'
  if (normalized.startsWith('muse-')) return 'muse'
  if (normalized.startsWith('kimi-')) return 'kimi'
  if (normalized.startsWith('glm-')) return 'glm'
  return undefined
}

export async function discoverCursorModels(
  run: CommandRunner = runCommand
): Promise<CatalogResult<CursorModel[]>> {
  try {
    const { stdout } = await run('agent', ['models'])
    const models = parseCursorModels(stdout)
    if (models.length === 0) throw new Error('Cursor returned no parseable models.')
    return { ok: true, data: models }
  } catch (error) {
    return { ok: false, error: errorMessage(error) }
  }
}

/** Collect every App Server page. Exported separately so pagination and response
 * validation are testable without starting the user's Codex CLI. */
export async function collectCodexModels(
  request: (method: 'model/list', params: { cursor?: string }) => Promise<unknown>
): Promise<CodexModel[]> {
  const models: CodexModel[] = []
  let cursor: string | undefined
  const seenCursors = new Set<string>()

  do {
    const page = parseCodexModelPage(await request('model/list', cursor ? { cursor } : {}))
    models.push(...page.data)
    cursor = page.nextCursor ?? undefined
    if (cursor && seenCursors.has(cursor)) {
      throw new Error('Codex App Server returned a repeated model-list cursor.')
    }
    if (cursor) seenCursors.add(cursor)
  } while (cursor)

  if (models.length === 0) throw new Error('Codex App Server returned no models.')
  return models
}

export async function discoverCodexModels(): Promise<CatalogResult<CodexModel[]>> {
  let transport: JsonRpcTransport | undefined
  try {
    transport = await createCodexTransport()
    return { ok: true, data: await collectCodexModels((method, params) => transport!.request(method, params)) }
  } catch (error) {
    return { ok: false, error: errorMessage(error) }
  } finally {
    transport?.close()
  }
}

function parseCodexModelPage(value: unknown): CodexModelPage {
  if (!isRecord(value) || !Array.isArray(value.data)) {
    throw new Error('Codex App Server returned an invalid model/list response.')
  }

  const data = value.data.map((item): CodexModel => {
    if (!isRecord(item) || typeof item.model !== 'string' || !Array.isArray(item.supportedReasoningEfforts)) {
      throw new Error('Codex App Server returned an invalid model entry.')
    }
    const supportedReasoningEfforts = item.supportedReasoningEfforts.flatMap((effort) =>
      isRecord(effort) && typeof effort.reasoningEffort === 'string' ? [effort.reasoningEffort] : []
    )
    if (supportedReasoningEfforts.length !== item.supportedReasoningEfforts.length) {
      throw new Error('Codex App Server returned an invalid reasoning-effort option.')
    }
    return {
      id: item.model,
      label: typeof item.displayName === 'string' ? item.displayName : item.model,
      supportedReasoningEfforts,
      defaultReasoningEffort:
        typeof item.defaultReasoningEffort === 'string' ? item.defaultReasoningEffort : undefined,
    }
  })

  if (value.nextCursor !== undefined && value.nextCursor !== null && typeof value.nextCursor !== 'string') {
    throw new Error('Codex App Server returned an invalid model-list cursor.')
  }
  return { data, nextCursor: value.nextCursor as string | null | undefined }
}

async function runCommand(command: string, args: string[]): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (data: Buffer) => (stdout += data))
    child.stderr.on('data', (data: Buffer) => (stderr += data))
    child.once('error', reject)
    child.once('close', (code) => {
      if (code === 0) resolve({ stdout })
      else reject(new Error(stderr.trim() || `${command} exited with code ${code ?? 'unknown'}.`))
    })
  })
}

interface JsonRpcTransport {
  request(method: string, params: Record<string, unknown>): Promise<unknown>
  close(): void
}

async function createCodexTransport(): Promise<JsonRpcTransport> {
  const child = spawn('codex', ['app-server', '--stdio'], { stdio: ['pipe', 'pipe', 'pipe'] })
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (reason: Error) => void }>()
  let nextId = 1
  let closed = false
  let startupError = ''
  let terminalError: Error | undefined

  const failAll = (error: Error) => {
    terminalError = error
    for (const { reject } of pending.values()) reject(error)
    pending.clear()
  }
  child.stderr.on('data', (data: Buffer) => (startupError += data))
  child.once('error', (error) => failAll(error))
  child.once('close', (code) => {
    if (!closed) failAll(new Error(startupError.trim() || `codex app-server exited with code ${code ?? 'unknown'}.`))
  })

  const lines = createInterface({ input: child.stdout })
  lines.on('line', (line) => {
    try {
      const message = JSON.parse(line) as { id?: number; result?: unknown; error?: { message?: string } }
      if (typeof message.id !== 'number') return // Server notifications are expected.
      const call = pending.get(message.id)
      if (!call) return
      pending.delete(message.id)
      if (message.error) call.reject(new Error(message.error.message || 'Codex App Server request failed.'))
      else call.resolve(message.result)
    } catch {
      failAll(new Error('Codex App Server emitted invalid JSON.'))
    }
  })

  const request = (method: string, params: Record<string, unknown>): Promise<unknown> =>
    new Promise((resolve, reject) => {
      if (closed || child.stdin.destroyed || terminalError) {
        reject(terminalError ?? new Error('Codex App Server is not available.'))
        return
      }
      const id = nextId++
      pending.set(id, { resolve, reject })
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`, (error) => {
        if (!error) return
        pending.delete(id)
        reject(error)
      })
    })

  const notify = (method: string, params: Record<string, unknown>): Promise<void> =>
    new Promise((resolve, reject) => {
      if (closed || child.stdin.destroyed || terminalError) {
        reject(terminalError ?? new Error('Codex App Server is not available.'))
        return
      }
      child.stdin.write(`${JSON.stringify({ method, params })}\n`, (error) => {
        if (error) reject(error)
        else resolve()
      })
    })

  const close = () => {
    closed = true
    lines.close()
    child.stdin.end()
    if (!child.killed) child.kill()
    failAll(new Error('Codex App Server connection closed.'))
  }
  try {
    await request('initialize', { clientInfo: { name: 'agent-harness-kit', version: '2.14.0' } })
    // App Server requires this JSON-RPC lifecycle notification before requests
    // such as model/list. It has no id and therefore receives no response.
    const initialized = codexInitializedNotification()
    await notify(initialized.method, initialized.params)
  } catch (error) {
    close()
    throw error
  }
  return {
    request,
    close,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
