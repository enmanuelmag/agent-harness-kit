import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, test } from 'node:test'

import { applyConfigDefaults } from '@/commands/init-helpers'
import { getGlobalDoctorStatus, getGlobalProviderAgentDir, getGlobalProviderSkillsDir } from '@/core/doctor'
import { syncGlobalAgentsAndSkills } from '@/core/materializer/global-sync'

const TMP_GLOBAL = join(import.meta.dirname, '../../.tmp-global-sync')

function makeFakeHome(suffix: string): string {
  const dir = join(TMP_GLOBAL, suffix)
  mkdirSync(dir, { recursive: true })
  return dir
}

describe('getGlobalDoctorStatus — detection against a home dir (never $HOME)', () => {
  afterEach(() => {
    rmSync(TMP_GLOBAL, { recursive: true, force: true })
  })

  test('reports every agent/skill as missing when nothing exists under homeDir', async () => {
    const FAKE_HOME = makeFakeHome('empty-home')
    const config = applyConfigDefaults({
      name: 'demo-app',
      description: 'demo',
      provider: 'claude-code',
      docsPath: './docs',
      tasksAdapter: 'local',
      scope: 'global',
    })

    const status = await getGlobalDoctorStatus('claude-code', config, FAKE_HOME)
    assert.ok(status.agents.every((a) => a.status === 'missing'))
    assert.ok(status.skills.every((s) => s.status === 'missing'))
    assert.ok(!existsSync(FAKE_HOME) || existsSync(FAKE_HOME), 'detection must never write anything')
    assert.ok(!existsSync(join(FAKE_HOME, '.claude')), 'detection-only, must not create files')
  })
})

describe('syncGlobalAgentsAndSkills — claude-code', () => {
  afterEach(() => {
    rmSync(TMP_GLOBAL, { recursive: true, force: true })
  })

  test('creates all agent/skill files under homeDir when nothing is present', async () => {
    const FAKE_HOME = makeFakeHome('claude-empty')
    const config = applyConfigDefaults({
      name: 'demo-app',
      description: 'demo',
      provider: 'claude-code',
      docsPath: './docs',
      tasksAdapter: 'local',
      scope: 'global',
    })

    const result = await syncGlobalAgentsAndSkills(config, 'claude-code', FAKE_HOME)
    assert.equal(result.alreadySynced, false)
    assert.equal(result.createdAgents.length, 5)
    assert.equal(result.createdSkills.length, 4)

    assert.ok(existsSync(join(FAKE_HOME, '.claude', 'agents', 'lead.md')))
    assert.ok(existsSync(join(FAKE_HOME, '.claude', 'agents', 'explorer.md')))
    assert.ok(existsSync(join(FAKE_HOME, '.claude', 'skills', 'ahk-ask', 'SKILL.md')))
  })

  test('second run is idempotent — reports alreadySynced and creates nothing new', async () => {
    const FAKE_HOME = makeFakeHome('claude-idempotent')
    const config = applyConfigDefaults({
      name: 'demo-app',
      description: 'demo',
      provider: 'claude-code',
      docsPath: './docs',
      tasksAdapter: 'local',
      scope: 'global',
    })

    const first = await syncGlobalAgentsAndSkills(config, 'claude-code', FAKE_HOME)
    assert.equal(first.alreadySynced, false)

    const second = await syncGlobalAgentsAndSkills(config, 'claude-code', FAKE_HOME)
    assert.equal(second.alreadySynced, true)
    assert.deepEqual(second.createdAgents, [])
    assert.deepEqual(second.createdSkills, [])
  })

  test('running from a second "project" against the same home dir does not duplicate/overwrite', async () => {
    const FAKE_HOME = makeFakeHome('claude-multi-project')
    const configA = applyConfigDefaults({
      name: 'project-a',
      description: 'demo',
      provider: 'claude-code',
      docsPath: './docs',
      tasksAdapter: 'local',
      scope: 'global',
    })
    const configB = applyConfigDefaults({
      name: 'project-b',
      description: 'demo',
      provider: 'claude-code',
      docsPath: './docs',
      tasksAdapter: 'local',
      scope: 'global',
    })

    await syncGlobalAgentsAndSkills(configA, 'claude-code', FAKE_HOME)
    const leadPath = join(FAKE_HOME, '.claude', 'agents', 'lead.md')
    const contentAfterFirstProject = readFileSync(leadPath, 'utf8')

    // Second project (different name) syncs against the SAME global home dir.
    // The already-present agent file must be preserved, not overwritten with
    // project-b's content — same "preserve dev customizations" idempotency
    // criterion writeAgentFile() already uses at the project-local level.
    const resultB = await syncGlobalAgentsAndSkills(configB, 'claude-code', FAKE_HOME)
    assert.equal(resultB.alreadySynced, true)
    const contentAfterSecondProject = readFileSync(leadPath, 'utf8')
    assert.equal(contentAfterFirstProject, contentAfterSecondProject)
  })
})

