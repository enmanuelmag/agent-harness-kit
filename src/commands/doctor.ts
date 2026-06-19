import pc from 'picocolors'

import { loadConfig } from '@/core/config'
import { getDoctorStatus } from '@/core/doctor'

import type { AgentStatus, SkillStatus } from '@/core/doctor'

// ─── Formatting helpers ───────────────────────────────────────────────────────

function ok(label: string, detail: string): void {
  console.log(`  ${pc.cyan(label.padEnd(16))}${pc.green('[✓]')} ${detail}`)
}

function warn(label: string, detail: string, hint?: string): void {
  console.log(`  ${pc.cyan(label.padEnd(16))}${pc.yellow('[!]')} ${detail}`)
  if (hint) {
    console.log(`  ${''.padEnd(16)}    ${pc.dim(hint)}`)
  }
}

function neutral(label: string, detail: string): void {
  console.log(`  ${pc.cyan(label.padEnd(16))}${pc.dim('[~]')} ${detail}`)
}

// ─── Section formatters ───────────────────────────────────────────────────────

function printLibSection(lib: { current: string; latest: string | null; outdated: boolean }): void {
  if (lib.latest === null) {
    neutral('lib version', `${lib.current} (unknown — could not reach npm registry)`)
  } else if (lib.outdated) {
    warn(
      'lib version',
      `${lib.current} → ${lib.latest} available`,
      `run: npm i @cardor/agent-harness-kit@latest && ahk build`
    )
  } else {
    ok('lib version', `${lib.current} (up to date)`)
  }
}

function printAgentsSection(agents: AgentStatus[]): void {
  if (agents.length === 0) {
    warn('agent files', 'no config found — run: ahk init')
    return
  }

  const missing = agents.filter((a) => a.status === 'missing')
  const outdated = agents.filter((a) => a.status === 'outdated')

  if (missing.length === 0 && outdated.length === 0) {
    ok('agent files', 'all up to date')
    return
  }

  for (const agent of missing) {
    warn('agent files', `${agent.name} missing`, 'run: ahk build')
  }
  for (const agent of outdated) {
    warn('agent files', `${agent.name} outdated`, 'run: ahk build')
  }
}

function printSkillsSection(skills: SkillStatus[]): void {
  if (skills.length === 0) {
    warn('harness skills', 'no config found — run: ahk init')
    return
  }

  const issues = skills.filter((s) => s.status !== 'ok')
  if (issues.length === 0) {
    ok('harness skills', 'all present and up to date')
    return
  }

  for (const skill of issues) {
    const detail =
      skill.status === 'missing' ? `${skill.name} missing` : `${skill.name} outdated`
    warn('harness skills', detail, 'run: ahk build')
  }
}

// ─── Main command ─────────────────────────────────────────────────────────────

export async function runDoctor(cwd: string): Promise<void> {
  // Check for config first so we can give a helpful upfront message
  let configFound = true
  try {
    await loadConfig(cwd)
  } catch {
    configFound = false
  }

  console.log('')
  console.log(pc.bold(`● ahk doctor ` + '─'.repeat(44)))
  console.log('')

  const status = await getDoctorStatus(cwd)

  printLibSection(status.lib)

  if (!configFound) {
    console.log('')
    warn('config', 'no agent-harness-kit.config found', 'run: ahk init')
    console.log('')
    return
  }

  console.log('')
  printAgentsSection(status.agents)

  console.log('')
  printSkillsSection(status.skills)

  console.log('')
}
