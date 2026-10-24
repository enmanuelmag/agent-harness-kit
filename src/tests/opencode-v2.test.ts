import assert from 'node:assert/strict'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'

import { choicesFromPreferences, toPreferences } from '@/commands/agent-preferences'
import { applyConfigDefaults } from '@/commands/init-helpers'
import { filesFor, resolveModelsContext } from '@/commands/models'
import { loadConfig } from '@/core/config'
import { captureNativeChoices } from '@/core/maintenance/native-model-capture'
import { MaintenanceService } from '@/core/maintenance/operations'
import { OpenCodeMaterializer } from '@/core/materializer/opencode'
import { opencodeV2AgentFiles, OpenCodeV2Materializer, openCodeV2Permissions } from '@/core/materializer/opencode-v2'
import { inspectOpenCodeConfig, parseOpenCodeConfig, prepareOpenCodeV2Config, writeOpenCodeV2Config } from '@/core/materializer/opencode-v2-config'
import { installNotificationHooks, uninstallNotificationHooks } from '@/core/notifications/install'
import { OpenCodeV2TurnTracker } from '@/core/notifications/opencode-v2'
import { normalizeProviderHook } from '@/core/notifications/providers'
import { openCodeV2PreferenceSchema } from '@/schema/opencode-v2'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture(provider: 'opencode' | 'opencode-v2' = 'opencode-v2') {
  const cwd = mkdtempSync(join(process.cwd(), '.tmp-v2-test-')); roots.push(cwd)
  const config = applyConfigDefaults({ name: 'V2 fixture', description: 'Native provider fixture', provider, docsPath: './docs', scope: 'local' })
  config.agentPreferences = toPreferences(provider, Object.fromEntries(['lead', 'explorer', 'consultant', 'builder', 'reviewer'].map(role => [role, {}])))
  writeFileSync(join(cwd, 'agent-harness-kit.config.json'), JSON.stringify(config))
  return { cwd, config }
}

test('native JSONC preserves comments, foreign servers and user decisions; repeating merge is byte-identical', () => {
  const { cwd, config } = fixture()
  const path = join(cwd, 'opencode.jsonc')
  writeFileSync(path, '{\n // team settings\n "model":"team/model#high",\n "permissions":[{"action":"shell","resource":"*","effect":"ask"}],\n "mcp":{"servers":{"team":{"type":"remote","url":"https://example.test/mcp"}}},\n}\n')
  writeOpenCodeV2Config(prepareOpenCodeV2Config(cwd, config))
  const once = readFileSync(path, 'utf8')
  assert.match(once, /\/\/ team settings/)
  const value = JSON.parse(JSON.stringify(parseOpenCodeConfig(once, path)))
  assert.equal(value.model, 'team/model#high')
  assert.deepEqual(value.permissions, [{ action: 'shell', resource: '*', effect: 'ask' }])
  assert.equal(value.mcp.servers.team.url, 'https://example.test/mcp')
  assert.equal(value.mcp.servers['agent-harness-kit'].codemode, false)
  assert.ok(value.mcp.servers['agent-harness-kit'].command.includes('ahk'))
  assert.equal(value.mcp['agent-harness-kit'], undefined)
  writeOpenCodeV2Config(prepareOpenCodeV2Config(cwd, config))
  assert.equal(readFileSync(path, 'utf8'), once)
  assert.equal(existsSync(join(cwd, 'opencode.json')), false)
})

test('invalid, duplicate, shadowed and symlinked configuration fails without replacing original bytes', () => {
  const { cwd, config } = fixture()
  const path = join(cwd, 'opencode.jsonc')
  for (const text of ['{invalid', '[]', '{"mcp":[]}', '{"mcp":{},"mcp":{}}', '{"mcp":{"servers":[]}}', '{"mcp":{"agent-harness-kit":{},"servers":{"agent-harness-kit":{}}}}']) {
    writeFileSync(path, text)
    assert.throws(() => prepareOpenCodeV2Config(cwd, config))
    assert.equal(readFileSync(path, 'utf8'), text)
  }
  writeFileSync(path, '{}'); writeFileSync(join(cwd, 'opencode.json'), '{}')
  assert.throws(() => inspectOpenCodeConfig(cwd), /Ambiguous/)
  rmSync(join(cwd, 'opencode.json')); rmSync(path)
  const external = fixture().cwd
  symlinkSync(external, join(cwd, '.opencode'))
  assert.throws(() => prepareOpenCodeV2Config(cwd, config), /symlink/)
})

