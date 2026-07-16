import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadConfig } from '@/core/config'
import {
  agentBuilder,
  agentBuilderToml,
  agentConsultant,
  agentConsultantToml,
  agentExplorer,
  agentExplorerToml,
  agentLead,
  agentLeadToml,
  agentReviewer,
  agentReviewerToml,
  translateFrontmatterForClaudeCode,
  translateFrontmatterForOpenCode,
} from '@/core/materializer/templates'
import { pkg } from '@/core/package-data'

import type { HarnessConfig } from '@/types'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LibStatus {
  current: string
  latest: string | null // null = couldn't fetch (offline)
  outdated: boolean
}

export interface AgentStatus {
  name: string
  status: 'ok' | 'missing' | 'outdated'
}

export interface SkillStatus {
  name: string
  status: 'ok' | 'missing' | 'outdated'
}

export interface DoctorStatus {
  lib: LibStatus
  agents: AgentStatus[]
  skills: SkillStatus[]
}

// ─── Constants ────────────────────────────────────────────────────────────────

const REGISTRY_URL = `https://registry.npmjs.org/${pkg.name}/latest`
const TIMEOUT_MS = 2000
const LIB_VERSION_CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes
const AGENT_NAMES = ['lead', 'explorer', 'consultant', 'builder', 'reviewer'] as const
export type AgentName = (typeof AGENT_NAMES)[number]
const SKILL_NAMES = ['ahk-ask', 'ahk-consultant', 'ahk-triage', 'ahk-review'] as const

const __dirname = dirname(fileURLToPath(import.meta.url))

// ─── Lib version check ────────────────────────────────────────────────────────

// In-memory TTL cache for the npm registry lookup only. Agent/skill file checks
// are local and cheap, so they are intentionally NOT cached — only the network
// call to the npm registry benefits from memoization.
let libVersionCache: { status: LibStatus; fetchedAt: number } | null = null

/** Clears the in-memory lib version cache. Exposed for tests only. */
export function __resetLibVersionCacheForTests(): void {
  libVersionCache = null
}

async function checkLibVersion(): Promise<LibStatus> {
  const current = pkg.version

  if (libVersionCache && Date.now() - libVersionCache.fetchedAt < LIB_VERSION_CACHE_TTL_MS) {
    // Cache is keyed to the running process's current version. If somehow the
    // running version changed (unlikely mid-process), fall through to refetch.
    if (libVersionCache.status.current === current) {
      return libVersionCache.status
    }
  }

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

    const res = await fetch(REGISTRY_URL, { signal: controller.signal })
    clearTimeout(timer)

    const data = (await res.json()) as { version: string }
    const latest = data.version
    const outdated = isNewer(latest, current)
    const status: LibStatus = { current, latest, outdated }
    libVersionCache = { status, fetchedAt: Date.now() }
    return status
  } catch {
    const status: LibStatus = { current, latest: null, outdated: false }
    // Cache the offline result too, so repeated calls within the TTL don't
    // keep retrying a network call that just timed out/failed.
    libVersionCache = { status, fetchedAt: Date.now() }
    return status
  }
}

function isNewer(latest: string, current: string): boolean {
  const toNum = (v: string) => v.split('.').map(Number)
  const [lMaj, lMin, lPat] = toNum(latest)
  const [cMaj, cMin, cPat] = toNum(current)
  if (lMaj !== cMaj) return lMaj > cMaj
  if (lMin !== cMin) return lMin > cMin
  return lPat > cPat
}

// ─── Agent file check ─────────────────────────────────────────────────────────

function getProviderAgentInfo(provider: string): {
  agentsDir: string
  ext: string
} {
  switch (provider) {
    case 'claude-code':
      return { agentsDir: '.claude/agents', ext: '.md' }
    case 'opencode':
      return { agentsDir: '.opencode/agents', ext: '.md' }
    case 'codex-cli':
      return { agentsDir: '.codex/agents', ext: '.toml' }
    default:
      return { agentsDir: '.claude/agents', ext: '.md' }
  }
}

