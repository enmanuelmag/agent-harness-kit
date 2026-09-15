import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { renderDelegationGuidance } from './delegation-guidance'
import { detectPackageManager } from './detect-package-manager'
import { mergeCursorMcpJson } from './mcp-merge'
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
  translateFrontmatterForCursor,
} from './templates'

import type { BuildMaterializerOptions, BuildReport, Materializer } from './index'
import type { AgentFileEntry } from './scaffold-utils'
import type { HarnessConfig, Provider, ScaffoldOptions } from '@/types'

export function cursorAgentFiles(
  config: HarnessConfig,
  modelsByRole?: ScaffoldOptions['cursorAgentModels'],
  capabilityHints = ''
): AgentFileEntry[] {
  const projectName = config.project.name
  return [
    {
      relPath: '.cursor/agents/lead.md',
      content: translateFrontmatterForCursor(
        agentLead({ projectName }, capabilityHints, renderDelegationGuidance('cursor', 'lead')),
        'lead',
        modelsByRole?.lead
      ),
    },
    {
      relPath: '.cursor/agents/explorer.md',
      content: translateFrontmatterForCursor(
        agentExplorer({ projectName }, capabilityHints),
        'explorer',
        modelsByRole?.explorer
      ),
    },
    {
      relPath: '.cursor/agents/consultant.md',
      content: translateFrontmatterForCursor(
        agentConsultant({ projectName }, capabilityHints),
        'consultant',
        modelsByRole?.consultant
      ),
    },
    {
      relPath: '.cursor/agents/builder.md',
      content: translateFrontmatterForCursor(
        agentBuilder({ projectName }, capabilityHints),
        'builder',
        modelsByRole?.builder
      ),
    },
    {
      relPath: '.cursor/agents/reviewer.md',
      content: translateFrontmatterForCursor(
        agentReviewer({ projectName }, capabilityHints),
        'reviewer',
        modelsByRole?.reviewer
      ),
    },
  ]
}

export class CursorMaterializer implements Materializer {
  async scaffold(config: HarnessConfig, opts: ScaffoldOptions): Promise<void> {
    const { cwd, cursorAgentModels } = opts
    const hints = buildCapabilityHints('cursor')
    const write = (relPath: string, content: string, mode?: number) => {
      const abs = join(cwd, relPath)
      mkdirSync(resolve(abs, '..'), { recursive: true })
      writeFileSync(abs, content, { encoding: 'utf8', mode })
    }
    write('AGENTS.md', stampGenerated(agentsMd(config, hints)))
    if (!existsSync(join(cwd, 'health.sh'))) write('health.sh', HEALTH_SH, 0o755)
    writeAgentFiles(cwd, cursorAgentFiles(config, cursorAgentModels, hints))
    mergeCursorMcpJson(
      join(cwd, '.cursor/mcp.json'),
      config.tools.mcp.port,
      cwd,
      detectPackageManager(cwd)
    )
    appendGitignore(cwd)
    writeSkills(cwd, '.cursor/skills', renderDelegationGuidance('cursor', 'coordination-skill'))
  }

  async build(
    config: HarnessConfig,
    cwd: string,
    opts: BuildMaterializerOptions = {}
  ): Promise<BuildReport> {
    const hints = buildCapabilityHints('cursor')
    const derived = reconcileGeneratedFiles(
      cwd,
      [{ relPath: 'AGENTS.md', content: agentsMd(config, hints) }],
      { force: opts.force, backupRoot: join(cwd, config.storage.dir, 'backups') }
    )
    const agents = writeAgentFiles(cwd, cursorAgentFiles(config, opts.cursorAgentModels, hints), {
      force: opts.force,
      backupRoot: join(cwd, config.storage.dir, 'backups'),
    })
    mergeCursorMcpJson(
      join(cwd, '.cursor/mcp.json'),
      config.tools.mcp.port,
      cwd,
      detectPackageManager(cwd)
    )
    writeSkills(cwd, '.cursor/skills', renderDelegationGuidance('cursor', 'coordination-skill'))
    return { agents, derived }
  }

  async migrate(config: HarnessConfig, _to: Provider, _cwd: string): Promise<void> {
    void config
  }
  async syncPermissions(_cwd: string): Promise<void> {
    console.log(
      '  Permissions sync not needed for cursor — readonly is materialized with agent files'
    )
  }
}
