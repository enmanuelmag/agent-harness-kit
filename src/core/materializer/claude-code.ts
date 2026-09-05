import { existsSync } from 'fs'
import { join } from 'path'

import { write } from '@/utils/file'

import { renderDelegationGuidance } from './delegation-guidance'
import { detectPackageManager } from './detect-package-manager'
import {
  mergeClaudeMcpJson,
  mergeClaudeSettingsJson,
  mergeClaudeSettingsLocalJson,
} from './mcp-merge'
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
  claudeMd,
  HEALTH_SH,
  translateFrontmatterForClaudeCode,
} from './templates'

import type { BuildMaterializerOptions, BuildReport, Materializer } from './index'
import type { AgentFileEntry } from './scaffold-utils'
import type { HarnessConfig, Provider, ScaffoldOptions } from '@/types'

/** The set of agent files this provider owns, with their generated content.
 *  Single definition shared by `scaffold()` and `build()` — the two used to
 *  duplicate this list, which is how `build()` kept overwriting user edits
 *  long after `scaffold()` had been fixed to preserve them.
 *
 *  `modelsByRole` is optional, collected via `promptClaudeAgentModels`
 *  (Claude Code only). It is populated by `scaffold()` (from `ahk init`'s
 *  per-role model prompt), and can also be threaded into `build()` via
 *  `BuildMaterializerOptions.claudeAgentModels` — which happens when
 *  `ahk build --force` re-runs the prompt, and always when `ahk models`
 *  calls this directly to regenerate just the 5 agent files. A plain
 *  `ahk build` (no `--force`) never collects models, so `build()`'s default
 *  call still passes no second argument here, and existing agent files are
 *  left untouched regardless (see `writeAgentFiles`'s user-ownership policy).
 *  Exported so `ahk models` (src/commands/models.ts) can build the entry
 *  list itself and hand it to `writeAgentFiles`. */
export function claudeAgentFiles(
  config: HarnessConfig,
  modelsByRole?: ScaffoldOptions['claudeAgentModels'],
  capabilityHints = ''
): AgentFileEntry[] {
  const projectName = config.project.name
  return [
    {
      relPath: '.claude/agents/lead.md',
      content: translateFrontmatterForClaudeCode(
        agentLead(
          { projectName },
          capabilityHints,
          renderDelegationGuidance('claude-code', 'lead')
        ),
        'lead',
        { model: modelsByRole?.lead }
      ),
    },
    {
      relPath: '.claude/agents/explorer.md',
      content: translateFrontmatterForClaudeCode(
        agentExplorer({ projectName }, capabilityHints),
        'explorer',
        { model: modelsByRole?.explorer }
      ),
    },
    {
      relPath: '.claude/agents/consultant.md',
      content: translateFrontmatterForClaudeCode(
        agentConsultant({ projectName }, capabilityHints),
        'consultant',
        { model: modelsByRole?.consultant }
      ),
    },
    {
      relPath: '.claude/agents/builder.md',
      content: translateFrontmatterForClaudeCode(
        agentBuilder({ projectName }, capabilityHints),
        'builder',
        { model: modelsByRole?.builder }
      ),
    },
    {
      relPath: '.claude/agents/reviewer.md',
      content: translateFrontmatterForClaudeCode(
        agentReviewer({ projectName }, capabilityHints),
        'reviewer',
        { model: modelsByRole?.reviewer }
      ),
    },
  ]
}

