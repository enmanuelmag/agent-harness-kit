import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync,writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { applyConfigDefaults } from '../commands/init-helpers'
import { loadConfig } from '../core/config'
import { openDB } from '../core/db'
import { SQLiteDriver } from '../core/drivers/sqlite'
import { MaintenanceService } from '../core/maintenance/operations'
import { PlanStore, withMaintenanceLock } from '../core/maintenance/plans'
import { inputContracts } from '../core/mcp-contracts'
import { assertNormalized } from '../core/mcp-normalizers'
import { openSQLite } from '../core/sqlite-adapter'

import type { Provider } from '../types'

function fixture(provider: Provider = 'opencode') {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'ahk-maintenance-')))
  const homeDir = join(cwd, 'fake-home'); mkdirSync(homeDir)
  const config = applyConfigDefaults({ name: 'Fixture', description: 'Isolated fixture', provider, docsPath: './docs', scope: 'local' })
  writeFileSync(join(cwd, 'agent-harness-kit.config.json'), JSON.stringify(config))
  const service = new MaintenanceService(cwd, { homeDir })
  return { cwd, homeDir, config, service, async cleanup() { await service.dispose(); rmSync(cwd, { recursive: true, force: true }) } }
}
function bytes(root: string, prefix = ''): Record<string, string> {
  return Object.fromEntries(readdirSync(join(root, prefix), { withFileTypes: true }).flatMap(entry => {
    const path = join(prefix, entry.name)
    return entry.isDirectory() ? Object.entries(bytes(root, path)) : [[path, readFileSync(join(root, path)).toString('base64')]]
  }))
}

test('model defaults apply live Codex policy with backups and preserve other providers', async () => {
  const f = fixture('codex-cli')
  const catalog = [
    { id: 'gpt-6.1-sol', label: 'Sol', supportedReasoningEfforts: ['medium', 'high'] },
    { id: 'gpt-6.1-terra', label: 'Terra', supportedReasoningEfforts: ['medium'] },
    { id: 'gpt-6-luna', label: 'Luna', supportedReasoningEfforts: ['low'] },
  ]
  const service = new MaintenanceService(f.cwd, { homeDir: f.homeDir, discoverCodexModels: async () => ({ ok: true, data: catalog }) })
  try {
    writeFileSync(join(f.cwd, 'agent-harness-kit.config.local.json'), JSON.stringify({ agentPreferences: { cursor: { lead: { model: 'keep' } } } }))
    mkdirSync(join(f.cwd, '.codex', 'agents'), { recursive: true })
    writeFileSync(join(f.cwd, '.codex', 'agents', 'builder.toml'), 'custom builder')
    writeFileSync(join(f.cwd, '.codex', 'config.toml'), 'model = "gpt-old"\n')
    const result = await service.execute('models.apply_defaults')
    assert.equal(result.ok, true, result.message)
    const choices = result.data!.choices as Record<string, { model: string; reasoningEffort?: string }>
    assert.equal(choices.builder.model, 'gpt-6.1-terra')
    assert.equal(choices.consultant.reasoningEffort, 'high')
    assert.equal(readFileSync(join(String(result.data!.backupDir), '.codex', 'agents', 'builder.toml'), 'utf8'), 'custom builder')
    assert.match(readFileSync(join(f.cwd, '.codex', 'agents', 'builder.toml'), 'utf8'), /gpt-6\.1-terra/)
    assert.match(readFileSync(join(f.cwd, '.codex', 'config.toml'), 'utf8'), /^model = "gpt-6\.1-sol"$/m)
    const saved = await loadConfig(f.cwd)
    assert.deepEqual(saved.agentPreferences?.['codex-cli'], choices)
    assert.equal(saved.agentPreferences?.cursor?.lead?.model, 'keep')
    assert.equal((await service.execute('models.apply_defaults')).ok, true)
  } finally { await service.dispose(); await f.cleanup() }
  const missing = fixture('codex-cli')
  const missingService = new MaintenanceService(missing.cwd, { homeDir: missing.homeDir, discoverCodexModels: async () => ({ ok: true, data: [{ id: 'gpt-6.1-terra', label: 'Terra', supportedReasoningEfforts: ['medium'] }] }) })
  try {
    mkdirSync(join(missing.cwd, '.codex'), { recursive: true })
    writeFileSync(join(missing.cwd, '.codex', 'config.toml'), 'model = "user-choice"\nmodel_reasoning_effort = "xhigh"\n')
    const result = await missingService.execute('models.apply_defaults')
    assert.equal(result.ok, true, result.message)
    const choices = result.data!.choices as Record<string, { model: string }>
    assert.equal(choices.lead.model, 'inherit')
    assert.equal(choices.builder.model, 'gpt-6.1-terra')
    assert.match(readFileSync(join(missing.cwd, '.codex', 'config.toml'), 'utf8'), /^model_reasoning_effort = "xhigh"$/m)
  } finally { await missingService.dispose(); await missing.cleanup() }
})

