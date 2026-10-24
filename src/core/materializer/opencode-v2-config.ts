import { randomUUID } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { applyEdits, getNodeValue,modify, parseTree } from 'jsonc-parser'

import { detectPackageManager, getMcpCommandParts } from './detect-package-manager'

import type { HarnessConfig } from '@/types'
import type { Node, ParseError } from 'jsonc-parser'

type ObjectValue = Record<string, unknown>
const object = (value: unknown): value is ObjectValue => !!value && typeof value === 'object' && !Array.isArray(value)
export const OPENCODE_CONFIG_PATHS = ['opencode.json', 'opencode.jsonc', '.opencode/opencode.json', '.opencode/opencode.jsonc'] as const

export function safeOpenCodePath(cwd: string, target: string): string {
  const path = resolve(cwd, target)
  const rel = relative(resolve(cwd), path)
  if (rel === '..' || rel.startsWith('../') || rel.startsWith('..\\')) throw new Error(`OpenCode path outside project: ${path}`)
  let current = resolve(cwd)
  for (const part of ['', ...rel.split(/[\\/]/).filter(Boolean)]) {
    if (part) current = join(current, part)
    try { if (lstatSync(current).isSymbolicLink()) throw new Error(`Refusing symlinked OpenCode path: ${current}`) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  return path
}
function rejectDuplicates(node: Node): void {
  if (node.type === 'object') {
    const names = new Set<string>()
    for (const property of node.children ?? []) {
      const name = String(property.children?.[0].value)
      if (names.has(name)) throw new Error(`Duplicate OpenCode configuration key: ${name}`)
      names.add(name)
    }
  }
  for (const child of node.children ?? []) rejectDuplicates(child)
}
export function parseOpenCodeConfig(text: string, path: string): ObjectValue {
  const errors: ParseError[] = []
  const tree = parseTree(text, errors, { allowTrailingComma: true, disallowComments: false })
  if (errors.length || !tree || tree.type !== 'object') throw new Error(`Invalid OpenCode JSON/JSONC configuration: ${path}`)
  rejectDuplicates(tree)
  const value = getNodeValue(tree) as ObjectValue
  if (value.mcp !== undefined && !object(value.mcp)) throw new Error(`Invalid mcp object: ${path}`)
  const mcp = value.mcp as ObjectValue | undefined
  if (mcp?.servers !== undefined && !object(mcp.servers)) throw new Error(`Invalid mcp.servers object: ${path}`)
  if (value.permissions !== undefined && (!Array.isArray(value.permissions) || !value.permissions.every(rule => object(rule) && ['action', 'resource', 'effect'].every(k => typeof rule[k] === 'string') && ['allow', 'ask', 'deny'].includes(String(rule.effect))))) throw new Error(`Invalid permissions rules: ${path}`)
  return value
}
export function inspectOpenCodeConfig(cwd: string) {
  const files = OPENCODE_CONFIG_PATHS.map(rel => safeOpenCodePath(cwd, rel)).filter(existsSync).map(path => {
    const text = readFileSync(path, 'utf8')
    const value = parseOpenCodeConfig(text, path)
    const mcp = value.mcp as ObjectValue | undefined
    const servers = mcp?.servers as ObjectValue | undefined
    const legacy = mcp?.['agent-harness-kit']
    const native = servers?.['agent-harness-kit']
    if (legacy !== undefined && native !== undefined) throw new Error(`Conflicting v1/v2 AHK MCP entries: ${path}`)
    if ((legacy !== undefined && !object(legacy)) || (native !== undefined && !object(native))) throw new Error(`Invalid AHK MCP entry: ${path}`)
    return { path, text, value, legacy: legacy as ObjectValue | undefined, native: native as ObjectValue | undefined }
  })
  const managed = files.filter(file => file.legacy || file.native)
  if (managed.length > 1 || (!managed.length && files.length > 1)) throw new Error('Ambiguous OpenCode configuration locations; consolidate the AHK entry before generation.')
  return managed[0] ?? files[0] ?? { path: safeOpenCodePath(cwd, 'opencode.json'), text: '{}\n', value: {} as ObjectValue, legacy: undefined, native: undefined }
}
export function prepareOpenCodeV2Config(cwd: string, config: HarnessConfig, migrateV1 = false) {
  const current = inspectOpenCodeConfig(cwd)
  let text = current.text
  const edit = (path: (string | number)[], value: unknown) => { text = applyEdits(text, modify(text, path, value, { formattingOptions: { insertSpaces: true, tabSize: 2, eol: '\n' } })) }
  const command = getMcpCommandParts(detectPackageManager(cwd), config.tools.mcp.port, cwd)
  if (current.legacy) {
    const expected = { enabled: true, type: 'local', command }
    if (!migrateV1 || JSON.stringify(current.legacy) !== JSON.stringify(expected)) throw new Error('Existing v1 AHK MCP configuration requires an explicit migration of recognized generated content; customized entries are preserved.')
    edit(['mcp', 'agent-harness-kit'], undefined)
  }
  if (current.native && (current.native.type !== 'local' || (!Array.isArray(current.native.command) || !current.native.command.length || !current.native.command.every(part => typeof part === 'string' && part.length > 0)))) throw new Error('Customized AHK MCP transport conflicts with generated local stdio transport.')
  if (current.value.$schema === undefined) edit(['$schema'], 'https://opencode.ai/config.json')
  if (current.value.default_agent === undefined || current.value.default_agent === 'lead') edit(['default_agent'], 'lead')
  if (current.value.compaction === undefined) edit(['compaction'], { auto: true, buffer: 10000 })
  else if (migrateV1 && JSON.stringify(current.value.compaction) === JSON.stringify({ auto: true, prune: true, reserved: 10000 })) {
    edit(['compaction', 'prune'], undefined); edit(['compaction', 'reserved'], undefined); edit(['compaction', 'buffer'], 10000)
  }
  if (current.value.permissions === undefined && (current.value.permission === undefined || (migrateV1 && JSON.stringify(current.value.permission) === JSON.stringify({ write: 'ask' })))) {
    if (current.value.permission !== undefined) edit(['permission'], undefined)
    edit(['permissions'], [{ action: 'edit', resource: '*', effect: 'ask' }, { action: 'external_directory', resource: '*', effect: 'ask' }])
  }
  const server = { type: 'local', command, disabled: false, codemode: false }
  if (!current.native) edit(['mcp', 'servers', 'agent-harness-kit'], server)
  else for (const [key, value] of Object.entries(server)) if (current.native[key] === undefined) edit(['mcp', 'servers', 'agent-harness-kit', key], value)
  parseOpenCodeConfig(text, current.path)
  return { ...current, next: text.endsWith('\n') ? text : `${text}\n` }
}
export function writeOpenCodeV2Config(prepared: ReturnType<typeof prepareOpenCodeV2Config>) {
  if (existsSync(prepared.path) && readFileSync(prepared.path, 'utf8') !== prepared.text) throw new Error('OpenCode configuration changed after preparation; no overwrite performed.')
  if (existsSync(prepared.path) && prepared.next === prepared.text) return
  mkdirSync(dirname(prepared.path), { recursive: true })
  const temporary = `${prepared.path}.${randomUUID()}.tmp`
  writeFileSync(temporary, prepared.next, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  renameSync(temporary, prepared.path)
}
