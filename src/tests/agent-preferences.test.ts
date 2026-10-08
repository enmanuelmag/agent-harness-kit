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
import { captureModels, runSync } from '@/commands/sync'

const TMP = join(import.meta.dirname, '../../.tmp-agent-preferences-test')
afterEach(() => rmSync(TMP, { recursive: true, force: true }))

function writeConfig(ext: 'json' | 'cjs' = 'json'): string {
  mkdirSync(TMP, { recursive: true })
  const config = { provider: 'codex-cli', project: { name: 'test', description: 'test', docsPath: './docs' }, untouched: { preserve: true } }
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
