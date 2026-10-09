import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'

import {
  choicesFromPreferences,
  mergePreferences,
  missingPreferenceRoles,
  persistPreferences,
  toPreferences,
} from '@/commands/agent-preferences'
import { runBuild } from '@/commands/build'
import { captureModels, runSync } from '@/commands/sync'
import { pkg } from '@/core/package-data'
import { __configureUpdateCheckForTests, __resetUpdateCacheForTests } from '@/core/update-check'

const TMP = join(import.meta.dirname, '../../.tmp-agent-preferences-test')
afterEach(() => rmSync(TMP, { recursive: true, force: true }))

function writeConfig(ext: 'json' | 'cjs' = 'json', provider = 'codex-cli'): string {
  mkdirSync(TMP, { recursive: true })
  const config = { provider, project: { name: 'test', description: 'test', docsPath: './docs' }, untouched: { preserve: true } }
  const path = join(TMP, `agent-harness-kit.config.${ext}`)
  writeFileSync(path, ext === 'json' ? JSON.stringify(config, null, 2) : `module.exports = ${JSON.stringify(config)}\n`)
  return path
}

test('preferences preserve explicit inherit and clear stale effort when replaced', () => {
  const initial = { 'codex-cli': { builder: { model: 'gpt-x', reasoningEffort: 'high' } } }
  const merged = mergePreferences(initial, toPreferences('codex-cli', { builder: {} }))
  assert.deepEqual(merged['codex-cli']?.builder, { model: 'inherit' })
})

test('stored preferences convert back to native choices without emitting inherit', () => {
  const values = choicesFromPreferences({ provider: 'codex-cli', agentPreferences: { 'codex-cli': { lead: { model: 'inherit' } } } } as never)
  assert.deepEqual(values.codexAgentModels?.lead, {})
})

test('effort-only Claude and Codex choices round-trip with inherited model', () => {
  assert.deepEqual(toPreferences('claude-code', { lead: { effort: 'high' } })['claude-code']?.lead, { model: 'inherit', reasoningEffort: 'high' })
  const claude = choicesFromPreferences({ provider: 'claude-code', agentPreferences: { 'claude-code': { lead: { model: 'inherit', reasoningEffort: 'high' } } } } as never)
  assert.deepEqual(claude.claudeAgentModels?.lead, { effort: 'high' })
  const codex = choicesFromPreferences({ provider: 'codex-cli', agentPreferences: { 'codex-cli': { lead: { model: 'inherit', reasoningEffort: 'high' } } } } as never)
  assert.deepEqual(codex.codexAgentModels?.lead, { effort: 'high' })
})

test('explicit inherit is complete whereas an absent role is a gap', () => {
  const config = { provider: 'claude-code', agentPreferences: { 'claude-code': { lead: { model: 'inherit' } } } } as never
  assert.ok(!missingPreferenceRoles(config).includes('lead'))
  assert.ok(missingPreferenceRoles(config).includes('builder'))
})

test('JSON persistence atomically merges preferences and preserves raw root keys', async () => {
  const path = writeConfig()
  await persistPreferences(TMP, { 'codex-cli': { builder: { model: 'gpt-test', reasoningEffort: 'high' } } })
  const saved = JSON.parse(readFileSync(path, 'utf8'))
  assert.deepEqual(saved.untouched, { preserve: true })
  assert.deepEqual(saved.agentPreferences['codex-cli'].builder, { model: 'gpt-test', reasoningEffort: 'high' })
})

test('code config is never rewritten and reports manual update required', async () => {
  const path = writeConfig('cjs')
  const before = readFileSync(path, 'utf8')
  assert.equal(await persistPreferences(TMP, { 'codex-cli': { lead: { model: 'inherit' } } }), 'manual-update-required')
  assert.equal(readFileSync(path, 'utf8'), before)
})

test('capture imports current-provider canonical TOML metadata and ignores default agent', async () => {
  const path = writeConfig()
  mkdirSync(join(TMP, '.codex/agents'), { recursive: true })
  for (const role of ['lead', 'explorer', 'consultant', 'builder', 'reviewer']) {
    writeFileSync(join(TMP, `.codex/agents/${role}.toml`), `model = "gpt-${role}"\nmodel_reasoning_effort = "medium"\n[agent]\nname = "${role}"\n`)
  }
  writeFileSync(join(TMP, '.codex/agents/default.toml'), 'model = "ignored"\n')
  await captureModels(TMP)
  const saved = JSON.parse(readFileSync(path, 'utf8'))
  assert.equal(saved.agentPreferences['codex-cli'].lead.model, 'gpt-lead')
  assert.equal(saved.agentPreferences['codex-cli'].builder.reasoningEffort, 'medium')
  assert.ok(existsSync(join(TMP, '.codex/agents/default.toml')))
})