test('Codex defaults clear unsupported stale project effort when the selected model has no default', async () => {
  const f = fixture('codex-cli')
  const service = new MaintenanceService(f.cwd, { homeDir: f.homeDir, discoverCodexModels: async () => ({ ok: true, data: [{ id: 'gpt-6.1-sol', label: 'Sol', supportedReasoningEfforts: ['low'] }] }) })
  try {
    mkdirSync(join(f.cwd, '.codex'), { recursive: true })
    const path = join(f.cwd, '.codex', 'config.toml')
    writeFileSync(path, 'model = "old"\nmodel_reasoning_effort = "xhigh" # retain comment\n[profiles.custom]\nmodel_reasoning_effort = "high"\n')
    const result = await service.execute('models.apply_defaults')
    assert.equal(result.ok, true, result.message)
    const config = readFileSync(path, 'utf8')
    assert.match(config, /^model = "gpt-6\.1-sol"$/m)
    assert.match(config, /# retain comment/)
    assert.doesNotMatch(config.split('[profiles.custom]')[0], /^model_reasoning_effort\s*=/m)
    assert.match(config, /\[profiles.custom\]\nmodel_reasoning_effort = "high"/)
    assert.deepEqual((await loadConfig(f.cwd)).agentPreferences?.['codex-cli']?.lead, { model: 'gpt-6.1-sol' })
  } finally { await service.dispose(); await f.cleanup() }
})

test('inherited provider policies replace stale effort and failures do not change files', async () => {
  for (const provider of ['claude-code', 'cursor', 'opencode-v2'] as const) {
    const f = fixture(provider)
    try {
      const previous = provider === 'opencode-v2' ? { model: 'team/model#high' } : { model: 'old', reasoningEffort: 'high' }
      writeFileSync(join(f.cwd, 'agent-harness-kit.config.local.json'), JSON.stringify({ agentPreferences: { [provider]: { lead: previous } } }))
      const result = await f.service.execute('models.apply_defaults')
      assert.equal(result.ok, true, `${provider}: ${result.message}`)
      assert.deepEqual((await loadConfig(f.cwd)).agentPreferences?.[provider]?.lead, { model: 'inherit' })
    } finally { await f.cleanup() }
  }
  const f = fixture('codex-cli')
  const service = new MaintenanceService(f.cwd, { homeDir: f.homeDir, discoverCodexModels: async () => ({ ok: false, error: 'offline' }) })
  try {
    const before = bytes(f.cwd)
    assert.equal((await service.execute('models.apply_defaults', { provider: 'cursor' })).code, 'provider_mismatch')
    assert.equal((await service.execute('models.apply_defaults')).code, 'catalog_unavailable')
    assert.deepEqual(bytes(f.cwd), before)
    await withMaintenanceLock(f.cwd, async () => assert.equal((await service.execute('models.apply_defaults')).code, 'maintenance_busy'))
  } finally { await service.dispose(); await f.cleanup() }
  const unsupported = fixture('opencode')
  try {
    const before = bytes(unsupported.cwd)
    assert.equal((await unsupported.service.execute('models.apply_defaults')).code, 'unsupported_provider')
    assert.deepEqual(bytes(unsupported.cwd), before)
  } finally { await unsupported.cleanup() }
})

test('ambiguous populated storage candidates request the actual supported source field without writes', async () => {
  const f = fixture()
  try {
    for (const scope of ['local', 'global'] as const) {
      const db = await openDB({ ...f.config, storage: { ...f.config.storage, scope } }, f.cwd, f.homeDir)
      try { await db.addTask({ slug: `${scope}-data`, title: `${scope} source data` }) } finally { await db.close() }
    }
    const before = bytes(f.cwd)
    const plan = await f.service.execute('migrate.storage.plan')
    assert.equal(plan.ok, true, plan.message)
    const result = await f.service.execute('migrate.storage.apply', { planId: plan.data!.planId })
    assert.equal(result.code, 'needs_input')
    assert.deepEqual(result.required, ['source'])
    assert.match(result.message!, /fresh storage plan.*candidate path/)
    assert.deepEqual(bytes(f.cwd), before)
    const candidates = plan.data!.candidates as { path: string }[]
    const recovered = inputContracts['ahk.migrate.storage.plan'].parse({ source: candidates[0].path })
    assertNormalized(recovered)
    assert.equal(recovered.source, candidates[0].path)
  } finally { await f.cleanup() }
})

test('plans are byte-read-only, server-owned, expire and cap retained entries', async () => {
  const f = fixture()
  try {
    const before = bytes(f.cwd)
    for (const operation of ['sync.plan', 'migrate.storage.plan', 'migrate.specs.plan', 'reset.plan']) {
      const result = await f.service.execute(operation, operation === 'reset.plan' ? { db: true } : {})
      assert.equal(result.ok, true, result.message)
    }
    assert.deepEqual(bytes(f.cwd), before)
    assert.equal((await f.service.execute('sync.apply', { planId: 'forged' })).code, 'invalid_plan')
    let now = 0; const store = new PlanStore(() => now)
    const first = store.create('sync', {}, 'rev', {}).id
    for (let n = 0; n < 32; n++) store.create('sync', {}, 'rev', {})
    assert.equal(store.get(first), undefined)
    const last = store.create('sync', {}, 'rev', {}).id
    now = 600_001; assert.equal(store.get(last), undefined)
  } finally { await f.cleanup() }
})

test('stale plans and concurrent cross-process apply locks make no generated changes', async () => {
  const f = fixture()
  try {
    const plan = await f.service.execute('sync.plan')
    writeFileSync(join(f.cwd, 'AGENTS.md'), 'developer customization')
    const stale = await f.service.execute('sync.apply', { planId: plan.data!.planId })
    assert.equal(stale.code, 'stale_plan')
    assert.equal(readFileSync(join(f.cwd, 'AGENTS.md'), 'utf8'), 'developer customization')
    await withMaintenanceLock(f.cwd, async () => {
      const outcome = await f.service.execute('build')
      assert.equal(outcome.code, 'maintenance_busy')
      const child = spawn(process.execPath, ['--import', 'tsx/esm', '--input-type=module', '-e', `import { withMaintenanceLock } from ${JSON.stringify(join(process.cwd(), 'src/core/maintenance/plans.ts'))}; try { await withMaintenanceLock(${JSON.stringify(f.cwd)}, async()=>{});process.exitCode=3 } catch(e) { if(!String(e).includes('maintenance_busy'))process.exitCode=4 }`])
      const code = await new Promise<number | null>((resolveCode, reject) => { child.once('error', reject); child.once('close', resolveCode) })
      assert.equal(code, 0)
    })
    assert.equal(existsSync(join(f.cwd, '.harness', 'maintenance.lock')), false)
  } finally { await f.cleanup() }
})

test('force missing models needs_input and backup failure preserves every target', async () => {
  const f = fixture('claude-code')
  try {
    assert.equal((await f.service.execute('build', { force: true, keepModels: true })).code, 'needs_input')
    writeFileSync(join(f.cwd, 'AGENTS.md'), 'custom')
    mkdirSync(join(f.cwd, '.harness'), { recursive: true }); writeFileSync(join(f.cwd, '.harness', 'backups'), 'cannot create directory')
    const choices = Object.fromEntries(['lead', 'explorer', 'consultant', 'builder', 'reviewer'].map(role => [role, { model: 'inherit' }]))
    const result = await f.service.execute('build', { force: true, choices })
    assert.equal(result.ok, false)
    assert.equal(readFileSync(join(f.cwd, 'AGENTS.md'), 'utf8'), 'custom')
    assert.equal(existsSync(join(f.cwd, 'agent-harness-kit.config.local.json')), false)
  } finally { await f.cleanup() }
})

test('storage plan/apply persists requested scope, verifies destination and fences owned handles', async () => {
  const f = fixture()
  let closed = 0; let reopened = 0
  const service = new MaintenanceService(f.cwd, { homeDir: f.homeDir, beforeStorageChange: async () => { closed++ }, afterStorageChange: async () => { reopened++ } })
  try {
    const db = await openDB(f.config, f.cwd, f.homeDir)
    await db.addTask({ slug: 'keep', title: 'Preserved' }); await db.writeStorageState(f.cwd); await db.close()
    const before = bytes(f.cwd)
    const plan = await service.execute('migrate.storage.plan', { scope: 'global' })
    assert.equal(plan.ok, true, plan.message); assert.deepEqual(bytes(f.cwd), before)
    const result = await service.execute('migrate.storage.apply', { planId: plan.data!.planId })
    assert.equal(result.ok, true, result.message)
    assert.equal(closed, 1); assert.equal(reopened, 1)
    assert.equal(existsSync(join(f.cwd, '.harness', 'harness.db')), true, 'source inode is retained for native recovery')
    assert.equal(existsSync(String(result.data!.destination)), true)
    assert.equal(JSON.parse(readFileSync(join(f.cwd, 'agent-harness-kit.config.local.json'), 'utf8')).storage.scope, 'global')
    assert.equal((result.data!.counts as { tasks: number }).tasks, 1)
  } finally { await service.dispose(); await f.cleanup() }
})

test('reset requires explicit confirmation, complete backups, and selected role names', async () => {
  const f = fixture()
  try {
    mkdirSync(join(f.cwd, '.opencode', 'agents'), { recursive: true })
    writeFileSync(join(f.cwd, '.opencode', 'agents', 'builder.md'), 'mine')
    writeFileSync(join(f.cwd, '.opencode', 'agents', 'custom.md'), 'custom')
    const plan = await f.service.execute('reset.plan', { targets: ['builder'] })
    assert.equal((await f.service.execute('reset.apply', { planId: plan.data!.planId })).code, 'needs_input')
    assert.equal(readFileSync(join(f.cwd, '.opencode', 'agents', 'builder.md'), 'utf8'), 'mine')
    const next = await f.service.execute('reset.plan', { targets: ['builder'] })
    const done = await f.service.execute('reset.apply', { planId: next.data!.planId, confirm: true })
    assert.equal(done.ok, true, done.message)
    assert.equal(existsSync(join(f.cwd, '.opencode', 'agents', 'builder.md')), false)
    assert.equal(readFileSync(join(f.cwd, '.opencode', 'agents', 'custom.md'), 'utf8'), 'custom')
    assert.equal(readFileSync(join(String(done.data!.backupDir), '.opencode', 'agents', 'builder.md'), 'utf8'), 'mine')
  } finally { await f.cleanup() }
})

test('init requires explicit native roles and then initializes once, without prompts', async () => {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'ahk-maintenance-init-')))
  const service = new MaintenanceService(cwd, { homeDir: join(cwd, 'home') })
  try {
    const args = { name: 'Project', description: 'Fixture', provider: 'claude-code', storageScope: 'local', notifications: false }
    assert.equal((await service.execute('init', args)).code, 'needs_input')
    assert.equal(existsSync(join(cwd, 'agent-harness-kit.config.json')), false)
    const choices = Object.fromEntries(['lead', 'explorer', 'consultant', 'builder', 'reviewer'].map(role => [role, { model: 'inherit' }]))
    const result = await service.execute('init', { ...args, choices })
    assert.equal(result.ok, true, result.message)
    assert.equal(existsSync(join(cwd, '.claude', 'agents', 'builder.md')), true)
    assert.equal((await service.execute('init', { ...args, choices })).code, 'already_initialized')
  } finally { await service.dispose(); rmSync(cwd, { recursive: true, force: true }) }
})

