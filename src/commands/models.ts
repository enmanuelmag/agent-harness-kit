import pc from 'picocolors'

import { findConfigFile, loadConfig } from '@/core/config'
import { MaintenanceService } from '@/core/maintenance/operations'
import { claudeAgentFiles } from '@/core/materializer/claude-code'
import { codexAgentFiles } from '@/core/materializer/codex-cli'
import { cursorAgentFiles } from '@/core/materializer/cursor'
import { opencodeV2AgentFiles } from '@/core/materializer/opencode-v2'
import { buildCapabilityHints } from '@/core/materializer/provider-research-capabilities'

import { toPreferences } from './agent-preferences'
import { promptClaudeAgentModels } from './claude-model-prompt'
import { promptCodexAgentModels } from './codex-model-prompt'
import { promptCursorAgentModels } from './cursor-model-prompt'
import { promptOpenCodeV2AgentModels } from './opencode-v2-model-prompt'

import type { AgentName } from '@/core/materializer/agent-restrictions'
import type { WriteAgentFilesResult } from '@/core/materializer/scaffold-utils'
import type {
  ClaudeAgentModelChoice,
  CodexAgentModelChoice,
  CursorAgentModelChoice,
  HarnessConfig,
  Provider,
  ScaffoldOptions,
} from '@/types'

const SUPPORTED_PROVIDERS: Provider[] = ['claude-code', 'codex-cli', 'cursor', 'opencode-v2']
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
      console.log(
        `\n  ${pc.cyan('config'.padEnd(16))}${pc.yellow('[!]')} no agent-harness-kit.config found`
      )
      console.log(`  ${''.padEnd(16)}    ${pc.dim('run: ahk init')}\n`)
      return
    }
    console.log(
      pc.dim(
        `ahk models supports Claude Code, Codex CLI, Cursor, and OpenCode V2. '${ctx.provider}' has no native per-role model prompt — nothing to do.`
      )
    )
    return
  }

  const choices = await promptChoices(ctx.config.provider)
  const preferences = toPreferences(ctx.config.provider, choices)
  const service = new MaintenanceService(cwd)
  const result = await service.execute('models', { choices: preferences[ctx.config.provider] })
  await service.dispose()
  if (!result.ok) throw new Error(`${result.code}: ${result.message ?? ''}`)
  const config = await loadConfig(cwd)
  const agents = result.data!.report as WriteAgentFilesResult
  const label =
    config.provider === 'claude-code'
      ? 'Claude Code'
      : config.provider === 'codex-cli'
        ? 'Codex CLI'
        : config.provider === 'opencode-v2' ? 'OpenCode V2' : 'Cursor'
  console.log('')
  if (agents.overwritten.length) {
    console.log(
      pc.green(
        `✓ Regenerated ${agents.overwritten.length} ${label} agent file(s) with updated native choices:`
      )
    )
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
  if (provider === 'opencode-v2') return promptOpenCodeV2AgentModels(provider)
  if (provider === 'claude-code') return promptClaudeAgentModels(provider)
  if (provider === 'codex-cli') return promptCodexAgentModels(provider)
  return promptCursorAgentModels(provider)
}

/** Exported for focused command tests without mocking interactive prompts. */
export function filesFor(config: HarnessConfig, choices: ChoiceMap) {
  if (config.provider === 'opencode-v2') return opencodeV2AgentFiles(config, choices as ScaffoldOptions['opencodeV2AgentModels'])
  const files =
    config.provider === 'claude-code'
      ? claudeAgentFiles(
          config,
          choices as ChoiceMapFor<ClaudeAgentModelChoice>,
          buildCapabilityHints('claude-code')
        )
      : config.provider === 'codex-cli'
        ? codexAgentFiles(config, choices as ChoiceMapFor<CodexAgentModelChoice>)
        : cursorAgentFiles(
            config,
            choices as ChoiceMapFor<CursorAgentModelChoice>,
            buildCapabilityHints('cursor')
          )
  return files.filter((file) => ROLE_FILES.has(file.relPath.match(/agents\/([^./]+)/)?.[1] ?? ''))
}