test('all five native agents retain full descriptions and modes; preferences include variants and resources', async () => {
  const { cwd, config } = fixture()
  const models = { builder: { model: 'team/model#high' } }
  await new OpenCodeV2Materializer().scaffold(config, { cwd, opencodeV2AgentModels: models })
  for (const entry of opencodeV2AgentFiles(config, models)) {
    const text = readFileSync(join(cwd, entry.relPath), 'utf8')
    const header = text.match(/^---\n([\s\S]*?)\n---/)![1]
    assert.match(header, /description: >\n  \S[^\n]+\n  \S/)
    assert.doesNotMatch(header, /^(name|permission|tools|disallowedTools|temperature):/m)
    assert.match(header, new RegExp(`^mode: ${entry.relPath.endsWith('/lead.md') ? 'primary' : 'subagent'}$`, 'm'))
  }
  assert.match(readFileSync(join(cwd, '.opencode/agents/builder.md'), 'utf8'), /model: "team\/model#high"/)
  assert.ok(existsSync(join(cwd, '.opencode/skills/ahk-spec/resources/template.md')))
  const state = JSON.parse(readFileSync(join(cwd, '.harness/skills-state.json'), 'utf8'))
  assert.equal(state.roots._opencode_skills.provider, 'opencode-v2')
  const before = readFileSync(join(cwd, '.opencode/agents/builder.md'), 'utf8') + '\ncustom body\n'
  writeFileSync(join(cwd, '.opencode/agents/builder.md'), before)
  await new OpenCodeV2Materializer().build(config, cwd)
  assert.equal(readFileSync(join(cwd, '.opencode/agents/builder.md'), 'utf8'), before)
})

test('nonimplementers deny edit and shell except explicit diagnostic commands; lead can delegate four roles', () => {
  for (const role of ['lead', 'explorer', 'consultant', 'reviewer'] as const) {
    const rules = openCodeV2Permissions(role)
    assert.deepEqual(rules.find(rule => rule.action === 'edit'), { action: 'edit', resource: '*', effect: 'deny' })
    assert.deepEqual(rules.find(rule => rule.action === 'shell'), { action: 'shell', resource: '*', effect: 'deny' })
    assert.equal(rules.some(rule => rule.action === 'shell' && rule.effect === 'allow' && rule.resource.includes('*')), false)
  }
  assert.equal(openCodeV2Permissions('lead').filter(rule => rule.action === 'subagent' && rule.effect === 'allow').length, 4)
  assert.ok(openCodeV2Permissions('reviewer').some(rule => rule.resource === 'pnpm test'))
})