test('managed watch starts once, stops and disposal rejects further operations; paths cannot escape', async () => {
  const f = fixture()
  try {
    const started = await f.service.execute('watch.start')
    assert.equal(started.ok, true)
    assert.equal((await f.service.execute('watch.start')).data?.alreadyRunning, true)
    assert.equal((await f.service.execute('watch.stop')).ok, true)
    assert.equal((await f.service.execute('export', { format: 'sql' })).code, 'unsupported_format')
    assert.equal((await f.service.execute('export', { format: 'json', output: '../unsafe.json' })).ok, false)
    symlinkSync(join(f.cwd, 'fake-home'), join(f.cwd, '.opencode'))
    assert.equal((await f.service.execute('sync.plan')).ok, false)
    await f.service.dispose()
    assert.equal((await f.service.execute('status')).code, 'disposed')
  } finally { await f.cleanup() }
})


test('status SQL pagination counts archived tasks without loading all task/action history', async () => {
  const f = fixture()
  try {
    const db = await openDB(f.config, f.cwd, f.homeDir)
    for (let n = 0; n < 30; n++) { const task = await db.addTask({ slug: `task-${n}`, title: `Task ${n}` }); if (n < 3) await db.tasks.archive(task.id) }
    await db.close()
    const first = await f.service.execute('status', { limit: 5 })
    assert.equal(first.ok, true, first.message)
    assert.equal((first.data!.tasks as unknown[]).length, 5)
    assert.equal(first.data!.total, 27); assert.equal(first.data!.archivedCount, 3); assert.equal(first.data!.nextOffset, 5)
    const archived = await f.service.execute('status', { archived: true, limit: 5 })
    assert.equal((archived.data!.tasks as unknown[]).length, 3); assert.equal(archived.data!.total, 3); assert.equal(archived.data!.nextOffset, null)
  } finally { await f.cleanup() }
})


