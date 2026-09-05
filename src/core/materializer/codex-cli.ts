import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { renderDelegationGuidance } from './delegation-guidance'
import { detectPackageManager } from './detect-package-manager'
import { mergeCodexConfigToml } from './mcp-merge'
import {
  appendGitignore,
  reconcileGeneratedFiles,
  stampGenerated,
  writeAgentFiles,
  writeSkills,
} from './scaffold-utils'
import {
  agentBuilderToml,
  agentConsultantToml,
  agentExplorerToml,
  agentLeadAsDefaultToml,
  agentLeadToml,
  agentReviewerToml,
  agentsMd,
  HEALTH_SH,
} from './templates'

import type { BuildMaterializerOptions, BuildReport, Materializer } from './index'
import type { AgentFileEntry } from './scaffold-utils'
import type { HarnessConfig, Provider, ScaffoldOptions } from '@/types'

/** Agent files this provider owns. Shared by `scaffold()` and `build()`.
 *
 *  `default.toml` is included deliberately. It is a shim that overrides Codex's
 *  built-in `default` agent so `lead` runs when no agent is selected, but it is
 *  still an agent file the user may edit, so it follows the same user-owned
 *  policy as the five roles: created when missing, regenerated only with
 *  --force.
 *
 *  `modelsByRole` is optional, collected via `promptCodexAgentModels` (Codex
 *  CLI only). It is populated by `scaffold()` (from `ahk init`'s per-role
 *  model+effort prompt), and can also be threaded into `build()` via
 *  `BuildMaterializerOptions.codexAgentModels`. A plain `ahk build` (no
 *  `--force`) never collects models, so `build()`'s default call still passes
 *  no second argument here, and existing agent files are left untouched
 *  regardless (see `writeAgentFiles`'s user-ownership policy). Exported —
 *  mirroring `claude-code.ts`'s exported `claudeAgentFiles` — so it can be
 *  tested directly with an explicit map, without mocking `@clack/prompts`. */
export function codexAgentFiles(
  config: HarnessConfig,
  modelsByRole?: ScaffoldOptions['codexAgentModels'],
  _capabilityHints = ''
): AgentFileEntry[] {
  const projectName = config.project.name
  return [
    {
      relPath: '.codex/agents/lead.toml',
      content: agentLeadToml(
        { projectName },
        modelsByRole?.lead,
        renderDelegationGuidance('codex-cli', 'lead')
      ),
    },
    {
      relPath: '.codex/agents/explorer.toml',
      content: agentExplorerToml({ projectName }, modelsByRole?.explorer),
    },
    {
      relPath: '.codex/agents/consultant.toml',
      content: agentConsultantToml({ projectName }, modelsByRole?.consultant),
    },
    {
      relPath: '.codex/agents/builder.toml',
      content: agentBuilderToml({ projectName }, modelsByRole?.builder),
    },
    {
      relPath: '.codex/agents/reviewer.toml',
      content: agentReviewerToml({ projectName }, modelsByRole?.reviewer),
    },
    {
      relPath: '.codex/agents/default.toml',
      content: agentLeadAsDefaultToml(
        { projectName },
        modelsByRole?.lead,
        renderDelegationGuidance('codex-cli', 'lead')
      ),
    },
  ]
}

export class CodexCliMaterializer implements Materializer {
  async scaffold(config: HarnessConfig, opts: ScaffoldOptions): Promise<void> {
    const { cwd, codexAgentModels } = opts

    const write = (relPath: string, content: string, mode?: number) => {
      const abs = join(cwd, relPath)
      mkdirSync(resolve(abs, '..'), { recursive: true })
      writeFileSync(abs, content, { encoding: 'utf8', mode })
    }

    // AGENTS.md — fresh project, write unconditionally, but STAMP the provenance
    // marker so the first `ahk build` recognizes it as our own output (a
    // markerless file would look human-edited and freeze config propagation).
    write('AGENTS.md', stampGenerated(agentsMd(config)))

    // health.sh — only create if it doesn't exist
    if (!existsSync(join(cwd, 'health.sh'))) {
      write('health.sh', HEALTH_SH, 0o755)
    }

    // .codex/agents/ — user-owned: create when missing, never overwrite
    writeAgentFiles(cwd, codexAgentFiles(config, codexAgentModels))

    // .codex/config.toml — MERGE, never overwrite whole file. Detect the
    // project's package manager fresh from cwd so the spawned command matches npm/pnpm/yarn.
    mergeCodexConfigToml(
      join(cwd, '.codex/config.toml'),
      config.tools.mcp.port,
      cwd,
      detectPackageManager(cwd)
    )

    appendGitignore(cwd)
    writeSkills(cwd, '.agents/skills', renderDelegationGuidance('codex-cli', 'coordination-skill'))
  }

  async build(
    config: HarnessConfig,
    cwd: string,
    opts: BuildMaterializerOptions = {}
  ): Promise<BuildReport> {
    // AGENTS.md is DERIVED FROM CONFIG. Reconcile against the provenance marker:
    // untouched files propagate config changes, hand-edited files are preserved
    // (and reported), --force regenerates after backing up.
    const derived = reconcileGeneratedFiles(
      cwd,
      [{ relPath: 'AGENTS.md', content: agentsMd(config) }],
      { force: opts.force, backupRoot: join(cwd, config.storage.dir, 'backups') }
    )

    const agents = writeAgentFiles(cwd, codexAgentFiles(config, opts.codexAgentModels), {
      force: opts.force,
      backupRoot: join(cwd, config.storage.dir, 'backups'),
    })

    // Re-detecting on every build self-corrects the command if the user
    // switched package managers since `ahk init` — no migration flag needed.
    mergeCodexConfigToml(
      join(cwd, '.codex/config.toml'),
      config.tools.mcp.port,
      cwd,
      detectPackageManager(cwd)
    )
    writeSkills(cwd, '.agents/skills', renderDelegationGuidance('codex-cli', 'coordination-skill'))

    return { agents, derived }
  }

  async migrate(config: HarnessConfig, _to: Provider, _cwd: string): Promise<void> {
    void config
  }

  async syncPermissions(_cwd: string): Promise<void> {
    console.log('  Permissions sync not needed for codex-cli — skipping')
  }
}
