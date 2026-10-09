import { watch } from 'node:fs'
import * as p from '@clack/prompts'
import pc from 'picocolors'

import { loadConfig } from '@/core/config'
import { getMaterializer } from '@/core/materializer/index'

import { persistPreferences, toPreferences } from './agent-preferences'
import { choicesFromPreferences } from './agent-preferences'
import { promptClaudeAgentModels } from './claude-model-prompt'
import { promptCodexAgentModels } from './codex-model-prompt'
import { promptCursorAgentModels } from './cursor-model-prompt'

import type { AgentName } from '@/core/materializer/agent-restrictions'
import type { ClaudeAgentModelChoice, CodexAgentModelChoice, CursorAgentModelChoice } from '@/types'

export interface BuildOptions {
  watch?: boolean
  sync?: boolean
  force?: boolean
}

export async function runBuild(cwd: string, opts: BuildOptions): Promise<void> {
  await buildOnce(cwd, opts.force)

  if (opts.sync) {
    p.log.step('Syncing agent permissions...')
    const config = await loadConfig(cwd)
    const materializer = getMaterializer(config.provider)
    await materializer.syncPermissions(cwd)
  }

  if (opts.watch) {
    p.log.info(`Watching agent-harness-kit.config.ts for changes...`)
    watch(cwd, { recursive: false }, async (_, filename) => {
      if (filename?.startsWith('agent-harness-kit.config')) {
        p.log.step('Config changed — rebuilding...')
        // Deliberately never forced: an automatic rebuild triggered by a file
        // watcher must not destroy agent-file customizations behind the user's
        // back. --force is a one-shot, explicitly requested operation.
        await buildOnce(cwd, false)
      }
    })
    // Keep process alive
    await new Promise(() => {})
  }
}

