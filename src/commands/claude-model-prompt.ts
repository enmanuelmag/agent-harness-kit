import * as p from '@clack/prompts'

import type { AgentName } from '@/core/materializer/agent-restrictions'
import type { Provider } from '@/types'

const AGENT_LABELS: { key: AgentName; label: string }[] = [
  { key: 'lead', label: 'Lead' },
  { key: 'explorer', label: 'Explorer' },
  { key: 'consultant', label: 'Consultant' },
  { key: 'builder', label: 'Builder' },
  { key: 'reviewer', label: 'Reviewer' },
]

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
  provider: Provider
): Promise<Partial<Record<AgentName, string>>> {
  const claudeAgentModels: Partial<Record<AgentName, string>> = {}
  if (provider !== 'claude-code') return claudeAgentModels

  for (const agent of AGENT_LABELS) {
    const val = await p.select({
      message: `Model for ${agent.label}`,
      options: [
        { value: 'inherit', label: 'inherit (default)' },
        { value: 'haiku', label: 'haiku' },
        { value: 'sonnet', label: 'sonnet' },
        { value: 'opus', label: 'opus' },
        { value: 'fable', label: 'fable' },
      ],
      initialValue: 'inherit',
    })
    if (p.isCancel(val)) {
      p.cancel('Cancelled.')
      process.exit(0)
    }
    claudeAgentModels[agent.key] = val as string
  }

  return claudeAgentModels
}
