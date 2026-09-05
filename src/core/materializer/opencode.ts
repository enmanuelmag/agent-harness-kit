import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { renderDelegationGuidance } from './delegation-guidance'
import { detectPackageManager } from './detect-package-manager'
import { mergeOpencodeJson } from './mcp-merge'
import { buildCapabilityHints } from './provider-research-capabilities'
import {
  appendGitignore,
  reconcileGeneratedFiles,
  stampGenerated,
  writeAgentFiles,
  writeSkills,
} from './scaffold-utils'
import {
  agentBuilder,
  agentConsultant,
  agentExplorer,
  agentLead,
  agentReviewer,
  agentsMd,
  HEALTH_SH,
  translateFrontmatterForOpenCode,
} from './templates'

import type { BuildMaterializerOptions, BuildReport, Materializer } from './index'
import type { AgentFileEntry } from './scaffold-utils'
import type { HarnessConfig, Provider, ScaffoldOptions } from '@/types'

/** Agent files this provider owns. Shared by `scaffold()` and `build()`. */
function opencodeAgentFiles(config: HarnessConfig, capabilityHints = ''): AgentFileEntry[] {
  const projectName = config.project.name
  return [
    {
      relPath: '.opencode/agents/lead.md',
      content: translateFrontmatterForOpenCode(
        agentLead({ projectName }, capabilityHints, renderDelegationGuidance('opencode', 'lead')),
        'lead'
      ),
    },
    {
      relPath: '.opencode/agents/explorer.md',
      content: translateFrontmatterForOpenCode(
        agentExplorer({ projectName }, capabilityHints),
        'explorer'
      ),
    },
    {
      relPath: '.opencode/agents/consultant.md',
      content: translateFrontmatterForOpenCode(
        agentConsultant({ projectName }, capabilityHints),
        'consultant'
      ),
    },
    {
      relPath: '.opencode/agents/builder.md',
      content: translateFrontmatterForOpenCode(
        agentBuilder({ projectName }, capabilityHints),
        'builder'
      ),
    },
    {
      relPath: '.opencode/agents/reviewer.md',
      content: translateFrontmatterForOpenCode(
        agentReviewer({ projectName }, capabilityHints),
        'reviewer'
      ),
    },
  ]
}

export class OpenCodeMaterializer implements Materializer {
  async scaffold(config: HarnessConfig, opts: ScaffoldOptions): Promise<void> {
    const { cwd } = opts
    const capabilityHints = buildCapabilityHints('opencode')

    const write = (relPath: string, content: string, mode?: number) => {
      const abs = join(cwd, relPath)
      mkdirSync(resolve(abs, '..'), { recursive: true })
      writeFileSync(abs, content, { encoding: 'utf8', mode })
    }

    // AGENTS.md — fresh project, write unconditionally, but STAMP the provenance
    // marker so the first `ahk build` recognizes it as our own output (a
    // markerless file would look human-edited and freeze config propagation).
    write('AGENTS.md', stampGenerated(agentsMd(config, capabilityHints)))

    // health.sh — only create if it doesn't exist
    if (!existsSync(join(cwd, 'health.sh'))) {
      write('health.sh', HEALTH_SH, 0o755)
    }

    // .opencode/agents/ — user-owned: create when missing, never overwrite
    writeAgentFiles(cwd, opencodeAgentFiles(config, capabilityHints))

    // opencode.json — MERGE, never overwrite whole file. Detect the project's
    // package manager fresh from cwd so the spawned command matches npm/pnpm/yarn.
    mergeOpencodeJson(
      join(cwd, 'opencode.json'),
      config.tools.mcp.port,
      cwd,
      detectPackageManager(cwd)
    )

    appendGitignore(cwd)
    writeSkills(cwd, '.opencode/skills', renderDelegationGuidance('opencode', 'coordination-skill'))
  }

  async build(
    config: HarnessConfig,
    cwd: string,
    opts: BuildMaterializerOptions = {}
  ): Promise<BuildReport> {
    const capabilityHints = buildCapabilityHints('opencode')

    // AGENTS.md is DERIVED FROM CONFIG. Reconcile against the provenance marker:
    // untouched files propagate config changes, hand-edited files are preserved
    // (and reported), --force regenerates after backing up.
    const derived = reconcileGeneratedFiles(
      cwd,
      [{ relPath: 'AGENTS.md', content: agentsMd(config, capabilityHints) }],
      { force: opts.force, backupRoot: join(cwd, config.storage.dir, 'backups') }
    )

    const agents = writeAgentFiles(cwd, opencodeAgentFiles(config, capabilityHints), {
      force: opts.force,
      backupRoot: join(cwd, config.storage.dir, 'backups'),
    })

    // Re-detecting on every build self-corrects the command if the user
    // switched package managers since `ahk init` — no migration flag needed.
    mergeOpencodeJson(
      join(cwd, 'opencode.json'),
      config.tools.mcp.port,
      cwd,
      detectPackageManager(cwd)
    )
    writeSkills(cwd, '.opencode/skills', renderDelegationGuidance('opencode', 'coordination-skill'))

    return { agents, derived }
  }

  async migrate(config: HarnessConfig, _to: Provider, _cwd: string): Promise<void> {
    void config
  }

  async syncPermissions(_cwd: string): Promise<void> {
    console.log('  Permissions sync not needed for opencode — skipping')
  }
}
