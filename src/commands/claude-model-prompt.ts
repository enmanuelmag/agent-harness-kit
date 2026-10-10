import * as p from '@clack/prompts'

import type { AgentName } from '@/core/materializer/agent-restrictions'
import type { ClaudeAgentModelChoice, Provider } from '@/types'

const AGENT_LABELS: { key: AgentName; label: string }[] = [
  { key: 'lead', label: 'Lead' },
  { key: 'explorer', label: 'Explorer' },
  { key: 'consultant', label: 'Consultant' },
  { key: 'builder', label: 'Builder' },
  { key: 'reviewer', label: 'Reviewer' },
]
const CLAUDE_MODEL_ORDER = ['fable', 'opus', 'sonnet', 'haiku']
const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']

/** Claude documents effort support per model. The aliases offered by AHK map
 * to the current documented family that supports this set; unknown IDs must
 * not be given an invented effort picker. */
export function claudeEffortsForModel(model: string): string[] {
  return CLAUDE_MODEL_ORDER.includes(model) ? CLAUDE_EFFORTS : []
}

/**
 * Claude Code only: prompt once per generated role (lead, explorer,
 * consultant, builder, reviewer) for a model preference, defaulting to
 * 'inherit' (no override). The choice is meant to be written straight into
 * that role's generated `.claude/agents/<role>.md` frontmatter — never into
 * config.
 *
 * Shared by three call sites that all need the identical prompt loop and
 * cancel-handling: `ahk init`'s one-time scaffold, `ahk models`, and
 * `ahk build --force` (claude-code only). Extracted from `runInit` so the
 * loop is defined once instead of triplicated.
 *
 * Returns `{}` immediately for any other provider, so call sites don't need
 * their own provider guard before calling this.
 */
export async function promptClaudeAgentModels(
  provider: Provider,
  roles: AgentName[] = AGENT_LABELS.map(({ key }) => key)
): Promise<Partial<Record<AgentName, ClaudeAgentModelChoice>>> {
  const claudeAgentModels: Partial<Record<AgentName, ClaudeAgentModelChoice>> = {}
  if (provider !== 'claude-code') return claudeAgentModels

  for (const agent of AGENT_LABELS.filter(({ key }) => roles.includes(key))) {
    const val = await p.select({
      message: `Model for ${agent.label}`,
      options: [
        { value: 'inherit', label: 'inherit (default)' },
        { value: 'fable', label: 'fable' },
        { value: 'opus', label: 'opus' },
        { value: 'sonnet', label: 'sonnet' },
        { value: 'haiku', label: 'haiku' },
      ],
      initialValue: 'inherit',
    })
    if (p.isCancel(val)) {
      p.cancel('Cancelled.')
      process.exit(0)
    }
    const selectedModel = val as string
    const efforts = claudeEffortsForModel(selectedModel)
    let selectedEffort: string | undefined
    if (efforts.length) {
      const effort = await p.select({
        message: `Reasoning effort for ${agent.label} (supported by ${selectedModel})`,
        options: [
          { value: 'inherit', label: 'inherit (model default)' },
          ...efforts.map((value) => ({ value, label: value })),
        ],
        initialValue: 'inherit',
      })
      if (p.isCancel(effort)) {
        p.cancel('Cancelled.')
        process.exit(0)
      }
      selectedEffort = effort as string
    } else if (selectedModel !== 'inherit') {
      p.log.warn(`${selectedModel} has no documented effort selector; omitting effort.`)
    }
    claudeAgentModels[agent.key] = {
      ...(selectedModel === 'inherit' ? {} : { model: selectedModel }),
      ...(selectedEffort && selectedEffort !== 'inherit' ? { effort: selectedEffort } : {}),
    }
  }

  return claudeAgentModels
}
