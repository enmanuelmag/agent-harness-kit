import * as p from '@clack/prompts'
import pc from 'picocolors'

import { loadConfig } from '@/core/config'
import { getMaterializer } from '@/core/materializer/index'

import { persistPreferences, toPreferences } from './agent-preferences'
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
  const preferenceResult = await persistPreferences(cwd, toPreferences(target, choices))
  if (preferenceResult === 'manual-update-required') return
  const savedConfig = await loadConfig(cwd)

  const spinner = p.spinner()
  spinner.start(`Migrating from ${config.provider} to ${target}...`)

  try {
    // Scaffold the new provider's files
    const targetMaterializer = getMaterializer(target)
    await targetMaterializer.build({ ...savedConfig, provider: target }, cwd, {
      force: true,
      claudeAgentModels,
      codexAgentModels,
      cursorAgentModels,
    })

    spinner.stop(pc.green(`Migrated to ${target}`))
    p.log.warn(`Update agent-harness-kit.config.ts: set provider: '${target}'`)
    p.log.warn(`Then run: ahk build`)
  } catch (err) {
    spinner.stop(pc.red('Migration failed'))
    p.log.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }
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