export function generateExpectedAgentContent(
  agentName: AgentName,
  provider: string,
  vars: { projectName: string; allowedPaths: string; writablePaths: string; model?: string }
): string {
  const { projectName, allowedPaths, writablePaths, model } = vars

  if (provider === 'claude-code') {
    const templateFns = {
      lead: () => agentLead({ projectName }),
      explorer: () => agentExplorer({ projectName, allowedPaths }),
      consultant: () => agentConsultant({ projectName }),
      builder: () => agentBuilder({ projectName, writablePaths }),
      reviewer: () => agentReviewer({ projectName }),
    }
    return translateFrontmatterForClaudeCode(templateFns[agentName](), agentName, model)
  }

  if (provider === 'opencode') {
    const templateFns = {
      lead: () => agentLead({ projectName }),
      explorer: () => agentExplorer({ projectName, allowedPaths }),
      consultant: () => agentConsultant({ projectName }),
      builder: () => agentBuilder({ projectName, writablePaths }),
      reviewer: () => agentReviewer({ projectName }),
    }
    // OpenCode never receives a model override — no injection for this provider.
    return translateFrontmatterForOpenCode(templateFns[agentName]())
  }

  // codex-cli: TOML format
  const tomlFns = {
    lead: () => agentLeadToml({ projectName, model }),
    explorer: () => agentExplorerToml({ projectName, allowedPaths, model }),
    consultant: () => agentConsultantToml({ projectName, model }),
    builder: () => agentBuilderToml({ projectName, writablePaths, model }),
    reviewer: () => agentReviewerToml({ projectName, model }),
  }
  return tomlFns[agentName]()
}

// Root-based comparison — shared by both the project-local (cwd) and global
// (homeDir) checks. Callers resolve `agentsRoot` to an absolute directory;
// this function never derives paths on its own, so there is exactly ONE
// place that compares live vs. expected agent content.
function checkAgentFilesAtRoot(
  agentsRoot: string,
  ext: string,
  provider: string,
  projectName: string,
  allowedPaths: string,
  writablePaths: string,
  models: Partial<Record<AgentName, string | undefined>>
): AgentStatus[] {
  return AGENT_NAMES.map((name) => {
    const filePath = join(agentsRoot, `${name}${ext}`)

    if (!existsSync(filePath)) {
      return { name, status: 'missing' as const }
    }

    try {
      const live = readFileSync(filePath, 'utf8')
      const expected = generateExpectedAgentContent(name, provider, {
        projectName,
        allowedPaths,
        writablePaths,
        model: models[name],
      })
      return { name, status: live === expected ? 'ok' as const : 'outdated' as const }
    } catch {
      return { name, status: 'outdated' as const }
    }
  })
}

function checkAgentFiles(
  cwd: string,
  provider: string,
  projectName: string,
  allowedPaths: string,
  writablePaths: string,
  models: Partial<Record<AgentName, string | undefined>>
): AgentStatus[] {
  const { agentsDir, ext } = getProviderAgentInfo(provider)
  return checkAgentFilesAtRoot(
    join(cwd, agentsDir),
    ext,
    provider,
    projectName,
    allowedPaths,
    writablePaths,
    models
  )
}

// ─── Skill check ─────────────────────────────────────────────────────────────

function getProviderSkillsDir(provider: string): string {
  switch (provider) {
    case 'claude-code':
      return '.claude/skills'
    case 'opencode':
      return '.opencode/skills'
    case 'codex-cli':
      return '.agents/skills'
    default:
      return '.claude/skills'
  }
}

// Root-based comparison — shared by both the project-local (cwd) and global
// (homeDir) checks. `skillsRoot` is an absolute directory already resolved
// by the caller.
function checkSkillsAtRoot(skillsRoot: string): SkillStatus[] {
  // Skills are in src/core/materializer/skills/ — at runtime dist/core/materializer/skills/
  const skillSourceBase = join(__dirname, 'skills')

  return SKILL_NAMES.map((name) => {
    const livePath = join(skillsRoot, name, 'SKILL.md')
    const sourcePath = join(skillSourceBase, name, 'SKILL.md')

    if (!existsSync(livePath)) {
      return { name, status: 'missing' as const }
    }

    try {
      const live = readFileSync(livePath, 'utf8')
      const source = readFileSync(sourcePath, 'utf8')
      return { name, status: live === source ? 'ok' : 'outdated' }
    } catch {
      return { name, status: 'outdated' as const }
    }
  })
}

function checkSkills(cwd: string, provider: string): SkillStatus[] {
  const skillsDir = getProviderSkillsDir(provider)
  return checkSkillsAtRoot(join(cwd, skillsDir))
}

