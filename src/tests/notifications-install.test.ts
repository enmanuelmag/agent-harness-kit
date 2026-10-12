import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { installNotificationHooks, uninstallNotificationHooks } from '../core/notifications/install'

test('JSON installation preserves custom matchers, repeats idempotently, leaves edited entries on uninstall', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'ahk-hook-install-'))
  try {
    await mkdir(join(cwd, '.claude'))
    const path = join(cwd, '.claude/settings.json')
    const custom = { matcher: 'Write', hooks: [{ type: 'command', command: 'my-command' }] }
    await writeFile(path, JSON.stringify({ hooks: { PostToolUse: [custom] }, other: true }))
    const runtime = { node: '/node with space', cli: "/package's folder/cli.js" }
    assert.equal((await installNotificationHooks(cwd, 'claude-code', runtime)).ok, true)
    const once = await readFile(path, 'utf8')
    assert.equal((await installNotificationHooks(cwd, 'claude-code', runtime)).ok, true)
    assert.equal(await readFile(path, 'utf8'), once)
    const config = JSON.parse(once)
    assert.deepEqual(config.hooks.PostToolUse[0], custom)
    config.hooks.Stop[0].hooks[0].command += ' edited'
    await writeFile(path, JSON.stringify(config))
    const removed = await uninstallNotificationHooks(cwd, 'claude-code')
    assert.equal(removed.ok, true)
    if (removed.ok) assert.equal(removed.value.preserved.length, 1)
    const after = JSON.parse(await readFile(path, 'utf8'))
    assert.deepEqual(after.hooks.PostToolUse, [custom])
    assert.match(after.hooks.Stop[0].hooks[0].command, /edited$/)
    assert.equal(after.other, true)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test('Codex uses official project hooks JSON and never touches existing inline TOML/trust', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'ahk-hook-codex-'))
  try {
    await mkdir(join(cwd, '.codex'))
    const path = join(cwd, '.codex/config.toml')
    const original = '[features]\nhooks = false\n[[hooks.Stop]]\nmatcher = "custom"\n'
    await writeFile(path, original)
    assert.equal(
      (await installNotificationHooks(cwd, 'codex-cli', { node: '/node', cli: '/cli.js' })).ok,
      true
    )
    assert.equal(await readFile(path, 'utf8'), original)
    assert.equal((await uninstallNotificationHooks(cwd, 'codex-cli')).ok, true)
    assert.equal(await readFile(path, 'utf8'), original)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test('OpenCode generated plugin is executable and modified owned content is preserved', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'ahk-hook-plugin-'))
  try {
    const cli = join(cwd, "fake cli's entry.cjs")
    const calls = join(cwd, 'calls.jsonl')
    await writeFile(
      cli,
      `const fs=require('node:fs');let input='';process.stdin.on('data',chunk=>input+=chunk);process.stdin.on('end',()=>fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify({argv:process.argv.slice(2),payload:JSON.parse(input)})+'\\n'));`
    )
    const installed = await installNotificationHooks(cwd, 'opencode', {
      node: process.execPath,
      cli,
    })
    assert.equal(installed.ok, true)
    const path = join(cwd, '.opencode/plugins/ahk-notifications.js')
    const source = await readFile(path, 'utf8')
    const module = await import(
      `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
    )
    const adapter = await module.default()
    assert.equal(typeof adapter['tool.execute.after'], 'function')
    await adapter.event({event:{type:'session.created',properties:{info:{id:'s',projectID:'p',directory:'/project',title:'Session',version:'1',slug:'s',time:{created:1,updated:1}}}}})
    await adapter.event({
      event: { type: 'session.status', properties: { sessionID: 's', status: 'idle' } },
    })
    await adapter.event({
      event: { type: 'session.status', properties: { sessionID: 's', status: { type: 'busy' } } },
    })
    const marker = { notificationSchemaVersion: 1, events: [] }
    await adapter['tool.execute.after'](
      { sessionID: 's', tool: 'mcp', callID: 'call' },
      { title: 'AHK', output: JSON.stringify(marker), metadata: {} }
    )
    await adapter.event({
      event: { type: 'session.status', properties: { sessionID: 's', status: { type: 'retry' } } },
    })
    await adapter.event({
      event: { type: 'session.status', properties: { sessionID: 's', status: { type: 'idle' } } },
    })
    const messages = (await readFile(calls, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    assert.deepEqual(
      messages.map((message) => message.argv.at(-1)),
      ['bind', 'complete']
    )
    assert.deepEqual(messages[0].payload.response, {
      content: [{ type: 'text', text: JSON.stringify(marker) }],
    })
    assert.equal(messages[0].payload.turn_id, messages[1].payload.turn_id)
    await writeFile(path, `${source}\n// user's edit\n`)
    const removed = await uninstallNotificationHooks(cwd, 'opencode')
    assert.equal(removed.ok, true)
    if (removed.ok) assert.deepEqual(removed.value.preserved, [path])
    assert.match(await readFile(path, 'utf8'), /user's edit/)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test('Generated OpenCode plugin verifies main Session info, preserves child/unknown binds and attention, and resets on restart', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'ahk-hook-main-session-'))
  try {
    const cli = join(cwd, 'fake-cli.cjs')
    const calls = join(cwd, 'calls.jsonl')
    await writeFile(cli, `const fs=require('node:fs');let input='';process.stdin.on('data',chunk=>input+=chunk);process.stdin.on('end',()=>fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify({event:process.argv.at(-1),payload:JSON.parse(input)})+'\\n'));`)
    assert.equal((await installNotificationHooks(cwd, 'opencode', { node: process.execPath, cli })).ok, true)
    const source = await readFile(join(cwd, '.opencode/plugins/ahk-notifications.js'), 'utf8')
    const module = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
    const adapter = await module.default()
    const marker = { notificationSchemaVersion: 1, events: [] }
    const cycle = async (plugin: { event: (input: unknown) => Promise<void>; "tool.execute.after": (input: unknown, output: unknown) => Promise<void> }, sessionID: string) => {
      for (const type of ['idle', 'busy']) await plugin.event({ event: { type: 'session.status', properties: { sessionID, status: { type } } } })
      await plugin['tool.execute.after']({ sessionID, tool: 'mcp', callID: 'c' }, { output: JSON.stringify(marker), metadata: {} })
      await plugin.event({ event: { type: 'permission.asked', properties: { sessionID, id: `${sessionID}-permission` } } })
      await plugin.event({ event: { type: 'session.status', properties: { sessionID, status: { type: 'idle' } } } })
    }
    await adapter.event({ event: { type: 'session.created', properties: { info: { id: 'main', projectID:'p', directory:'/project', title:'Session', version:'1', slug:'s', time:{created:1,updated:1} } } } })
    await adapter.event({ event: { type: 'session.updated', properties: { info: { id: 'child', parentID: 'main', projectID:'p', directory:'/project', title:'Session', version:'1', slug:'s', time:{created:1,updated:1} } } } })
    await cycle(adapter, 'main')
    await cycle(adapter, 'child')
    await cycle(adapter, 'unknown')
    await adapter.event({ event: { type: 'session.updated', properties: { info: { id: 'partial' } } } })
    await cycle(adapter, 'partial')
    await cycle(await module.default(), 'main') // A new plugin has no inherited classification.
    const lookupCalls: string[] = []
    const lookup = await module.default({ client: { session: { get: async ({ path }: { path: { id: string } }) => {
      lookupCalls.push(path.id)
      if (path.id === 'sdk-main') return { data: { id: path.id, projectID:'p', directory:'/project', title:'Session', version:'1', slug:'s', time:{created:1,updated:1} } }
      if (path.id === 'sdk-child') return { data: { id: path.id, parentID: 'sdk-main', projectID:'p', directory:'/project', title:'Session', version:'1', slug:'s', time:{created:1,updated:1} } }
      if (path.id === 'sdk-mismatch') return { data: { id: 'another-session' } }
      if (path.id === 'sdk-timeout') return new Promise(() => {})
      return {}
    } } } })
    for (const session of ['sdk-main', 'sdk-child', 'sdk-unknown', 'sdk-mismatch', 'sdk-timeout']) await cycle(lookup, session)
    // Main lineage can be known even when the turn's start was missed: general fallback only.
    await adapter.event({ event: { type: 'session.created', properties: { info: { id: 'missed-main', projectID: 'p', directory: '/project', title: 'Main', version: '1', slug: 'main', time: { created: 1, updated: 1 } } } } })
    await adapter.event({ event: { type: 'session.status', properties: { sessionID: 'missed-main', status: 'busy' } } })
    await adapter.event({ event: { type: 'session.status', properties: { sessionID: 'missed-main', status: 'idle' } } })
    // The lookup and later lifecycle callbacks must remain ordered for this session.
    let resolveLookup!: (value: unknown) => void
    const raceAdapter = await module.default({ client: { session: { get: () => new Promise(resolve => { resolveLookup = resolve }) } } })
    await raceAdapter.event({ event: { type: 'session.status', properties: { sessionID: 'sdk-race', status: 'busy' } } })
    const firstIdle = raceAdapter.event({ event: { type: 'session.status', properties: { sessionID: 'sdk-race', status: 'idle' } } })
    const laterBusy = raceAdapter.event({ event: { type: 'session.status', properties: { sessionID: 'sdk-race', status: 'busy' } } })
    const laterTool = raceAdapter['tool.execute.after']({ sessionID: 'sdk-race' }, { output: JSON.stringify(marker) })
    const laterIdle = raceAdapter.event({ event: { type: 'session.status', properties: { sessionID: 'sdk-race', status: 'idle' } } })
    await new Promise(resolve => setImmediate(resolve))
    resolveLookup({ data: { id: 'sdk-race', projectID: 'p', directory: '/project', title: 'Main', version: '1', slug: 'main', time: { created: 1, updated: 1 } } })
    await Promise.all([firstIdle, laterBusy, laterTool, laterIdle])
    const messages = (await readFile(calls, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    assert.deepEqual(messages.filter(message => message.event === 'complete').map(message => message.payload.session_id), ['main', 'sdk-main', 'missed-main', 'sdk-race', 'sdk-race'])
    const race = messages.filter(message => message.payload.session_id === 'sdk-race')
    assert.deepEqual(race.map(message => message.event), ['complete', 'bind', 'complete'])
    assert.equal(race[0].payload.turn_id, undefined)
    assert.equal(race[1].payload.turn_id, race[2].payload.turn_id)
    assert.equal(messages.some(message => message.event === 'complete' && message.payload.session_id === 'partial'), false)
    for (const session of ['main', 'child', 'unknown', 'sdk-main', 'sdk-child', 'sdk-unknown', 'sdk-mismatch', 'sdk-timeout']) {
      assert.ok(messages.some(message => message.event === 'bind' && message.payload.session_id === session))
      assert.ok(messages.some(message => message.event === 'attention' && message.payload.session_id === session))
    }
    assert.equal(lookupCalls.filter(id => id === 'sdk-main').length, 1)
    assert.equal(lookupCalls.filter(id => id === 'sdk-child').length, 1)
    assert.equal(lookupCalls.filter(id => id === 'sdk-timeout').length, 1)
    // Timed-out SDK requests remain in the bounded pending set until they settle.
    const hangingCalls: string[] = []
    const hanging = await module.default({ client: { session: { get: ({ path }: { path: { id: string } }) => {
      hangingCalls.push(path.id)
      return new Promise(() => {})
    } } } })
    const idle = (sessionID: string) => hanging.event({ event: { type: 'session.status', properties: { sessionID, status: 'idle' } } })
    await idle('same-hung-session')
    await idle('same-hung-session')
    assert.deepEqual(hangingCalls, ['same-hung-session'])
    await Promise.all(Array.from({ length: 80 }, (_, index) => idle(`hung-${index}`)))
    assert.equal(hangingCalls.length, 64)
    await Promise.all(Array.from({ length: 80 }, (_, index) => idle(`more-hung-${index}`)))
    await idle('same-hung-session')
    assert.equal(hangingCalls.length, 64)
  } finally { await rm(cwd, { recursive: true, force: true }) }
})
