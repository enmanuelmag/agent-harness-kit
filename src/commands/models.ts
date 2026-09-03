import { join } from 'node:path'
import pc from 'picocolors'

import { loadConfig } from '@/core/config'
import { claudeAgentFiles } from '@/core/materializer/claude-code'
import { writeAgentFiles } from '@/core/materializer/scaffold-utils'

import { promptClaudeAgentModels } from './claude-model-prompt'

import type { HarnessConfig, Provider } from '@/types'

/**
 * Resolves what `ahk models` should do, WITHOUT touching the interactive
 * prompt layer. Kept separate from `runModels` so the no-config-found and
 * non-claude-code no-op branches are testable directly — mirrors the
 * separation `getDoctorStatus`/`runDoctor` already have in doctor.ts. No test
 * in this repo mocks `@clack/prompts`; everything downstream of a resolved
 * `ModelsContext` is exercised at the pure-function level instead (see
 * `claudeAgentFiles` / `writeAgentFiles` tests).
 */
export type ModelsContext =
  | { ok: true; config: HarnessConfig }
  | { ok: false; reason: 'no-config' }
  | { ok: false; reason: 'not-claude-code'; provider: Provider }

export async function resolveModelsContext(cwd: string): Promise<ModelsContext> {
  let config: HarnessConfig
  try {
    config = await loadConfig(cwd)
  } catch {
    return { ok: false, reason: 'no-config' }
  }

  if (config.provider !== 'claude-code') {
    return { ok: false, reason: 'not-claude-code', provider: config.provider }
  }

  return { ok: true, config }
}

/**
 * `ahk models` — Claude Code only. Re-runs the same per-role model prompt
 * `ahk init` uses and regenerates ONLY the 5 `.claude/agents/*.md` files with
 * the freshly-collected models, backing up the previous content first (same
 * `writeAgentFiles(..., { force: true, backupRoot })` call shape `ahk build
 * --force` already uses). Scope is strictly the 5 agent files' model line —
 * AGENTS.md, CLAUDE.md, .mcp.json, .claude/settings.json, config, docs path,
 * storage scope, and the task adapter are never touched.
 */
export async function runModels(cwd: string): Promise<void> {
  const ctx = await resolveModelsContext(cwd)

  if (!ctx.ok) {
    if (ctx.reason === 'no-config') {
      // Mirrors runDoctor's no-config-found handling in doctor.ts.
      console.log('')
      console.log(
        `  ${pc.cyan('config'.padEnd(16))}${pc.yellow('[!]')} no agent-harness-kit.config found`
      )
      console.log(`  ${''.padEnd(16)}    ${pc.dim('run: ahk init')}`)
      console.log('')
      return
    }

    console.log(
      pc.dim(
        `ahk models only applies to Claude Code projects (this project uses '${ctx.provider}') — nothing to do.`
      )
    )
    return
  }

  const { config } = ctx
  const claudeAgentModels = await promptClaudeAgentModels(config.provider)

  const agents = writeAgentFiles(cwd, claudeAgentFiles(config, claudeAgentModels), {
    force: true,
    backupRoot: join(cwd, config.storage.dir, 'backups'),
  })

  console.log('')
  if (agents.overwritten.length > 0) {
    console.log(
      pc.green(`✓ Regenerated ${agents.overwritten.length} agent file(s) with updated models:`)
    )
    for (const file of agents.overwritten) console.log(pc.green(`  ✓ ${file}`))
    if (agents.backupDir) {
      console.log(pc.dim(`  Previous content backed up → ${agents.backupDir}`))
    }
  }
  if (agents.created.length > 0) {
    console.log(pc.green(`✓ Created ${agents.created.length} missing agent file(s):`))
    for (const file of agents.created) console.log(pc.green(`  ✓ ${file}`))
  }
  console.log('')
}