test('storage maintenance refuses another live AHK owner without losing writes or changing configuration', async () => {
  const f = fixture()
  try {
    const live = await openDB(f.config, f.cwd, f.homeDir)
    await live.addTask({ slug: 'original', title: 'Original' }); await live.writeStorageState(f.cwd)
    const plan = await f.service.execute('migrate.storage.plan', { scope: 'global' })
    assert.equal(plan.ok, true, plan.message)
    const result = await f.service.execute('migrate.storage.apply', { planId: plan.data!.planId })
    assert.equal(result.code, 'database_busy', result.message)
    assert.equal(existsSync(join(f.cwd, 'agent-harness-kit.config.local.json')), false)
    await live.addTask({ slug: 'still-live', title: 'Still live' })
    assert.equal((await live.getTasks()).length, 2)
    await live.close()
  } finally { await f.cleanup() }
})

test('real SQLite write barrier blocks an independent process late commit; retained source and old-config fence preserve recovery', async () => {
  const f = fixture()
  try {
    const db = await openDB(f.config, f.cwd, f.homeDir)
    await db.addTask({ slug: 'before', title: 'Before' }); await db.writeStorageState(f.cwd); await db.close()
    const source = join(f.cwd, '.harness', 'harness.db')
    const script = `import { openSQLite } from ${JSON.stringify(join(process.cwd(), 'src/core/sqlite-adapter.ts'))}; const db=openSQLite(${JSON.stringify(source)}); db.exec('PRAGMA busy_timeout=0'); try {db.exec("INSERT INTO tasks(slug,title,created_at,updated_at) VALUES ('late','Late','now','now')"); process.stdout.write('committed')} catch(e) {if(!String(e).includes('database is locked'))throw e;process.stdout.write('blocked')} finally {db.close()}`
    let attempted = false
    const internal = f.service as unknown as { backupJson: (data: unknown, label: string) => string }
    const backup = internal.backupJson.bind(f.service)
    internal.backupJson = (data, label) => {
      if (label === 'source-snapshot') {
        const child = spawnSync(process.execPath, ['--import', 'tsx/esm', '--input-type=module', '-e', script], { encoding: 'utf8' })
        assert.equal(child.status, 0, child.stderr); assert.equal(child.stdout, 'blocked')
        attempted = true
      }
      return backup(data, label)
    }
    const plan = await f.service.execute('migrate.storage.plan', { scope: 'global' })
    const result = await f.service.execute('migrate.storage.apply', { planId: plan.data!.planId })
    assert.equal(result.ok, true, result.message); assert.equal(attempted, true)
    assert.equal(result.data!.sourceRetained, true); assert.equal(existsSync(source), true)
    const child = spawnSync(process.execPath, ['--import', 'tsx/esm', '--input-type=module', '-e', script], { encoding: 'utf8' })
    assert.equal(child.status, 0, child.stderr); assert.equal(child.stdout, 'committed')
    const native = openSQLite(source, true)
    try { assert.equal(native.prepare('SELECT COUNT(*) n FROM tasks').get()?.n, 2) } finally { native.close() }
    assert.throws(() => new SQLiteDriver(source), /restart_required/)
    const target = openSQLite(String(result.data!.destination), true)
    try { assert.equal(target.prepare('SELECT COUNT(*) n FROM tasks').get()?.n, 1) } finally { target.close() }
  } finally { await f.cleanup() }
})

