import { join } from 'node:path'
import pc from 'picocolors'

import { findConfigFile, loadConfig } from '@/core/config'
import { claudeAgentFiles } from '@/core/materializer/claude-code'
import { codexAgentFiles } from '@/core/materializer/codex-cli'
import { cursorAgentFiles } from '@/core/materializer/cursor'
import { detectPackageManager } from '@/core/materializer/detect-package-manager'
import { mergeCodexConfigToml } from '@/core/materializer/mcp-merge'
import { buildCapabilityHints } from '@/core/materializer/provider-research-capabilities'
import { writeAgentFiles } from '@/core/materializer/scaffold-utils'

import { choicesFromPreferences, persistPreferences, toPreferences } from './agent-preferences'
import { promptClaudeAgentModels } from './claude-model-prompt'
import { promptCodexAgentModels } from './codex-model-prompt'
import { promptCursorAgentModels } from './cursor-model-prompt'

import type { AgentName } from '@/core/materializer/agent-restrictions'
import type { ClaudeAgentModelChoice, CodexAgentModelChoice, CursorAgentModelChoice, HarnessConfig, Provider } from '@/types'

const SUPPORTED_PROVIDERS: Provider[] = ['claude-code', 'codex-cli', 'cursor']
const ROLE_FILES = new Set(['lead', 'explorer', 'consultant', 'builder', 'reviewer'])

export type ModelsContext =
  | { ok: true; config: HarnessConfig }
  | { ok: false; reason: 'no-config' }
  | { ok: false; reason: 'unsupported-provider'; provider: Provider }

export async function resolveModelsContext(cwd: string): Promise<ModelsContext> {
  let config: HarnessConfig
  try {
    config = await loadConfig(cwd)
  } catch (error) {
    if (findConfigFile(cwd)) throw error
    return { ok: false, reason: 'no-config' }
  }
  if (!SUPPORTED_PROVIDERS.includes(config.provider)) {
    return { ok: false, reason: 'unsupported-provider', provider: config.provider }
  }
  return { ok: true, config }
}

/** Re-prompt native choices and regenerate only the five canonical role files. */
export async function runModels(cwd: string): Promise<void> {
  const ctx = await resolveModelsContext(cwd)
  if (!ctx.ok) {
    if (ctx.reason === 'no-config') {
      console.log(`\n  ${pc.cyan('config'.padEnd(16))}${pc.yellow('[!]')} no agent-harness-kit.config found`)
      console.log(`  ${''.padEnd(16)}    ${pc.dim('run: ahk init')}\n`)
      return
    }
    console.log(pc.dim(`ahk models supports Claude Code, Codex CLI, and Cursor. '${ctx.provider}' has no native per-role model prompt — nothing to do.`))
    return
  }

  const choices = await promptChoices(ctx.config.provider)
  const saved = await persistPreferences(cwd, toPreferences(ctx.config.provider, choices))
  if (saved === 'manual-update-required') return

  const config = await loadConfig(cwd)
  const persistedChoices = choicesForCurrentProvider(config)
  const agents = writeAgentFiles(cwd, filesFor(config, persistedChoices), {
    force: true,
    backupRoot: join(cwd, config.storage.dir, 'backups'),
  })
  if (config.provider === 'codex-cli') {
    mergeCodexConfigToml(
      join(cwd, '.codex/config.toml'),
      config.tools.mcp.port,
      cwd,
      detectPackageManager(cwd),
      persistedChoices.lead as CodexAgentModelChoice | undefined
    )
  }
  const label = config.provider === 'claude-code' ? 'Claude Code' : config.provider === 'codex-cli' ? 'Codex CLI' : 'Cursor'
  console.log('')
  if (agents.overwritten.length) {
    console.log(pc.green(`✓ Regenerated ${agents.overwritten.length} ${label} agent file(s) with updated native choices:`))
    for (const file of agents.overwritten) console.log(pc.green(`  ✓ ${file}`))
    if (agents.backupDir) console.log(pc.dim(`  Previous content backed up → ${agents.backupDir}`))
  }
  if (agents.created.length) {
    console.log(pc.green(`✓ Created ${agents.created.length} missing ${label} agent file(s):`))
    for (const file of agents.created) console.log(pc.green(`  ✓ ${file}`))
  }
  console.log('')
}

type Choice = string | ClaudeAgentModelChoice | CodexAgentModelChoice | CursorAgentModelChoice
type ChoiceMap = Partial<Record<AgentName, Choice>>
type ChoiceMapFor<T> = Partial<Record<AgentName, T>>

async function promptChoices(provider: Provider): Promise<ChoiceMap> {
  if (provider === 'claude-code') return promptClaudeAgentModels(provider)
  if (provider === 'codex-cli') return promptCodexAgentModels(provider)
  return promptCursorAgentModels(provider)
}

function choicesForCurrentProvider(config: HarnessConfig): ChoiceMap {
  const stored = choicesFromPreferences(config)
  return (stored.claudeAgentModels ?? stored.codexAgentModels ?? stored.cursorAgentModels ?? {}) as ChoiceMap
}

/** Exported for focused command tests without mocking interactive prompts. */
export function filesFor(config: HarnessConfig, choices: ChoiceMap) {
  const files = config.provider === 'claude-code'
    ? claudeAgentFiles(config, choices as ChoiceMapFor<ClaudeAgentModelChoice>, buildCapabilityHints('claude-code'))
    : config.provider === 'codex-cli'
      ? codexAgentFiles(config, choices as ChoiceMapFor<CodexAgentModelChoice>)
      : cursorAgentFiles(config, choices as ChoiceMapFor<CursorAgentModelChoice>, buildCapabilityHints('cursor'))
  return files.filter((file) => ROLE_FILES.has(file.relPath.match(/agents\/([^./]+)/)?.[1] ?? ''))
}
