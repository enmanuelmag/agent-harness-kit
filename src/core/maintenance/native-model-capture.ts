import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { LEGACY_CODEX_LEAD, nativeAgentFilename, nativeAgentName } from '@/core/materializer/native-agent-path'
import { openCodeV2ChoiceSchema } from '@/schema/opencode-v2'

import type { AgentName } from '@/core/materializer/agent-restrictions'
import type { ClaudeAgentModelChoice, CodexAgentModelChoice, CursorAgentModelChoice, HarnessConfig } from '@/types'


/** Decode supported one-line YAML scalars without treating an adjacent #variant as a comment. */
function openCodeModelScalar(raw: string): string {
  const value = raw.trim()
  if (!value) throw new Error('Empty model scalar')
  if (value.startsWith('"')) {
    const token = value.match(/^"(?:[^"\\]|\\.)*"/)
    if (!token || !/^(?:[ \t]*|[ \t]+#.*)$/.test(value.slice(token[0].length))) throw new Error('Malformed double-quoted model scalar')
    const decoded: unknown = JSON.parse(token[0])
    if (typeof decoded !== 'string') throw new Error('Invalid model scalar')
    return decoded
  }
  if (value.startsWith("'")) {
    let decoded = ''
    for (let index = 1; index < value.length; index++) {
      if (value[index] !== "'") { decoded += value[index]; continue }
      if (value[index + 1] === "'") { decoded += "'"; index++; continue }
      if (!/^(?:[ \t]*|[ \t]+#.*)$/.test(value.slice(index + 1))) throw new Error('Malformed single-quoted model scalar')
      return decoded
    }
    throw new Error('Unterminated model scalar')
  }
  return value.replace(/[ \t]+#.*$/, '').trim()
}

/** Read scalar metadata without interpreting samples inside multiline prompts. */
function codexMetadata(content: string) {
  const root = new Map<string, string[]>()
  const agent = new Map<string, string[]>()
  let table = ''
  let multiline = ''
  let agentTables = 0
  for (const line of content.split(/\r?\n/)) {
    if (multiline) {
      if (line.includes(multiline)) multiline = ''
      continue
    }
    const assignment = line.match(/^\s*([a-z_]+)\s*=\s*(.*)$/)
    if (assignment && (assignment[2].startsWith('"""') || assignment[2].startsWith("'''"))) {
      if (['name', 'model', 'model_reasoning_effort'].includes(assignment[1])) throw new Error('Multiline metadata is unsupported')
      const delimiter = assignment[2].slice(0, 3)
      if (!assignment[2].slice(3).includes(delimiter)) multiline = delimiter
      continue
    }
    const section = line.match(/^\s*\[([^\]]+)\]\s*(?:#.*)?$/)
    if (section) {
      table = section[1]
      if (table === 'agent' && ++agentTables > 1) throw new Error('Duplicate agent table')
      continue
    }
    if (!assignment || !['name', 'model', 'model_reasoning_effort'].includes(assignment[1])) continue
    const target = table === '' ? root : table === 'agent' ? agent : undefined
    if (target) target.set(assignment[1], [...(target.get(assignment[1]) ?? []), assignment[2]])
  }
  if (multiline) throw new Error('Unterminated multiline string')
  return { root, agent }
}

function codexScalar(values: string[] | undefined): string | undefined {
  if (!values) return undefined
  if (values.length !== 1) throw new Error('Duplicate metadata')
  const token = values[0].match(/^("(?:[^"\\]|\\.)*"|'[^']*')\s*(?:#.*)?$/)?.[1]
  if (!token) throw new Error('Malformed metadata')
  return token.startsWith('"') ? JSON.parse(token) as string : token.slice(1, -1)
}

/** Parse only canonical role metadata. Ambiguous or malformed headers are never guessed. */
export function captureNativeChoices(cwd: string, config: HarnessConfig) {
  const choices: Partial<
    Record<AgentName, ClaudeAgentModelChoice | CodexAgentModelChoice | CursorAgentModelChoice>
  > = {}
  const missing: string[] = []
  const roles: AgentName[] = ['lead', 'explorer', 'consultant', 'builder', 'reviewer']
  for (const role of roles) {
    let path =
      config.provider === 'claude-code'
        ? join(cwd, `.claude/agents/${role}.md`)
        : config.provider === 'codex-cli'
          ? join(cwd, `.codex/agents/${nativeAgentFilename(config.provider, role)}`)
          : (config.provider === 'cursor' || config.provider === 'opencode-v2')
            ? join(cwd, `${config.provider === 'cursor' ? '.cursor' : '.opencode'}/agents/${role}.md`)
            : ''
    if (config.provider === 'codex-cli' && role === 'lead' && !existsSync(path)) {
      path = join(cwd, LEGACY_CODEX_LEAD)
    }
    if (!path || !existsSync(path)) {
      missing.push(role)
      continue
    }
    const content = readFileSync(path, 'utf8')
    if (config.provider === 'opencode-v2') {
      const header = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1]
      const models = header?.match(/^model:.*$/gm) ?? []
      if (!header || models.length > 1 || !/^mode: (primary|subagent)\s*$/m.test(header) || !/^permissions:/m.test(header)) { missing.push(role); continue }
      try {
        const raw = models[0]?.replace(/^model:\s*/, '').trim()
        const parsed = openCodeV2ChoiceSchema.safeParse(raw === undefined ? {} : { model: openCodeModelScalar(raw) })
        if (!parsed.success) missing.push(role); else choices[role] = parsed.data
      } catch { missing.push(role) }
    } else if (config.provider === 'codex-cli') {
      try {
        const { root, agent } = codexMetadata(content)
        const flatName = codexScalar(root.get('name'))
        const legacyName = codexScalar(agent.get('name'))
        const expected = path.endsWith('lead.toml') ? role : nativeAgentName(config.provider, role)
        if (flatName !== undefined ? flatName !== expected || legacyName !== undefined : legacyName !== role) {
          throw new Error('Invalid role identity')
        }
        const model = codexScalar(root.get('model'))
        const effort = codexScalar(root.get('model_reasoning_effort'))
        if (model === '' || effort === '') throw new Error('Empty metadata')
        choices[role] = { ...(model ? { model } : {}), ...(effort ? { effort } : {}) }
      } catch { missing.push(role) }
    } else {
      const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
      const header = frontmatter?.[1]
      const name = header
        ?.match(/^name:\s*([^#\r\n]+)\s*$/m)?.[1]
        .trim()
        .replace(/^['"]|['"]$/g, '')
      const model = header?.match(/^model:\s*([^#\r\n]+)\s*$/m)
      const effort = header?.match(/^effort:\s*([^#\r\n]+)\s*$/m)
      const modelLines = header?.match(/^model:/gm)?.length ?? 0
      const effortLines = header?.match(/^effort:/gm)?.length ?? 0
      const nameLines = header?.match(/^name:/gm)?.length ?? 0
      if (
        !header ||
        nameLines !== 1 ||
        name !== role ||
        modelLines > 1 ||
        effortLines > 1 ||
        (modelLines === 1 && !model) ||
        (effortLines === 1 && !effort)
      ) {
        missing.push(role)
        continue
      }
      if (config.provider === 'claude-code') {
        choices[role] = {
          ...(model ? { model: model[1].trim().replace(/^['"]|['"]$/g, '') } : {}),
          ...(effort ? { effort: effort[1].trim().replace(/^['"]|['"]$/g, '') } : {}),
        }
      } else {
        choices[role] = model ? { model: model[1].trim().replace(/^['"]|['"]$/g, '') } : {}
      }
    }
  }
  return { choices, missing }
}