test('reset uses a consistent backup and DELETE transaction without unlinking a raw live connection', async () => {
  const f = fixture()
  try {
    const db = await openDB(f.config, f.cwd, f.homeDir)
    await db.addTask({ slug: 'original', title: 'Original' }); await db.writeStorageState(f.cwd); await db.close()
    const path = join(f.cwd, '.harness', 'harness.db')
    const native = openSQLite(path)
    try {
      native.exec('BEGIN IMMEDIATE')
      const blockedPlan = await f.service.execute('reset.plan', { db: true, force: true })
      const blocked = await f.service.execute('reset.apply', { planId: blockedPlan.data!.planId })
      assert.equal(blocked.code, 'database_busy', blocked.message)
      assert.equal(native.prepare('SELECT COUNT(*) n FROM tasks').get()?.n, 1)
      native.exec('ROLLBACK')
      const plan = await f.service.execute('reset.plan', { db: true, force: true })
      const result = await f.service.execute('reset.apply', { planId: plan.data!.planId })
      assert.equal(result.ok, true, result.message)
      assert.deepEqual(result.data!.removed, [])
      assert.equal(result.data!.databaseCleared, true); assert.equal(existsSync(path), true)
      const backup = JSON.parse(readFileSync(String(result.data!.databaseBackup), 'utf8'))
      assert.equal(backup.tasks.length, 1)
      assert.equal(native.prepare('SELECT COUNT(*) n FROM tasks').get()?.n, 0)
      native.exec("INSERT INTO tasks(slug,title,created_at,updated_at) VALUES ('after','After','now','now')")
      assert.equal(native.prepare('SELECT COUNT(*) n FROM tasks').get()?.n, 1)
    } finally { native.close() }
  } finally { await f.cleanup() }
})