test('native model service persists inheritance/variants, captures # intact and rejects invalid choices without preference writes', async () => {
  const { cwd, config } = fixture()
  await new OpenCodeV2Materializer().scaffold(config, { cwd })
  assert.equal((await resolveModelsContext(cwd)).ok, true)
  const service = new MaintenanceService(cwd)
  try {
    const choices = { ...config.agentPreferences!['opencode-v2'], builder: { model: 'team/model#high' } }
    const result = await service.execute('models', { choices })
    assert.equal(result.ok, true, result.message)
    const saved = await loadConfig(cwd)
    assert.equal(choicesFromPreferences(saved).opencodeV2AgentModels?.builder?.model, 'team/model#high')
    assert.match(filesFor(saved, { builder: { model: 'team/model#high' } })[3].content, /team\/model#high/)
    assert.equal(captureNativeChoices(cwd, saved).choices.builder?.model, 'team/model#high')
    const before = readFileSync(join(cwd, 'agent-harness-kit.config.local.json'), 'utf8')
    assert.equal((await service.execute('models', { choices: { builder: { model: 'bad model' } } })).ok, false)
    assert.equal(readFileSync(join(cwd, 'agent-harness-kit.config.local.json'), 'utf8'), before)
    assert.equal(openCodeV2PreferenceSchema.safeParse({ model: 'team/model', reasoningEffort: 'invented' }).success, false)
  } finally { await service.dispose() }
})

test('migration converts only canonical v1 shared agents/MCP and backs up previous content; reverse requires recovery', async () => {
  const { cwd, config } = fixture('opencode')
  await new OpenCodeMaterializer().scaffold(config, { cwd })
  const original = readFileSync(join(cwd, '.opencode/agents/lead.md'), 'utf8')
  const choices = Object.fromEntries(['lead', 'explorer', 'consultant', 'builder', 'reviewer'].map(role => [role, { model: 'inherit' }]))
  const service = new MaintenanceService(cwd)
  try {
    const plan = await service.execute('migrate.provider.plan', { to: 'opencode-v2', choices })
    const result = await service.execute('migrate.provider.apply', { planId: plan.data!.planId })
    assert.equal(result.ok, true, result.message)
    assert.equal((await loadConfig(cwd)).provider, 'opencode-v2')
    assert.equal(readFileSync(join(String(result.data!.backupDir), '.opencode/agents/lead.md'), 'utf8'), original)
    assert.match(readFileSync(join(cwd, '.opencode/agents/lead.md'), 'utf8'), /mode: primary/)
    const native = inspectOpenCodeConfig(cwd)
    assert.equal(native.legacy, undefined); assert.ok(native.native)
    const reverse = await service.execute('migrate.provider.plan', { to: 'opencode' })
    assert.equal((await service.execute('migrate.provider.apply', { planId: reverse.data!.planId })).code, 'recovery_required')
    // Exercise documented recovery of known generated files, preserving the base configuration.
    assert.match(readFileSync(join(cwd, '.opencode/agents/lead.md'), 'utf8'), /mode: primary/)
    for (const role of ['lead', 'explorer', 'consultant', 'builder', 'reviewer']) copyFileSync(join(String(result.data!.backupDir), `.opencode/agents/${role}.md`), join(cwd, `.opencode/agents/${role}.md`))
    copyFileSync(join(String(result.data!.backupDir), 'opencode.json'), join(cwd, 'opencode.json'))
    rmSync(join(cwd, 'agent-harness-kit.config.local.json'))
    const recovered = await loadConfig(cwd)
    assert.equal(recovered.provider, 'opencode')
    assert.equal(readFileSync(join(cwd, '.opencode/agents/lead.md'), 'utf8'), original)
    assert.ok(inspectOpenCodeConfig(cwd).legacy)
  } finally { await service.dispose() }
})

test('migration preserves customized v1 agent even force requested and never changes provider or config', async () => {
  const { cwd, config } = fixture('opencode')
  await new OpenCodeMaterializer().scaffold(config, { cwd })
  const path = join(cwd, '.opencode/agents/builder.md')
  writeFileSync(path, readFileSync(path, 'utf8') + '\nmy custom behavior')
  const before = readFileSync(join(cwd, 'opencode.json'), 'utf8')
  const service = new MaintenanceService(cwd)
  try {
    const choices = Object.fromEntries(['lead', 'explorer', 'consultant', 'builder', 'reviewer'].map(role => [role, { model: 'inherit' }]))
    const plan = await service.execute('migrate.provider.plan', { to: 'opencode-v2', force: true, choices })
    const result = await service.execute('migrate.provider.apply', { planId: plan.data!.planId })
    assert.equal(result.ok, false)
    assert.match(result.message!, /customized/)
    assert.equal((await loadConfig(cwd)).provider, 'opencode')
    assert.equal(readFileSync(join(cwd, 'opencode.json'), 'utf8'), before)
  } finally { await service.dispose() }
})

function event(type: string, sessionID = 'main', id = type) { return { id, type, location: { directory: '/project' }, data: { sessionID } } }
test('v2 durable execution identity deduplicates completion, filters children/locations and never completes failures/idle', () => {
  const tracker = new OpenCodeV2TurnTracker('/project')
  tracker.observeSession({ id: 'main', location: { directory: '/project' } })
  tracker.observeSession({ id: 'child', parentID: 'main', location: { directory: '/project' } })
  tracker.process(event('session.execution.started', 'main', 'turn-1'))
  assert.deepEqual(tracker.process(event('session.idle')), [])
  const bind = tracker.tool({ sessionID: 'main', status: 'completed', tool: 'agent-harness-kit_tasks_get', result: { content: [{ type: 'text', text: '{"notificationSchemaVersion":1,"events":[]}' }] } })
  assert.equal(bind[0].type, 'bind'); assert.equal(bind[0].turn, 'turn-1')
  const completion = tracker.process(event('session.execution.succeeded'))
  assert.equal(completion.length, 1); assert.equal(completion[0].turn, 'turn-1')
  assert.deepEqual(tracker.process(event('session.execution.succeeded')), [])
  tracker.process(event('session.execution.started', 'child', 'child-turn'))
  assert.deepEqual(tracker.process(event('session.execution.succeeded', 'child')), [])
  tracker.process(event('session.execution.started', 'main', 'turn-2'))
  tracker.process(event('session.execution.failed'))
  assert.deepEqual(tracker.process(event('session.execution.succeeded')), [])
  assert.deepEqual(tracker.process({ ...event('permission.asked'), location: { directory: '/other' }, data: { sessionID: 'main', id: 'permission' } }), [])
  const attention = tracker.process({ ...event('permission.asked'), data: { sessionID: 'main', id: 'permission' } })
  assert.equal(attention[0].type, 'attention')
  assert.equal(normalizeProviderHook('opencode-v2', 'complete', { session_id: 'main', turn_id: 'turn-1' })[0].provider, 'opencode-v2')
  assert.deepEqual(tracker.tool({ sessionID: 'main', status: 'error', tool: 'agent-harness-kit_tasks_get', result: {} }), [])
})

test('v2 hook installation is idempotent, preserves edits and refuses opposite-version plugins', async () => {
  const { cwd } = fixture()
  const runtime = { node: process.execPath, cli: join(process.cwd(), 'dist/cli.js') }
  const result = await installNotificationHooks(cwd, 'opencode-v2', runtime)
  assert.equal(result.ok, true)
  const path = join(cwd, '.opencode/plugins/ahk-notifications-v2/index.js')
  const once = readFileSync(path, 'utf8')
  assert.match(once, /Plugin.define/); assert.match(once, /ctx.event.subscribe/)
  assert.equal((await installNotificationHooks(cwd, 'opencode-v2', runtime)).ok, true)
  assert.equal(readFileSync(path, 'utf8'), once)
  assert.equal((await installNotificationHooks(cwd, 'opencode', runtime)).ok, false)
  writeFileSync(path, once + '\n// custom')
  const preserved = await uninstallNotificationHooks(cwd, 'opencode-v2')
  assert.equal(preserved.ok && preserved.value.preserved.length, 1)
  writeFileSync(path, once)
  assert.equal((await uninstallNotificationHooks(cwd, 'opencode-v2')).ok, true)
  assert.equal(existsSync(path), false)
})


test('existing native server overrides remain intact on safe rebuild', () => {
  const { cwd, config } = fixture()
  writeFileSync(join(cwd, 'opencode.json'), JSON.stringify({ mcp: { servers: { 'agent-harness-kit': { type: 'local', command: ['node', 'custom-wrapper.js'], disabled: true, codemode: true, environment: { TEAM: 'yes' } } } } }))
  writeOpenCodeV2Config(prepareOpenCodeV2Config(cwd, config))
  const entry = inspectOpenCodeConfig(cwd).native!
  assert.equal(entry.disabled, true); assert.equal(entry.codemode, true)
  assert.equal(JSON.stringify(entry.command), JSON.stringify(['node', 'custom-wrapper.js']))
  assert.equal(JSON.stringify(entry.environment), JSON.stringify({ TEAM: 'yes' }))
})

test('provider migration switches only an owned v1 plugin and preserves its backup', async () => {
  const { cwd, config } = fixture('opencode')
  await new OpenCodeMaterializer().scaffold(config, { cwd })
  const runtime = { node: process.execPath, cli: join(process.cwd(), 'dist/cli.js') }
  assert.equal((await installNotificationHooks(cwd, 'opencode', runtime)).ok, true)
  const oldPath = join(cwd, '.opencode/plugins/ahk-notifications.js')
  const old = readFileSync(oldPath, 'utf8')
  const service = new MaintenanceService(cwd)
  try {
    const choices = Object.fromEntries(['lead', 'explorer', 'consultant', 'builder', 'reviewer'].map(role => [role, { model: 'inherit' }]))
    const plan = await service.execute('migrate.provider.plan', { to: 'opencode-v2', choices })
    const result = await service.execute('migrate.provider.apply', { planId: plan.data!.planId })
    assert.equal(result.ok, true, result.message)
    assert.equal(existsSync(oldPath), false)
    assert.equal(existsSync(join(cwd, '.opencode/plugins/ahk-notifications-v2/index.js')), true)
    assert.equal(readFileSync(join(String(result.data!.backupDir), '.opencode/plugins/ahk-notifications.js'), 'utf8'), old)
  } finally { await service.dispose() }
})

function snapshot(root: string, prefix = ''): Record<string, string> {
  return Object.fromEntries(readdirSync(join(root, prefix), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
    const path = join(prefix, entry.name)
    return entry.isDirectory() ? Object.entries(snapshot(root, path)) : [[path, readFileSync(join(root, path)).toString('base64')]]
  }))
}
const inheritedChoices = () => Object.fromEntries(['lead', 'explorer', 'consultant', 'builder', 'reviewer'].map(role => [role, { model: 'inherit' }]))

