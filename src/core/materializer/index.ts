import { ClaudeCodeMaterializer } from './claude-code'
import { CodexCliMaterializer } from './codex-cli'
import { GrokMaterializer } from './grok'
import { OpenCodeMaterializer } from './opencode'

import type { ReconcileResult, WriteAgentFilesResult } from './scaffold-utils'
import type { HarnessConfig, Provider, ScaffoldOptions } from '@/types'

export interface BuildMaterializerOptions {
  /** Regenerate agent files that already exist, DESTROYING any customization.
   *  A backup of the previous content is written first; if the backup fails,
   *  nothing is overwritten. */
  force?: boolean
  /** Claude Code only: per-role model choice collected via
   *  `promptClaudeAgentModels`, keyed by `AgentName`. Threaded into
   *  `ClaudeCodeMaterializer.build()` to inject a `model:` frontmatter line
   *  when regenerating agent files (currently only reachable via
   *  `ahk build --force`, which re-runs the prompt). Same shape as
   *  `ScaffoldOptions['claudeAgentModels']` — reused verbatim rather than
   *  redeclared. Purely additive and optional: `opencode.ts`, `codex-cli.ts`,
   *  and `grok.ts` share the identical `build()` signature and simply never
   *  read this field. */
  claudeAgentModels?: ScaffoldOptions['claudeAgentModels']
}

export interface BuildReport {
  /** What happened to the provider's agent files during this build. */
  agents: WriteAgentFilesResult
  /** What happened to the config-derived files (AGENTS.md, and CLAUDE.md for
   *  claude-code) during this build. Untouched files propagate config changes
   *  automatically; hand-edited files are preserved and reported. */
  derived: ReconcileResult
}

export interface Materializer {
  scaffold(config: HarnessConfig, opts: ScaffoldOptions): Promise<void>
  build(config: HarnessConfig, cwd: string, opts?: BuildMaterializerOptions): Promise<BuildReport>
  migrate(config: HarnessConfig, to: Provider, cwd: string): Promise<void>
  syncPermissions(cwd: string): Promise<void>
}

export function getMaterializer(provider: Provider): Materializer {
  switch (provider) {
    case 'claude-code':
      return new ClaudeCodeMaterializer()
    case 'opencode':
      return new OpenCodeMaterializer()
    case 'codex-cli':
      return new CodexCliMaterializer()
    case 'grok-cli':
      return new GrokMaterializer()
    default:
      throw new Error(`Unknown provider: ${provider as string}`)
  }
}