test('retained retired destination can be intentionally migrated back and reactivated', async () => {
  const f = fixture()
  try {
    const db = await openDB(f.config, f.cwd, f.homeDir)
    await db.addTask({ slug: 'kept', title: 'Kept' }); await db.writeStorageState(f.cwd); await db.close()
    const forward = await f.service.execute('migrate.storage.plan', { scope: 'global' })
    assert.equal((await f.service.execute('migrate.storage.apply', { planId: forward.data!.planId })).ok, true)
    const back = await f.service.execute('migrate.storage.plan', { scope: 'local', force: true })
    const result = await f.service.execute('migrate.storage.apply', { planId: back.data!.planId })
    assert.equal(result.ok, true, result.message)
    const reopened = await openDB(f.config, f.cwd, f.homeDir)
    try { assert.equal((await reopened.getTasks()).length, 1) } finally { await reopened.close() }
  } finally { await f.cleanup() }
})

test('SQLite ownership admission keeps the 64-owner cap atomic across concurrent child processes', async () => {
  const f = fixture()
  try {
    const db = await openDB(f.config, f.cwd, f.homeDir); await db.close()
    const path = join(f.cwd, '.harness', 'harness.db')
    const root = join(f.cwd, '.harness', '.harness.db.ahk-owners')
    for (let n = 0; n < 63; n++) writeFileSync(join(root, `fixture-${n}.owner`), JSON.stringify({ pid: process.pid, id: `fixture-${n}`, generation: 0 }))
    const script = `import { SQLiteDriver } from ${JSON.stringify(join(process.cwd(), 'src/core/drivers/sqlite.ts'))};process.stdout.write('ready\\n'); await new Promise(r=>process.stdin.once('data',r)); try {const d=new SQLiteDriver(${JSON.stringify(path)});process.stdout.write('opened\\n');await new Promise(r=>setTimeout(r,500));await d.close()}catch(e){if(!/database_busy|database is locked/.test(String(e)))throw e;process.stdout.write('busy\\n')}process.stdin.destroy()`
    const start = () => {
      const child = spawn(process.execPath, ['--import', 'tsx/esm', '--input-type=module', '-e', script], { stdio: ['pipe', 'pipe', 'pipe'] })
      let output = '', error = ''
      const ready = new Promise<void>(resolveReady => child.stdout.on('data', chunk => { output += chunk.toString(); if (output.includes('ready')) resolveReady() }))
      child.stderr.on('data', chunk => { error += chunk.toString() })
      const done = new Promise<void>((resolveDone, reject) => { child.once('error', reject); child.once('close', code => { if (code !== 0) reject(new Error(error)); else resolveDone() }) })
      return { child, ready, done, output: () => output }
    }
    const first = start(), second = start()
    await Promise.all([first.ready, second.ready]); first.child.stdin.write('go'); second.child.stdin.write('go')
    await Promise.all([first.done, second.done])
    assert.equal([first.output(), second.output()].filter(text => text.includes('opened')).length, 1)
    assert.equal([first.output(), second.output()].filter(text => text.includes('busy')).length, 1)
    assert.equal(readdirSync(root).filter(name => name.endsWith('.owner')).length, 63)
  } finally { await f.cleanup() }
})

