import * as p from '@clack/prompts'
import pc from 'picocolors'

import { loadConfig } from '@/core/config'
import { MaintenanceService } from '@/core/maintenance/operations'

import { toPreferences } from './agent-preferences'
import { promptClaudeAgentModels } from './claude-model-prompt'
import { promptCodexAgentModels } from './codex-model-prompt'
import { promptCursorAgentModels } from './cursor-model-prompt'

import type { AgentName } from '@/core/materializer/agent-restrictions'
import type { Provider } from '@/types'
import type { ClaudeAgentModelChoice, CodexAgentModelChoice, CursorAgentModelChoice } from '@/types'

interface MigrateOptions {
  to?: string
}

export async function runMigrate(cwd: string, opts: MigrateOptions): Promise<void> {
  const config = await loadConfig(cwd)

  let target: Provider
  if (opts.to && ['claude-code', 'opencode', 'codex-cli', 'grok-cli', 'cursor'].includes(opts.to)) {
    target = opts.to as Provider
  } else {
    const val = await p.select({
      message: 'Migrate to provider',
      options: [
        { value: 'claude-code', label: 'Claude Code' },
        { value: 'opencode', label: 'OpenCode' },
        { value: 'codex-cli', label: 'Codex CLI' },
        { value: 'grok-cli', label: 'Grok CLI' },
        { value: 'cursor', label: 'Cursor' },
      ],
    })
    if (p.isCancel(val)) {
      p.cancel('Cancelled.')
      process.exit(0)
    }
    target = val as Provider
  }

  if (target === config.provider) {
    console.log(pc.dim(`Already on ${target} — nothing to migrate.`))
    return
  }

  // Re-run the same per-role model prompt `ahk init` and `ahk build --force`
  // use, scoped to whichever provider we're migrating to. Both helpers
  // self-guard on the provider argument, so calling both unconditionally is
  // safe — only the target's own questions actually appear. Must happen
  // BEFORE the spinner below starts: an interactive p.select cannot render
  // while a p.spinner is active.
  const claudeAgentModels = await promptClaudeAgentModels(target)
  const codexAgentModels = await promptCodexAgentModels(target)
  const cursorAgentModels = await promptCursorAgentModels(target)
  const choices = choicesForMigrationTarget(target, {
    claudeAgentModels,
    codexAgentModels,
    cursorAgentModels,
  })
  const service = new MaintenanceService(cwd)
  try {
    const preferences = toPreferences(target, choices)
    const plan = await service.execute('migrate.provider.plan', { to: target, choices: preferences[target], force: true })
    if (!plan.ok) throw new Error(`${plan.code}: ${plan.message ?? ''}`)
    const result = await service.execute('migrate.provider.apply', { planId: plan.data!.planId })
    if (!result.ok) throw new Error(`${result.code}: ${result.message ?? ''}`)
    p.log.success(`Migrated to ${target}; stored configuration and generated files updated.`)
  } finally { await service.dispose() }

}

/** Select target-native preferences explicitly: guarded prompts for the other
 * providers return empty maps, so nullish coalescing would choose the wrong one. */
export function choicesForMigrationTarget(
  target: Provider,
  choices: {
    claudeAgentModels: Partial<Record<AgentName, ClaudeAgentModelChoice>>
    codexAgentModels: Partial<Record<AgentName, CodexAgentModelChoice>>
    cursorAgentModels: Partial<Record<AgentName, CursorAgentModelChoice>>
  }
) {
  if (target === 'claude-code') return choices.claudeAgentModels
  if (target === 'codex-cli') return choices.codexAgentModels
  if (target === 'cursor') return choices.cursorAgentModels
  return {}
}
