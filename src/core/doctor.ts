import { existsSync, readFileSync } from 'node:fs'
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
const AGENT_NAMES = ['lead', 'explorer', 'consultant', 'builder', 'reviewer'] as const
type AgentName = (typeof AGENT_NAMES)[number]
const SKILL_NAMES = ['ahk-ask', 'ahk-consultant', 'ahk-triage'] as const

const __dirname = dirname(fileURLToPath(import.meta.url))

// ─── Lib version check ────────────────────────────────────────────────────────

async function checkLibVersion(): Promise<LibStatus> {
  const current = pkg.version

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

    const res = await fetch(REGISTRY_URL, { signal: controller.signal })
    clearTimeout(timer)

    const data = (await res.json()) as { version: string }
    const latest = data.version
    const outdated = isNewer(latest, current)
    return { current, latest, outdated }
  } catch {
    return { current, latest: null, outdated: false }
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

function generateExpectedAgentContent(
  agentName: AgentName,
  provider: string,
  vars: { projectName: string; allowedPaths: string; writablePaths: string }
): string {
  const { projectName, allowedPaths, writablePaths } = vars

  if (provider === 'claude-code') {
    const templateFns = {
      lead: () => agentLead({ projectName }),
      explorer: () => agentExplorer({ projectName, allowedPaths }),
      consultant: () => agentConsultant({ projectName }),
      builder: () => agentBuilder({ projectName, writablePaths }),
      reviewer: () => agentReviewer({ projectName }),
    }
    return translateFrontmatterForClaudeCode(templateFns[agentName](), agentName)
  }

  if (provider === 'opencode') {
    const templateFns = {
      lead: () => agentLead({ projectName }),
      explorer: () => agentExplorer({ projectName, allowedPaths }),
      consultant: () => agentConsultant({ projectName }),
      builder: () => agentBuilder({ projectName, writablePaths }),
      reviewer: () => agentReviewer({ projectName }),
    }
    return translateFrontmatterForOpenCode(templateFns[agentName]())
  }

  // codex-cli: TOML format
  const tomlFns = {
    lead: () => agentLeadToml({ projectName }),
    explorer: () => agentExplorerToml({ projectName, allowedPaths }),
    consultant: () => agentConsultantToml({ projectName }),
    builder: () => agentBuilderToml({ projectName, writablePaths }),
    reviewer: () => agentReviewerToml({ projectName }),
  }
  return tomlFns[agentName]()
}

function checkAgentFiles(
  cwd: string,
  provider: string,
  projectName: string,
  allowedPaths: string,
  writablePaths: string
): AgentStatus[] {
  const { agentsDir, ext } = getProviderAgentInfo(provider)

  return AGENT_NAMES.map((name) => {
    const filePath = join(cwd, agentsDir, `${name}${ext}`)

    if (!existsSync(filePath)) {
      return { name, status: 'missing' as const }
    }

    try {
      const live = readFileSync(filePath, 'utf8')
      const expected = generateExpectedAgentContent(name, provider, {
        projectName,
        allowedPaths,
        writablePaths,
      })
      return { name, status: live === expected ? 'ok' as const : 'outdated' as const }
    } catch {
      return { name, status: 'outdated' as const }
    }
  })
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

function checkSkills(cwd: string, provider: string): SkillStatus[] {
  const skillsDir = getProviderSkillsDir(provider)
  // Skills are in src/core/materializer/skills/ — at runtime dist/core/materializer/skills/
  const skillSourceBase = join(__dirname, 'materializer', 'skills')

  return SKILL_NAMES.map((name) => {
    const livePath = join(cwd, skillsDir, name, 'SKILL.md')
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

  const agents = checkAgentFiles(cwd, provider, projectName, allowedPaths, writablePaths)
  const skills = checkSkills(cwd, provider)

  return { lib, agents, skills }
}