export async function buildOnce(cwd: string, force?: boolean, keepModels = false): Promise<void> {
  // Load config OUTSIDE any spinner: when --force is set on a claude-code
  // project, the per-role model prompt below needs the provider (from config)
  // before it can decide whether to run, and an interactive p.select cannot
  // render while a p.spinner is active. Loading config is fast (no spinner
  // needed for it in practice), so it moved out of the spinner-wrapped block
  // that used to say "Loading config...".
  let config: Awaited<ReturnType<typeof loadConfig>>
  try {
    config = await loadConfig(cwd)
  } catch (err) {
    p.log.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }

  // Claude Code only, and only when --force is set: re-run the same per-role
  // model prompt `ahk init` and `ahk models` use, before regenerating agent
  // files. Must happen BEFORE the spinner below starts.
  let claudeAgentModels: Partial<Record<AgentName, ClaudeAgentModelChoice>> | undefined
  let codexAgentModels: Partial<Record<AgentName, CodexAgentModelChoice>> | undefined
  let cursorAgentModels: Partial<Record<AgentName, CursorAgentModelChoice>> | undefined
  // A safe rebuild never prompts, but a deleted role agent should be recreated
  // with the recorded choice rather than silently losing its model override.
  if (!force) {
    const stored = choicesFromPreferences(config)
    claudeAgentModels = stored.claudeAgentModels
    codexAgentModels = stored.codexAgentModels
    cursorAgentModels = stored.cursorAgentModels
  }
  if (force && config.provider === 'claude-code' && !keepModels) {
    claudeAgentModels = await promptClaudeAgentModels(config.provider)
  }

  // Codex CLI only, and only when --force is set: mirror the claude-code
  // branch above with the same per-role model + reasoning-effort prompt
  // `ahk init` uses. Must also happen BEFORE the spinner below starts.
  if (force && config.provider === 'codex-cli' && !keepModels) {
    codexAgentModels = await promptCodexAgentModels(config.provider)
  }
  if (force && config.provider === 'cursor' && !keepModels) {
    cursorAgentModels = await promptCursorAgentModels(config.provider)
  }
  if (force && keepModels) {
    const { choicesFromPreferences, missingPreferenceRoles } = await import('./agent-preferences')
    const missing = missingPreferenceRoles(config)
    if (missing.length) {
      if (config.provider === 'claude-code') claudeAgentModels = await promptClaudeAgentModels(config.provider, missing)
      if (config.provider === 'codex-cli') codexAgentModels = await promptCodexAgentModels(config.provider, missing)
      if (config.provider === 'cursor') cursorAgentModels = await promptCursorAgentModels(config.provider, missing)
      const result = await persistPreferences(cwd, toPreferences(config.provider, (claudeAgentModels ?? codexAgentModels ?? cursorAgentModels) as never))
      if (result === 'manual-update-required') throw new Error('Preferences need to be saved before regenerating agent files.')
      config = await loadConfig(cwd)
    }
    const stored = choicesFromPreferences(config)
    claudeAgentModels = stored.claudeAgentModels
    codexAgentModels = stored.codexAgentModels
    cursorAgentModels = stored.cursorAgentModels
  } else if (force) {
    const choices = (claudeAgentModels ?? codexAgentModels ?? cursorAgentModels) as never
    const result = await persistPreferences(cwd, toPreferences(config.provider, choices))
    if (result === 'manual-update-required') throw new Error('Preferences need to be saved before regenerating agent files.')
    config = await loadConfig(cwd)
  }

  const spinner = p.spinner()
  spinner.start('Rebuilding files...')

  try {
    const materializer = getMaterializer(config.provider)
    const report = await materializer.build(config, cwd, {
      force,
      claudeAgentModels,
      codexAgentModels,
      cursorAgentModels,
    })
    spinner.stop(pc.green('Build complete'))

    // ── Config-derived files (AGENTS.md, and CLAUDE.md for claude-code) ──
    // Report the ACTUAL per-file outcome rather than a static line. Files that
    // are up to date (created / already current / config propagated) are
    // announced quietly; hand-edited files are called out LOUDLY so a user who
    // expects config to propagate is not left thinking it silently did.
    const d = report.derived
    const upToDate = [...d.created, ...d.current, ...d.propagated]
    if (upToDate.length > 0) {
      p.log.success(upToDate.join(', '))
    }
    if (d.propagated.length > 0) {
      p.log.info(
        `Propagated config changes to ${d.propagated.length} generated file(s):\n  ${d.propagated.join('\n  ')}`
      )
    }
    if (d.overwritten.length > 0) {
      p.log.warn(
        pc.yellow(
          `--force REGENERATED ${d.overwritten.length} hand-edited generated file(s), discarding your edits:\n  ` +
            d.overwritten.join('\n  ')
        )
      )
      if (d.backupDir) {
        p.log.info(pc.yellow(`  Previous content backed up → ${d.backupDir}`))
      }
    }
    if (d.preserved.length > 0) {
      // The anti-"silently stale" guard: these files diverge from the current
      // config but were hand-edited, so build left them alone. Say so loudly.
      p.log.warn(
        pc.yellow(
          `Left ${d.preserved.length} hand-edited generated file(s) UNTOUCHED — your edits are safe:\n  ` +
            d.preserved.join('\n  ') +
            `\n  These no longer match the current config. Re-run with --force to regenerate them\n  ` +
            `(this DESTROYS your edits; a backup is written first).`
        )
      )
    }

    p.log.success(`Agent definitions (${config.provider})`)
    p.log.success('MCP config')

    const { created, overwritten, preserved, backupDir } = report.agents

    if (created.length > 0) {
      p.log.info(`Created ${created.length} missing agent file(s):\n  ${created.join('\n  ')}`)
    }

    if (overwritten.length > 0) {
      // Name every file that lost its customizations. A count alone would not
      // let the user tell which of their edits are now only in the backup.
      p.log.warn(
        pc.yellow(
          `--force REGENERATED ${overwritten.length} existing agent file(s), discarding any customizations:\n  ` +
            overwritten.join('\n  ')
        )
      )
      if (backupDir) {
        p.log.info(pc.yellow(`  Previous content backed up → ${backupDir}`))
      }
    }

    if (preserved.length > 0) {
      // Without this, a user who edited a template and expects `build` to pick
      // up an upstream improvement gets silence and assumes it was applied.
      p.log.info(
        `Left ${preserved.length} existing agent file(s) untouched — agent files are yours to edit.\n  ` +
          `Re-run with --force to regenerate them from the packaged templates (this DESTROYS your edits;\n  ` +
          `a backup is written first).`
      )
    }
  } catch (err) {
    spinner.stop(pc.red('Build failed'))
    p.log.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }
}
