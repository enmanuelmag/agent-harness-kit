import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { AgentName } from '@/core/materializer/agent-restrictions'
import type { ClaudeAgentModelChoice, CodexAgentModelChoice, CursorAgentModelChoice, HarnessConfig } from '@/types'

/** Parse only canonical role metadata. Ambiguous or malformed headers are never guessed. */
export function captureNativeChoices(cwd: string, config: HarnessConfig) {
  const choices: Partial<
    Record<AgentName, ClaudeAgentModelChoice | CodexAgentModelChoice | CursorAgentModelChoice>
  > = {}
  const missing: string[] = []
  const roles: AgentName[] = ['lead', 'explorer', 'consultant', 'builder', 'reviewer']
  for (const role of roles) {
    const path =
      config.provider === 'claude-code'
        ? join(cwd, `.claude/agents/${role}.md`)
        : config.provider === 'codex-cli'
          ? join(cwd, `.codex/agents/${role}.toml`)
          : config.provider === 'cursor'
            ? join(cwd, `.cursor/agents/${role}.md`)
            : ''
    if (!path || !existsSync(path)) {
      missing.push(role)
      continue
    }
    const content = readFileSync(path, 'utf8')
    if (config.provider === 'codex-cli') {
      const header = content.split(/^\s*\[/m, 1)[0]
      const model = header.match(/^\s*model\s*=\s*["']([^"']+)["']\s*(?:#.*)?$/m)
      const agentStart = content.search(/^\s*\[agent\]\s*$/m)
      const agentBody =
        agentStart < 0 ? '' : (content.slice(agentStart).split(/^\s*\[/m, 2)[1] ?? '')
      const agentNames = agentBody.match(/^\s*name\s*=\s*["']([^"']+)["']\s*(?:#.*)?$/gm) ?? []
      const agentName =
        agentNames.length === 1
          ? agentNames[0].match(/^[^=]+=[\s]*["']([^"']+)["']/)?.[1]
          : undefined
      const modelLines = header.match(/^\s*model\s*=/gm)?.length ?? 0
      if (agentName !== role || modelLines > 1 || (modelLines === 1 && !model)) {
        missing.push(role)
        continue
      }
      const effort = header.match(/^\s*model_reasoning_effort\s*=\s*["']([^"']+)["']\s*(?:#.*)?$/m)
      const effortLines = header.match(/^\s*model_reasoning_effort\s*=/gm)?.length ?? 0
      if (effortLines > 1 || (effortLines === 1 && !effort)) {
        missing.push(role)
        continue
      }
      choices[role] = {
        ...(model ? { model: model[1] } : {}),
        ...(effort ? { effort: effort[1] } : {}),
      }
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