test('capture decodes supported YAML model scalars and rejects malformed metadata without saving preferences', async () => {
  const { cwd, config } = fixture()
  await new OpenCodeV2Materializer().scaffold(config, { cwd })
  const path = join(cwd, '.opencode/agents/builder.md')
  const original = readFileSync(path, 'utf8')
  const service = new MaintenanceService(cwd)
  try {
    for (const scalar of ['team/model#high', "'team/model#high'", '"team/model#high"', 'team/model#high # team choice', "'team/model#high' # team choice", '"team/model#high" # team choice']) {
      writeFileSync(path, original.replace(/^mode: subagent$/m, `mode: subagent\nmodel: ${scalar}`))
      const plan = await service.execute('sync.plan', { captureModels: true })
      assert.equal(plan.ok, true, plan.message)
      const result = await service.execute('sync.apply', { planId: plan.data!.planId })
      assert.equal(result.ok, true, result.message)
      assert.equal((await loadConfig(cwd)).agentPreferences?.['opencode-v2']?.builder?.model, 'team/model#high')
    }
    const prefsPath = join(cwd, 'agent-harness-kit.config.local.json')
    const before = readFileSync(prefsPath, 'utf8')
    for (const scalar of ["'team/model#high", '"team/model#high', "'team/model#high' trailing", '"team/model#high" trailing', '', 'team/model#high trailing', "team/mod'el#high"]) {
      writeFileSync(path, original.replace(/^mode: subagent$/m, `mode: subagent\nmodel: ${scalar}`))
      const plan = await service.execute('sync.plan', { captureModels: true })
      const result = await service.execute('sync.apply', { planId: plan.data!.planId })
      assert.equal(result.ok, false, `must reject ${JSON.stringify(scalar)}`)
      assert.equal(result.code, 'needs_input')
      assert.equal(readFileSync(prefsPath, 'utf8'), before)
    }
    for (const model of ["'team/model#high'", '"team/model#high"']) assert.equal(openCodeV2PreferenceSchema.safeParse({ model }).success, false)
  } finally { await service.dispose() }
})

