import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { openCodeV2ChoiceSchema } from '@/schema/opencode-v2'

import { restrictionFor } from './agent-restrictions'
import { renderDelegationGuidance } from './delegation-guidance'
import { opencodeAgentFiles } from './opencode'
import { prepareOpenCodeV2Config, safeOpenCodePath, writeOpenCodeV2Config } from './opencode-v2-config'
import { buildCapabilityHints } from './provider-research-capabilities'
import { appendGitignore, ensureNativeHealthScaffold, reconcileGeneratedFiles, writeAgentFiles, writeSkills } from './scaffold-utils'
import { agentBuilder, agentConsultant, agentExplorer, agentLead, agentReviewer, agentsMd } from './templates'

import type { AgentName } from './agent-restrictions'
import type { BuildMaterializerOptions, BuildReport, Materializer } from './index'
import type { HarnessConfig, ScaffoldOptions } from '@/types'

export function openCodeV2Permissions(role: AgentName) {
  const rules: { action: string; resource: string; effect: 'allow' | 'deny' | 'ask' }[] = [
    { action: 'edit', resource: '*', effect: restrictionFor(role) === 'no-write' ? 'deny' : 'allow' },
    { action: 'shell', resource: '*', effect: role === 'builder' ? 'ask' : 'deny' },
    { action: 'subagent', resource: '*', effect: 'deny' },
  ]
  if (role === 'lead') for (const child of ['explorer', 'consultant', 'builder', 'reviewer']) rules.push({ action: 'subagent', resource: child, effect: 'allow' })
  if (role !== 'builder') for (const command of ['pwd', 'git status', 'git status --short', 'git diff --no-ext-diff', 'git log -n 20']) rules.push({ action: 'shell', resource: command, effect: 'allow' })
  if (role === 'reviewer') for (const command of ['pnpm test', 'npm test', 'pnpm run typecheck', 'npm run typecheck', 'pnpm run lint:check', 'npm run lint:check', 'pnpm run build', 'npm run build', 'bash health.sh']) rules.push({ action: 'shell', resource: command, effect: 'allow' })
  return rules
}
export function opencodeV2AgentFiles(config: HarnessConfig, choices: ScaffoldOptions['opencodeV2AgentModels'] = {}) {
  const hints = buildCapabilityHints('opencode-v2')
  const factories = { lead: agentLead, explorer: agentExplorer, consultant: agentConsultant, builder: agentBuilder, reviewer: agentReviewer }
  return (Object.entries(factories) as [AgentName, typeof agentLead][]).map(([role, factory]) => {
    const source = factory({ projectName: config.project.name }, hints, role === 'lead' ? renderDelegationGuidance('opencode-v2', 'lead') : '')
    const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
    if (!match) throw new Error(`Missing agent template header: ${role}`)
    const description = match[1].match(/^description:[^\n]*(?:\n[ \t]+[^\n]*)*/m)?.[0]
    if (!description) throw new Error(`Missing agent description: ${role}`)
    const stored = config.agentPreferences?.['opencode-v2']?.[role]
    const choice = openCodeV2ChoiceSchema.parse(choices[role] ?? (stored?.model && stored.model !== 'inherit' ? { model: stored.model } : {}))
    return { relPath: `.opencode/agents/${role}.md`, content: `---\n${description}\nmode: ${role === 'lead' ? 'primary' : 'subagent'}\n${choice.model ? `model: ${JSON.stringify(choice.model)}\n` : ''}permissions: ${JSON.stringify(openCodeV2Permissions(role))}\n---\n${match[2]}` }
  })
}
/** Shared roots require proof of unmodified canonical v1 content before conversion. */
export function preflightOpenCodeV2(config: HarnessConfig, cwd: string, migrateV1 = false) {
  if (!migrateV1 && existsSync(safeOpenCodePath(cwd, '.opencode/plugins/ahk-notifications.js'))) throw new Error('Incompatible v1 notification plugin on shared OpenCode path; migrate or uninstall the owned v1 hook first.')
  const prepared = prepareOpenCodeV2Config(cwd, config, migrateV1)
  const legacy = opencodeAgentFiles({ ...config, provider: 'opencode' }, buildCapabilityHints('opencode'))
  const converted: string[] = []
  for (const entry of opencodeV2AgentFiles(config)) {
    const path = safeOpenCodePath(cwd, entry.relPath)
    if (!existsSync(path)) continue
    const text = readFileSync(path, 'utf8')
    if (/^permissions:/m.test(text.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '')) continue
    if (!migrateV1 || text !== legacy.find(value => value.relPath === entry.relPath)?.content) throw new Error(`Preserved incompatible/customized OpenCode agent: ${entry.relPath}. Resolve the shared v1/v2 path before generation.`)
    converted.push(entry.relPath)
  }
  return { prepared, converted }
}
export class OpenCodeV2Materializer implements Materializer {
  async scaffold(config: HarnessConfig, opts: ScaffoldOptions): Promise<void> {
    // Validate every shared input before any project generation.
    preflightOpenCodeV2(config, opts.cwd)
    await this.build(config, opts.cwd, opts)
    ensureNativeHealthScaffold(opts.cwd)
    appendGitignore(opts.cwd)
  }
  async build(config: HarnessConfig, cwd: string, opts: BuildMaterializerOptions = {}): Promise<BuildReport> {
    const { prepared } = preflightOpenCodeV2(config, cwd)
    const backupRoot = join(cwd, config.storage.dir, 'backups')
    const derived = reconcileGeneratedFiles(cwd, [{ relPath: 'AGENTS.md', content: agentsMd(config, buildCapabilityHints('opencode-v2')) }], { force: opts.force, backupRoot })
    const agents = writeAgentFiles(cwd, opencodeV2AgentFiles(config, opts.opencodeV2AgentModels), { force: opts.force, backupRoot })
    writeOpenCodeV2Config(prepared)
    const skills = writeSkills(cwd, '.opencode/skills', renderDelegationGuidance('opencode-v2', 'coordination-skill'), 'opencode-v2')
    return { agents, derived, skills }
  }
  async migrate(): Promise<void> {}
  async syncPermissions(): Promise<void> {}
}