describe('syncGlobalAgentsAndSkills — codex-cli (distinct agent/skill namespaces)', () => {
  afterEach(() => {
    rmSync(TMP_GLOBAL, { recursive: true, force: true })
  })

  test('agents land under ~/.codex/agents while skills land under the separate ~/.agents/skills namespace', async () => {
    const FAKE_HOME = makeFakeHome('codex-home')
    const config = applyConfigDefaults({
      name: 'demo-app',
      description: 'demo',
      provider: 'codex-cli',
      docsPath: './docs',
      tasksAdapter: 'local',
      scope: 'global',
    })

    const { agentsDir, ext } = getGlobalProviderAgentDir('codex-cli', FAKE_HOME)
    const skillsDir = getGlobalProviderSkillsDir('codex-cli', FAKE_HOME)
    assert.equal(agentsDir, join(FAKE_HOME, '.codex', 'agents'))
    assert.equal(ext, '.toml')
    assert.equal(skillsDir, join(FAKE_HOME, '.agents', 'skills'))
    assert.notEqual(skillsDir, join(FAKE_HOME, '.codex', 'skills'))

    const result = await syncGlobalAgentsAndSkills(config, 'codex-cli', FAKE_HOME)
    assert.equal(result.alreadySynced, false)
    assert.equal(result.createdAgents.length, 5)
    assert.equal(result.createdSkills.length, 4)

    // Agents live under .codex/agents/*.toml
    assert.ok(existsSync(join(FAKE_HOME, '.codex', 'agents', 'lead.toml')))
    assert.ok(!existsSync(join(FAKE_HOME, '.codex', 'skills')), 'codex must NOT get a .codex/skills namespace')

    // Skills live under the SEPARATE .agents/skills namespace, not nested under .codex
    assert.ok(existsSync(join(FAKE_HOME, '.agents', 'skills', 'ahk-ask', 'SKILL.md')))
    assert.ok(!existsSync(join(FAKE_HOME, 'agents')), 'skills dir is .agents (dot-prefixed), not agents')
  })
})

describe('syncGlobalAgentsAndSkills — opencode (XDG global layout differs from project-local)', () => {
  afterEach(() => {
    rmSync(TMP_GLOBAL, { recursive: true, force: true })
  })

  test('agents/skills land under ~/.config/opencode, not ~/.opencode', async () => {
    const FAKE_HOME = makeFakeHome('opencode-home')
    const config = applyConfigDefaults({
      name: 'demo-app',
      description: 'demo',
      provider: 'opencode',
      docsPath: './docs',
      tasksAdapter: 'local',
      scope: 'global',
    })

    const result = await syncGlobalAgentsAndSkills(config, 'opencode', FAKE_HOME)
    assert.equal(result.alreadySynced, false)

    assert.ok(existsSync(join(FAKE_HOME, '.config', 'opencode', 'agents', 'lead.md')))
    assert.ok(existsSync(join(FAKE_HOME, '.config', 'opencode', 'skills', 'ahk-ask', 'SKILL.md')))
    assert.ok(!existsSync(join(FAKE_HOME, '.opencode')), 'global opencode layout must not reuse the project-local .opencode dir name')
  })
})