test('capture rejects duplicate authoritative Codex role names', async () => {
  const path = writeConfig()
  mkdirSync(join(TMP, '.codex/agents'), { recursive: true })
  for (const role of ['lead', 'explorer', 'consultant', 'builder', 'reviewer']) {
    const names = role === 'lead' ? 'name = "lead"\nname = "lead"\n' : `name = "${role}"\n`
    writeFileSync(join(TMP, `.codex/agents/${role}.toml`), `model = "gpt-${role}"\n[agent]\n${names}`)
  }
  await captureModels(TMP)
  const saved = JSON.parse(readFileSync(path, 'utf8'))
  assert.equal(saved.agentPreferences['codex-cli'].lead, undefined)
  assert.equal(saved.agentPreferences['codex-cli'].builder.model, 'gpt-builder')
})

for (const provider of ['claude-code', 'cursor'] as const) {
  test(`capture rejects duplicate authoritative YAML role names for ${provider}`, async () => {
    const path = writeConfig('json', provider)
    const agentDir = provider === 'claude-code' ? '.claude/agents' : '.cursor/agents'
    mkdirSync(join(TMP, agentDir), { recursive: true })
    for (const role of ['lead', 'explorer', 'consultant', 'builder', 'reviewer']) {
      const names = role === 'lead' ? 'name: lead\nname: lead' : `name: ${role}`
      writeFileSync(join(TMP, agentDir, `${role}.md`), `---\n${names}\nmodel: ${provider}-${role}\n---\n`)
    }
    await captureModels(TMP)
    const saved = JSON.parse(readFileSync(path, 'utf8'))
    assert.equal(saved.agentPreferences[provider].lead, undefined)
    assert.equal(saved.agentPreferences[provider].builder.model, `${provider}-builder`)
  })
}

test('sync rejects ambiguous flags before touching configuration', async () => {
  await assert.rejects(() => runSync(TMP, { keepModels: true }), /requires --force/)
  await assert.rejects(() => runSync(TMP, { captureModels: true, force: true }), /cannot be combined/)
})

test('safe sync creates missing agents from saved choices without prompting', async () => {
  const path = writeConfig()
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  raw.agentPreferences = { 'codex-cli': { lead: { model: 'gpt-safe', reasoningEffort: 'medium' } } }
  writeFileSync(path, JSON.stringify(raw, null, 2))
  await runSync(TMP, {})
  assert.match(readFileSync(join(TMP, '.codex/agents/lead.toml'), 'utf8'), /model = "gpt-safe"/)
})

test('complete keep-models force sync regenerates using saved model and effort', async () => {
  const path = writeConfig()
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  raw.agentPreferences = {
    'codex-cli': Object.fromEntries(['lead', 'explorer', 'consultant', 'builder', 'reviewer'].map((role) => [role, { model: 'gpt-kept', reasoningEffort: 'medium' }])),
  }
  writeFileSync(path, JSON.stringify(raw, null, 2))
  await runSync(TMP, { force: true, keepModels: true })
  assert.match(readFileSync(join(TMP, '.codex/agents/builder.toml'), 'utf8'), /model = "gpt-kept"/)
})

test('runBuild then runSync materialize and preserve the actual skill state across every provider', async () => {
  const original = console.log
  const lines: string[] = []
  console.log = (...values: unknown[]) => lines.push(values.map(String).join(' '))
  __configureUpdateCheckForTests({ fetch: async () => new Response(JSON.stringify({ version: '2.31.0' }), { status: 200 }) })
  try {
    for (const provider of ['claude-code', 'opencode', 'codex-cli', 'grok-cli', 'cursor']) {
      rmSync(TMP, { recursive: true, force: true })
      writeConfig('json', provider)
      await runBuild(TMP, {})
      const firstState = readFileSync(join(TMP, '.harness/skills-state.json'), 'utf8')
      const first = JSON.parse(firstState)
      const key = provider === 'claude-code' ? '_claude_skills' : provider === 'codex-cli' ? '_agents_skills' : provider === 'cursor' ? '_cursor_skills' : provider === 'grok-cli' ? '_grok_skills' : '_opencode_skills'
      assert.equal(first.roots[key].version, pkg.version, `${provider} reports a complete first materialization`)
      assert.ok(Object.keys(first.roots[key].inventory).length > 0, `${provider} records generated skill output`)
      await runSync(TMP, {})
      assert.equal(readFileSync(join(TMP, '.harness/skills-state.json'), 'utf8'), firstState, `${provider} second command is idempotent`)
    }
    assert.equal(lines.some((line) => line.includes('Applied skill migration(s)')), false)
  } finally {
    console.log = original
    __resetUpdateCacheForTests()
  }
})
