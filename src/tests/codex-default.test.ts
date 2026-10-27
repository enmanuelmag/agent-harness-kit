import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { applyConfigDefaults } from '../commands/init-helpers'
import { filesFor } from '../commands/models'
import { getDoctorStatus } from '../core/doctor'
import { captureNativeChoices } from '../core/maintenance/native-model-capture'
import { MaintenanceService } from '../core/maintenance/operations'
import { codexAgentFiles, CodexCliMaterializer } from '../core/materializer/codex-cli'
import { writeAgentFiles } from '../core/materializer/scaffold-utils'

function fixture() {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'ahk-codex-default-')))
  const config = applyConfigDefaults({ name: 'Codex test', description: 'test', provider: 'codex-cli', docsPath: './docs', scope: 'local' })
  writeFileSync(join(cwd, 'agent-harness-kit.config.json'), JSON.stringify(config))
  const service = new MaintenanceService(cwd)
  return { cwd, config, service, async cleanup() { await service.dispose(); rmSync(cwd, { recursive: true, force: true }) } }
}

test('fresh Codex uses five roles and captures the generated flat metadata, ignoring prompt samples', async () => {
  const f = fixture()
  try {
    const choices = { lead: { model: 'gpt-lead', effort: 'medium' }, explorer: { model: 'gpt-explorer' } }
    const entries = codexAgentFiles(f.config, choices)
    writeAgentFiles(f.cwd, entries)
    assert.equal(entries.length, 5)
    assert.equal(filesFor(f.config, choices).length, 5)
    assert.equal(existsSync(join(f.cwd, '.codex/agents/lead.toml')), false)
    assert.match(entries[0].content, /# Lead Agent/)
    assert.match(entries[0].content, /Provider Delegation Guidance/)
    const path = join(f.cwd, '.codex/agents/default.toml')
    writeFileSync(path, readFileSync(path, 'utf8').replace('developer_instructions = """', 'developer_instructions = """\nname = "fake"\nmodel = "fake"\n[agent]'))
    const captured = captureNativeChoices(f.cwd, f.config)
    assert.deepEqual(captured.missing, [])
    assert.deepEqual(captured.choices.lead, choices.lead)
    assert.deepEqual(captured.choices.explorer, choices.explorer)
    const doctor = await getDoctorStatus(f.cwd)
    assert.equal(doctor.agents.find(a => a.name === 'lead')?.status, 'ok')
    const reset = await f.service.execute('reset.plan', { targets: ['lead'] })
    assert.deepEqual(reset.data?.targets, [path])
  } finally { await f.cleanup() }
})

test('canonical default takes precedence and invalid canonical metadata never falls back to legacy', async () => {
  const f = fixture()
  try {
    writeAgentFiles(f.cwd, codexAgentFiles(f.config, { lead: { model: 'canonical' } }))
    const legacy = join(f.cwd, '.codex/agents/lead.toml')
    const canonical = join(f.cwd, '.codex/agents/default.toml')
    writeFileSync(legacy, 'model = "legacy"\n[agent]\nname = "lead"\n')
    assert.deepEqual(captureNativeChoices(f.cwd, f.config).choices.lead, { model: 'canonical' })
    writeFileSync(canonical, 'name = "wrong"\nmodel = "invalid"\n')
    assert.ok(captureNativeChoices(f.cwd, f.config).missing.includes('lead'))
    rmSync(canonical)
    assert.deepEqual(captureNativeChoices(f.cwd, f.config).choices.lead, { model: 'legacy' })
  } finally { await f.cleanup() }
})

test('unforced build preserves both custom files; forced build backs up both then retires legacy', async () => {
  const f = fixture()
  try {
    const materializer = new CodexCliMaterializer()
    await materializer.build(f.config, f.cwd)
    const legacy = '.codex/agents/lead.toml'
    const canonical = '.codex/agents/default.toml'
    writeFileSync(join(f.cwd, legacy), 'custom legacy\n')
    writeFileSync(join(f.cwd, canonical), 'custom default\n')
    const safe = await materializer.build(f.config, f.cwd)
    assert.ok(safe.agents.preserved.includes(legacy))
    assert.equal(readFileSync(join(f.cwd, canonical), 'utf8'), 'custom default\n')
    const forced = await materializer.build(f.config, f.cwd, { force: true, codexAgentModels: { lead: { model: 'saved' } } })
    assert.deepEqual(forced.agents.retired, [legacy])
    assert.equal(readFileSync(join(forced.agents.backupDir!, legacy), 'utf8'), 'custom legacy\n')
    assert.equal(readFileSync(join(forced.agents.backupDir!, canonical), 'utf8'), 'custom default\n')
    assert.equal(existsSync(join(f.cwd, legacy)), false)
    assert.match(readFileSync(join(f.cwd, canonical), 'utf8'), /model = "saved"/)
    assert.equal(readdirSync(join(f.cwd, '.codex/agents')).length, 5)
  } finally { await f.cleanup() }
})

test('retirement backup failure preserves targets and legacy before any agent writes', async () => {
  const f = fixture()
  try {
    writeAgentFiles(f.cwd, codexAgentFiles(f.config))
    const legacy = '.codex/agents/lead.toml'
    const canonical = '.codex/agents/default.toml'
    writeFileSync(join(f.cwd, legacy), 'legacy')
    writeFileSync(join(f.cwd, canonical), 'default')
    const backupRoot = join(f.cwd, 'not-a-directory')
    writeFileSync(backupRoot, 'blocked')
    assert.throws(() => writeAgentFiles(f.cwd, codexAgentFiles(f.config), { force: true, backupRoot, retire: [legacy] }), /Could not back up/)
    assert.equal(readFileSync(join(f.cwd, legacy), 'utf8'), 'legacy')
    assert.equal(readFileSync(join(f.cwd, canonical), 'utf8'), 'default')
  } finally { await f.cleanup() }
})

for (const mutation of ['edit', 'add', 'delete'] as const) {
  test(`sync retirement preview rejects concurrent legacy ${mutation}`, async () => {
    const f = fixture()
    try {
      await new CodexCliMaterializer().build(f.config, f.cwd)
      const legacy = '.codex/agents/lead.toml'
      const path = join(f.cwd, legacy)
      if (mutation !== 'add') writeFileSync(path, 'before')
      const plan = await f.service.execute('sync.plan', { force: true, keepModels: true })
      assert.equal(plan.ok, true)
      assert.deepEqual(plan.data?.retired, mutation === 'add' ? [] : [legacy])
      if (mutation === 'delete') rmSync(path)
      else writeFileSync(path, 'changed')
      const apply = await f.service.execute('sync.apply', { planId: plan.data!.planId })
      assert.equal(apply.code, 'stale_plan')
    } finally { await f.cleanup() }
  })
}

test('forced sync applies retirement and model-only updates preserve legacy', async () => {
  const f = fixture()
  try {
    await new CodexCliMaterializer().build(f.config, f.cwd)
    const legacy = '.codex/agents/lead.toml'
    writeFileSync(join(f.cwd, legacy), 'custom legacy')
    const choices = Object.fromEntries(['lead', 'explorer', 'consultant', 'builder', 'reviewer'].map(role => [role, { model: `saved-${role}` }]))
    const models = await f.service.execute('models', { choices })
    assert.equal(models.ok, true, models.message)
    assert.equal(readFileSync(join(f.cwd, legacy), 'utf8'), 'custom legacy')
    const modelReport = models.data!.report as { overwritten: string[] }
    assert.equal(modelReport.overwritten.filter(path => path.endsWith('/default.toml')).length, 1)
    const plan = await f.service.execute('sync.plan', { force: true, keepModels: true })
    const applied = await f.service.execute('sync.apply', { planId: plan.data!.planId })
    assert.equal(applied.ok, true, applied.message)
    assert.equal(existsSync(join(f.cwd, legacy)), false)
    const report = applied.data!.report as { agents: { retired: string[]; backupDir: string } }
    assert.deepEqual(report.agents.retired, [legacy])
    assert.equal(readFileSync(join(report.agents.backupDir, legacy), 'utf8'), 'custom legacy')
    assert.match(readFileSync(join(f.cwd, '.codex/agents/default.toml'), 'utf8'), /model = "saved-lead"/)
  } finally { await f.cleanup() }
})

for (const metadata of ['name = "default"\nname = "default"', 'name = "default"\nmodel = "one"\nmodel = "two"', 'name = "default"\nmodel_reasoning_effort = 123']) {
  test(`capture rejects ambiguous flat metadata: ${metadata.replaceAll('\n', '; ')}`, async () => {
    const f = fixture()
    try {
      writeAgentFiles(f.cwd, codexAgentFiles(f.config))
      writeFileSync(join(f.cwd, '.codex/agents/default.toml'), metadata)
      assert.ok(captureNativeChoices(f.cwd, f.config).missing.includes('lead'))
    } finally { await f.cleanup() }
  })
}