// ─── Global (per-provider, home dir) resolution ────────────────────────────────
//
// Project-local paths (getProviderAgentInfo / getProviderSkillsDir above) are
// always relative to the project cwd. Global paths live under the user's home
// dir and, for some providers, do NOT mirror the local layout 1:1 — most
// notably Codex CLI, whose skills live in a namespace separate from its
// agents (`~/.agents/skills`, not `~/.codex/skills`). These functions must
// stay independent of getProviderAgentInfo/getProviderSkillsDir rather than
// deriving from them, since the local and global layouts genuinely differ
// (e.g. OpenCode's global agents dir is XDG-style `~/.config/opencode/agents`,
// not `~/.opencode/agents`).

export function getGlobalProviderAgentDir(
  provider: string,
  homeDir: string
): { agentsDir: string; ext: string } {
  switch (provider) {
    case 'claude-code':
      return { agentsDir: join(homeDir, '.claude', 'agents'), ext: '.md' }
    case 'opencode':
      return { agentsDir: join(homeDir, '.config', 'opencode', 'agents'), ext: '.md' }
    case 'codex-cli':
      return { agentsDir: join(homeDir, '.codex', 'agents'), ext: '.toml' }
    default:
      return { agentsDir: join(homeDir, '.claude', 'agents'), ext: '.md' }
  }
}

export function getGlobalProviderSkillsDir(provider: string, homeDir: string): string {
  switch (provider) {
    case 'claude-code':
      return join(homeDir, '.claude', 'skills')
    case 'opencode':
      return join(homeDir, '.config', 'opencode', 'skills')
    case 'codex-cli':
      // Codex CLI namespace split: agents live under ~/.codex/agents, but
      // skills live under ~/.agents/skills — NOT ~/.codex/skills. Mirrors the
      // project-local convention already used by getProviderSkillsDir().
      return join(homeDir, '.agents', 'skills')
    default:
      return join(homeDir, '.claude', 'skills')
  }
}

export interface GlobalDoctorStatus {
  agents: AgentStatus[]
  skills: SkillStatus[]
}

/**
 * Global counterpart to getDoctorStatus() — reuses the same comparison logic
 * (checkAgentFilesAtRoot / checkSkillsAtRoot / generateExpectedAgentContent)
 * against a root resolved from `homeDir` instead of the project cwd. Never
 * mutates the filesystem — detection only.
 */
export async function getGlobalDoctorStatus(
  provider: string,
  config: HarnessConfig,
  homeDir: string = homedir()
): Promise<GlobalDoctorStatus> {
  const projectName = config.project.name
  const allowedPaths = (config.agents.explorer.allowedPaths ?? []).join(', ')
  const writablePaths = (config.agents.builder.writablePaths ?? []).join(', ')
  const models: Partial<Record<AgentName, string | undefined>> = {
    lead: config.agents.lead.model,
    explorer: config.agents.explorer.model,
    consultant: config.agents.consultant?.model,
    builder: config.agents.builder.model,
    reviewer: config.agents.reviewer.model,
  }

  const { agentsDir, ext } = getGlobalProviderAgentDir(provider, homeDir)
  const agents = checkAgentFilesAtRoot(
    agentsDir,
    ext,
    provider,
    projectName,
    allowedPaths,
    writablePaths,
    models
  )

  const skillsDir = getGlobalProviderSkillsDir(provider, homeDir)
  const skills = checkSkillsAtRoot(skillsDir)

  return { agents, skills }
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function getDoctorStatus(cwd: string): Promise<DoctorStatus> {
  const lib = await checkLibVersion()

  let config
  try {
    config = await loadConfig(cwd)
  } catch {
    // Config not found — return minimal status with empty agent/skill checks
    return {
      lib,
      agents: [],
      skills: [],
    }
  }

  const provider = config.provider
  const projectName = config.project.name
  const allowedPaths = (config.agents.explorer.allowedPaths ?? []).join(', ')
  const writablePaths = (config.agents.builder.writablePaths ?? []).join(', ')
  const models: Partial<Record<AgentName, string | undefined>> = {
    lead: config.agents.lead.model,
    explorer: config.agents.explorer.model,
    consultant: config.agents.consultant?.model,
    builder: config.agents.builder.model,
    reviewer: config.agents.reviewer.model,
  }

  const agents = checkAgentFiles(cwd, provider, projectName, allowedPaths, writablePaths, models)
  const skills = checkSkills(cwd, provider)

  return { lib, agents, skills }
}