test('owned v1 plus custom destination v2 plugin conflicts before any project bytes change', async () => {
  const { cwd, config } = fixture('opencode')
  await new OpenCodeMaterializer().scaffold(config, { cwd })
  assert.equal((await installNotificationHooks(cwd, 'opencode', { node: process.execPath, cli: join(process.cwd(), 'dist/cli.js') })).ok, true)
  const directory = join(cwd, '.opencode/plugins/ahk-notifications-v2')
  mkdirSync(directory)
  writeFileSync(join(directory, 'index.js'), '// my own v2 plugin\n')
  const before = snapshot(cwd)
  const service = new MaintenanceService(cwd)
  try {
    const plan = await service.execute('migrate.provider.plan', { to: 'opencode-v2', choices: inheritedChoices() })
    const result = await service.execute('migrate.provider.apply', { planId: plan.data!.planId })
    assert.equal(result.code, 'custom_plugin_conflict')
    assert.deepEqual(snapshot(cwd), before)
    assert.equal((await loadConfig(cwd)).provider, 'opencode')
  } finally { await service.dispose() }
})

test('incompatible absent-target destination manifest and shared resource collision fail before mutation', async () => {
  for (const conflict of ['manifest', 'resource'] as const) {
    const { cwd, config } = fixture('opencode')
    await new OpenCodeMaterializer().scaffold(config, { cwd })
    if (conflict === 'manifest') writeFileSync(join(cwd, '.harness/notifications-hooks-opencode-v2.json'), '{"version":999,"path":"wrong"}')
    else {
      const path = join(cwd, '.opencode/skills/ahk-docs/resources/opencode-v2.md')
      rmSync(path); mkdirSync(path)
    }
    const before = snapshot(cwd)
    const service = new MaintenanceService(cwd)
    try {
      const plan = await service.execute('migrate.provider.plan', { to: 'opencode-v2', choices: inheritedChoices() })
      const result = await service.execute('migrate.provider.apply', { planId: plan.data!.planId })
      assert.equal(result.ok, false)
      assert.deepEqual(snapshot(cwd), before)
    } finally { await service.dispose() }
  }
})