export class ClaudeCodeMaterializer implements Materializer {
  async scaffold(config: HarnessConfig, opts: ScaffoldOptions): Promise<void> {
    const { cwd, claudeAgentModels } = opts
    const capabilityHints = buildCapabilityHints('claude-code')

    // AGENTS.md and CLAUDE.md — fresh project, write unconditionally, but STAMP
    // the provenance marker so the first `ahk build` recognizes these as our own
    // output and keeps propagating config changes (a markerless file would be
    // treated as human-edited and frozen from day one).
    write(cwd, 'AGENTS.md', stampGenerated(agentsMd(config, capabilityHints)))
    write(cwd, 'CLAUDE.md', stampGenerated(claudeMd(config, capabilityHints)))

    // health.sh — only create if it doesn't exist
    if (!existsSync(join(cwd, 'health.sh'))) {
      write(cwd, 'health.sh', HEALTH_SH, 0o755)
    }

    // .claude/agents/ — user-owned: create when missing, never overwrite
    writeAgentFiles(cwd, claudeAgentFiles(config, claudeAgentModels, capabilityHints))

    // .mcp.json — MERGE, never overwrite whole file. Detect the project's
    // package manager fresh from cwd so the spawned command matches npm/pnpm/yarn.
    mergeClaudeMcpJson(
      join(cwd, '.mcp.json'),
      config.tools.mcp.port,
      cwd,
      detectPackageManager(cwd)
    )
    // .claude/settings.json — set `agent: "lead"` (the official Claude Code default-agent field)
    mergeClaudeSettingsJson(join(cwd, '.claude/settings.json'))
    // .claude/settings.local.json — merge MCP tool permissions
    mergeClaudeSettingsLocalJson(join(cwd, '.claude/settings.local.json'))

    // .gitignore additions
    appendGitignore(cwd)
    writeSkills(
      cwd,
      '.claude/skills',
      renderDelegationGuidance('claude-code', 'coordination-skill')
    )
  }

  async build(
    config: HarnessConfig,
    cwd: string,
    opts: BuildMaterializerOptions = {}
  ): Promise<BuildReport> {
    const capabilityHints = buildCapabilityHints('claude-code')

    // AGENTS.md and CLAUDE.md are DERIVED FROM CONFIG. Reconcile against the
    // provenance marker: untouched files propagate config changes automatically,
    // hand-edited files are preserved (and reported), --force regenerates them
    // after backing up. See reconcileGeneratedFiles in scaffold-utils.
    const derived = reconcileGeneratedFiles(
      cwd,
      [
        { relPath: 'AGENTS.md', content: agentsMd(config, capabilityHints) },
        { relPath: 'CLAUDE.md', content: claudeMd(config, capabilityHints) },
      ],
      { force: opts.force, backupRoot: join(cwd, config.storage.dir, 'backups') }
    )

    // Agent files are USER-OWNED. Without --force they are created when
    // missing and never touched again; --force regenerates them, backing up
    // the previous content first. `opts.claudeAgentModels` is only ever set
    // when the caller (currently `ahk build --force`, see build.ts) collects
    // fresh per-role models via `promptClaudeAgentModels` — a plain build
    // never sets it, so this is `undefined` (no model line) exactly as before.
    const agents = writeAgentFiles(
      cwd,
      claudeAgentFiles(config, opts.claudeAgentModels, capabilityHints),
      {
        force: opts.force,
        backupRoot: join(cwd, config.storage.dir, 'backups'),
      }
    )

    // MCP config: always merge. Re-detecting the package manager on every
    // build means a stale/hardcoded command self-corrects the next time the
    // user runs `ahk build`, even if they switched package managers after
    // the initial `ahk init` — no separate migration flag needed.
    mergeClaudeMcpJson(
      join(cwd, '.mcp.json'),
      config.tools.mcp.port,
      cwd,
      detectPackageManager(cwd)
    )
    mergeClaudeSettingsJson(join(cwd, '.claude/settings.json'))
    mergeClaudeSettingsLocalJson(join(cwd, '.claude/settings.local.json'))
    writeSkills(
      cwd,
      '.claude/skills',
      renderDelegationGuidance('claude-code', 'coordination-skill')
    )

    return { agents, derived }
  }

  async migrate(config: HarnessConfig, _to: Provider, _cwd: string): Promise<void> {
    void config
    // Migration from claude-code is handled by the target materializer
  }

  /**
   * No-op by design.
   *
   * This used to rewrite the `tools:` frontmatter block of every agent file,
   * re-injecting the canonical `mcp__agent-harness-kit__*` allowlist. Agent
   * files no longer declare `tools` at all: they inherit the full tool set
   * (Task and every MCP tool included) and express restrictions as a
   * `disallowedTools` denylist instead.
   *
   * Keeping the old rewrite alive would be actively harmful — on a project
   * upgraded from an older version, whose agent files still carry a legacy
   * `tools:` block, it would re-inject the allowlist and silently undo the
   * migration on exactly the files that most need it. Run `ahk build` to
   * regenerate agent files in the current shape.
   */
  async syncPermissions(_cwd: string): Promise<void> {
    console.log('  Agent files inherit tools and declare a disallowedTools denylist —')
    console.log('  there is no permission allowlist to sync. Run `ahk build` to regenerate them.')
  }
}
