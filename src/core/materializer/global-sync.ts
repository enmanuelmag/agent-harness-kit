import { homedir } from 'node:os'

import {
  generateExpectedAgentContent,
  getGlobalDoctorStatus,
  getGlobalProviderAgentDir,
  getGlobalProviderSkillsDir,
} from '@/core/doctor'
import { writeAgentFile, writeSkill } from '@/core/materializer/scaffold-utils'

import type { AgentName } from '@/core/doctor'
import type { HarnessConfig, Provider } from '@/types'

export interface GlobalSyncResult {
  /** true when every global agent/skill file was already present and matched. */
  alreadySynced: boolean
  createdAgents: string[]
  createdSkills: string[]
}

/**
 * Synchronizes provider agents/skills into the user's home directory
 * (`~/.claude`, `~/.codex` + `~/.agents/skills`, `~/.config/opencode`) when
 * `storage.scope === 'global'`. Reuses getGlobalDoctorStatus() for detection
 * (missing/outdated/ok) — this module never re-implements the comparison
 * logic, it only decides WHAT to write based on that status and performs the
 * write via the existing writeAgentFile/writeSkill preserve-if-exists
 * helpers, so running `ahk init --storage-scope global` from multiple
 * projects never duplicates or clobbers already-synced global files.
 *
 * `outdated` files are intentionally left untouched — same "preserve dev
 * customizations" policy already used by the project-local scaffold flow.
 * Only `missing` files are created.
 */
export async function syncGlobalAgentsAndSkills(
  config: HarnessConfig,
  provider: Provider,
  homeDir: string = homedir()
): Promise<GlobalSyncResult> {
  const status = await getGlobalDoctorStatus(provider, config, homeDir)
  const missingAgents = status.agents.filter((a) => a.status === 'missing')
  const missingSkills = status.skills.filter((s) => s.status === 'missing')

  if (missingAgents.length === 0 && missingSkills.length === 0) {
    return { alreadySynced: true, createdAgents: [], createdSkills: [] }
  }

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

  const createdAgents: string[] = []
  if (missingAgents.length > 0) {
    const { agentsDir, ext } = getGlobalProviderAgentDir(provider, homeDir)
    for (const agent of missingAgents) {
      const name = agent.name as AgentName
      const content = generateExpectedAgentContent(name, provider, {
        projectName,
        allowedPaths,
        writablePaths,
        model: models[name],
      })
      writeAgentFile(agentsDir, `${name}${ext}`, content)
      createdAgents.push(name)
    }
  }

  const createdSkills: string[] = []
  if (missingSkills.length > 0) {
    const skillsDir = getGlobalProviderSkillsDir(provider, homeDir)
    for (const skill of missingSkills) {
      writeSkill(skillsDir, skill.name)
      createdSkills.push(skill.name)
    }
  }

  return { alreadySynced: false, createdAgents, createdSkills }
}