test('SQLite exclusive write failure cleans the created lock; proven-dead owner recovers but malformed owner stays blocked', async () => {
  const f = fixture()
  try {
    const db = await openDB(f.config, f.cwd, f.homeDir); await db.close()
    const path = join(f.cwd, '.harness', 'harness.db')
    const root = join(f.cwd, '.harness', '.harness.db.ahk-owners')
    const lock = join(root, 'exclusive.lock')
    const script = `import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module'; import {withSQLiteMaintenance} from ${JSON.stringify(join(process.cwd(), 'src/core/sqlite-ownership.ts'))};const original=fs.writeFileSync;fs.writeFileSync=(path,...args)=>{if(typeof path==='number')throw Error('injected-write-failure');return original(path,...args)};syncBuiltinESMExports();try{await withSQLiteMaintenance([${JSON.stringify(path)}],async()=>{})}catch(e){if(!String(e).includes('injected-write-failure'))throw e}process.stdout.write(String(fs.existsSync(${JSON.stringify(lock)})))`
    const failed = spawnSync(process.execPath, ['--import', 'tsx/esm', '--input-type=module', '-e', script], { encoding: 'utf8' })
    assert.equal(failed.status, 0, failed.stderr); assert.equal(failed.stdout, 'false')
    const dead = spawnSync(process.execPath, ['-e', 'process.exit(0)'])
    writeFileSync(lock, JSON.stringify({ id: 'dead', pid: dead.pid }))
    const { withSQLiteMaintenance } = await import('../core/sqlite-ownership')
    await withSQLiteMaintenance([path], async () => {})
    assert.equal(existsSync(lock), false)
    writeFileSync(lock, '{partial')
    await assert.rejects(() => withSQLiteMaintenance([path], async () => {}), /database_busy/)
    assert.equal(readFileSync(lock, 'utf8'), '{partial')
  } finally { await f.cleanup() }
})