test('late provider-save failure exposes verified backup and recovery metadata rather than claiming atomicity', async () => {
  const { cwd, config } = fixture('opencode')
  await new OpenCodeMaterializer().scaffold(config, { cwd })
  const original = readFileSync(join(cwd, '.opencode/agents/lead.md'), 'utf8')
  // A real concurrent overlay writer can prevent the final save after generation.
  writeFileSync(join(cwd, 'agent-harness-kit.config.local.json.lock'), '')
  const service = new MaintenanceService(cwd)
  try {
    const plan = await service.execute('migrate.provider.plan', { to: 'opencode-v2', choices: inheritedChoices() })
    const result = await service.execute('migrate.provider.apply', { planId: plan.data!.planId })
    assert.equal(result.ok, false)
    assert.equal(result.code, 'concurrent_edit')
    assert.equal(typeof result.data?.backupDir, 'string')
    assert.equal(readFileSync(join(String(result.data!.backupDir), '.opencode/agents/lead.md'), 'utf8'), original)
    assert.match(String(result.data?.recovery), /not atomic/)
    assert.equal(result.data?.previousProvider, 'opencode')
    assert.equal((await loadConfig(cwd)).provider, 'opencode')
    assert.match(readFileSync(join(cwd, '.opencode/agents/lead.md'), 'utf8'), /mode: primary/)
  } finally { await service.dispose() }
})

test('shared reset flags cannot bypass actual provider identity or native-content preservation', async () => {
  for (const provider of ['opencode', 'opencode-v2'] as const) {
    const { cwd, config } = fixture(provider)
    await (provider === 'opencode' ? new OpenCodeMaterializer() : new OpenCodeV2Materializer()).scaffold(config, { cwd })
    const path = join(cwd, '.opencode/agents/builder.md')
    writeFileSync(path, readFileSync(path, 'utf8') + '\ncustom behavior\n')
    const before = snapshot(cwd)
    const service = new MaintenanceService(cwd)
    try {
      const result = await service.execute('reset.plan', { provider: provider === 'opencode' ? 'opencode-v2' : 'opencode', targets: ['builder'], force: true })
      assert.equal(result.ok, false)
      assert.match(result.message!, /provider mismatch/)
      assert.deepEqual(snapshot(cwd), before)
    } finally { await service.dispose() }
  }
  const { cwd, config } = fixture('opencode')
  await new OpenCodeMaterializer().scaffold(config, { cwd })
  writeFileSync(join(cwd, '.opencode/agents/builder.md'), opencodeV2AgentFiles(config).find(entry => entry.relPath.endsWith('/builder.md'))!.content)
  const before = snapshot(cwd)
  const service = new MaintenanceService(cwd)
  try {
    const result = await service.execute('reset.plan', { provider: 'opencode', targets: ['builder'], force: true })
    assert.equal(result.ok, false)
    assert.match(result.message!, /V2 content/)
    assert.deepEqual(snapshot(cwd), before)
  } finally { await service.dispose() }
})

test('config-only project still returns a real backup on late migration failure', async () => {
  const { cwd } = fixture('opencode')
  const configPath = join(cwd, 'agent-harness-kit.config.json')
  const original = readFileSync(configPath, 'utf8')
  writeFileSync(join(cwd, 'agent-harness-kit.config.local.json.lock'), '')
  const service = new MaintenanceService(cwd)
  try {
    const plan = await service.execute('migrate.provider.plan', { to: 'opencode-v2', choices: inheritedChoices() })
    const result = await service.execute('migrate.provider.apply', { planId: plan.data!.planId })
    assert.equal(result.code, 'concurrent_edit')
    assert.equal(typeof result.data?.backupDir, 'string')
    assert.equal(readFileSync(join(String(result.data!.backupDir), 'agent-harness-kit.config.json'), 'utf8'), original)
    assert.equal((await loadConfig(cwd)).provider, 'opencode')
    assert.match(String(result.data?.recovery), /not atomic/)
  } finally { await service.dispose() }
})
