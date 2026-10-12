import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chmodSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { normalizeNotifications, projectIdentity } from '../core/notifications/config.js'
import { NotificationLedger } from '../core/notifications/ledger.js'
import { openSQLite } from '../core/sqlite-adapter.js'

test('ledger reserves once, preserves owner and failed/expired terminal delivery', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ahk-notification-ledger-'))
  let now = 10000
  const path = join(directory, 'private/notifications.db')
  const settings = normalizeNotifications({ enabled: true })
  const first = new NotificationLedger(path, settings, () => now)
  const second = new NotificationLedger(path, settings, () => now)
  try {
    const event = first.reserveEvent({
      eventKey: 'task:1:done',
      kind: 'task.completed',
      projectKey: 'project',
    })
    assert.equal(event.ok, true)
    if (!event.ok) return
    const duplicate = second.reserveEvent({
      eventKey: 'task:1:done',
      kind: 'task.completed',
      projectKey: 'project',
    })
    assert.ok(duplicate.ok)
    assert.equal(duplicate.value.id, event.value.id)
    assert.equal(duplicate.value.isNew, false)
    assert.deepEqual(first.claimEvent(event.value.id, 'owner-a'), { ok: true, value: true })
    assert.deepEqual(second.claimEvent(event.value.id, 'owner-b'), { ok: true, value: false })
    assert.deepEqual(second.finishEvent(event.value.id, 'owner-b', 'played'), {
      ok: true,
      value: false,
    })
    now += 5001
    assert.deepEqual(second.claimEvent(event.value.id, 'owner-b'), { ok: true, value: false })
    const final = first.getEvent(event.value.id)
    assert.ok(final.ok)
    assert.equal(final.value?.status, 'skipped')
    assert.equal(statSync(path).mode & 0o777, 0o600)
    assert.equal(statSync(join(directory, 'private')).mode & 0o777, 0o700)
  } finally {
    first.close()
    second.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('episodes survive checks until true recovery/new claim and aggregate retention is bounded', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ahk-notification-retention-'))
  const path = join(directory, 'notifications.db')
  let now = 0
  const settings = normalizeNotifications(undefined, { maxRecords: 10, maxAgeMs: 1000 })
  const ledger = new NotificationLedger(path, settings, () => now)
  try {
    const episode = ledger.episode('p', 1, 1, false)
    assert.deepEqual(ledger.episode('p', 1, 1, false), episode)
    ledger.episode('p', 1, 1, true)
    assert.notDeepEqual(ledger.episode('p', 1, 1, false), episode)
    assert.notDeepEqual(ledger.episode('p', 1, 2, false), episode)
    for (let i = 0; i < 20; i++) {
      now++
      const event = ledger.reserveEvent({
        eventKey: `event${i}`,
        kind: 'health.blocked',
        projectKey: 'p',
      })
      assert.ok(event.ok)
      ledger.bind(event.value.id, 'p', 'claude', 'session', String(i))
      ledger.episode('p', i, 1, false)
    }
    const db = openSQLite(path, true)
    try {
      assert.ok(
        Number(
          db
            .prepare(
              'SELECT (SELECT count(*) FROM events)+(SELECT count(*) FROM bindings)+(SELECT count(*) FROM episodes) AS n'
            )
            .get()?.n
        ) <= 10
      )
    } finally {
      db.close()
    }
    now += 1001
    ledger.reserveEvent({ eventKey: 'fresh', kind: 'task.completed', projectKey: 'p' })
    const check = openSQLite(path, true)
    try {
      assert.equal(
        Number(
          check
            .prepare(
              'SELECT (SELECT count(*) FROM events)+(SELECT count(*) FROM bindings)+(SELECT count(*) FROM episodes) AS n'
            )
            .get()?.n
        ),
        1
      )
    } finally {
      check.close()
    }
  } finally {
    ledger.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('concurrent processes atomically reserve and claim one delivery', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ahk-notification-process-'))
  const path = join(directory, 'notifications.db')
  const settings = normalizeNotifications({ enabled: true })
  const ledger = new NotificationLedger(path, settings)
  ledger.close()
  const code = `import { NotificationLedger } from './src/core/notifications/ledger.ts'; import { normalizeNotifications } from './src/core/notifications/config.ts'; const l=new NotificationLedger(process.argv[1],normalizeNotifications({enabled:true})); const r=l.reserveEvent({eventKey:'same',kind:'task.completed',projectKey:'p'}); const c=r.ok?l.claimEvent(r.value.id,String(process.pid)):r; console.log(JSON.stringify({r,c})); l.close();`
  const run = () =>
    new Promise<string>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ['--import', 'tsx/esm', '--input-type=module', '-e', code, path],
        { stdio: ['ignore', 'pipe', 'pipe'] }
      )
      let output = '',
        errors = ''
      child.stdout.on('data', (data) => {
        output += data
      })
      child.stderr.on('data', (data) => {
        errors += data
      })
      child.on('error', reject)
      child.on('close', (code) => (code === 0 ? resolve(output) : reject(new Error(errors))))
    })
  try {
    const results = (await Promise.all([run(), run()])).map((line) => JSON.parse(line))
    assert.equal(results.filter((row) => row.c.ok && row.c.value).length, 1)
    assert.equal(results[0].r.value.id, results[1].r.value.id)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('default off and project identity distinguish worktrees', () => {
  assert.equal(normalizeNotifications(undefined).enabled, false)
  assert.equal(normalizeNotifications({ maxRecords: 100000 }).maxRecords, 1000)
  assert.equal(normalizeNotifications({ maxRecords: 10, maxAgeMs: 1000 }).maxRecords, 1000)
  assert.equal(normalizeNotifications({ maxRecords: 10, maxAgeMs: 1000 }).maxAgeMs, 86400000)
  const merged = normalizeNotifications(
    { categories: { 'task.completed': false } },
    { categories: { 'health.blocked': false }, enabled: true }
  )
  assert.equal(merged.enabled, true)
  assert.equal(merged.categories['task.completed'], false)
  assert.equal(merged.categories['health.blocked'], false)
  const first = mkdtempSync(join(tmpdir(), 'ahk-project-a-'))
  const second = mkdtempSync(join(tmpdir(), 'ahk-project-b-'))
  try {
    assert.notEqual(projectIdentity(first, 'same'), projectIdentity(second, 'same'))
  } finally {
    rmSync(first, { recursive: true, force: true })
    rmSync(second, { recursive: true, force: true })
  }
})

test('newer schema is rejected without enabling WAL', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ahk-ledger-schema-'))
  const path = join(directory, 'notifications.db')
  const db = openSQLite(path)
  db.exec('PRAGMA user_version=2')
  db.close()
  try {
    assert.throws(
      () => new NotificationLedger(path, normalizeNotifications(undefined)),
      /Unsupported notification ledger schema/
    )
    const check = openSQLite(path)
    try {
      assert.equal(check.prepare('PRAGMA journal_mode').get()?.journal_mode, 'delete')
      assert.equal(check.prepare('PRAGMA user_version').get()?.user_version, 2)
    } finally {
      check.close()
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('one transaction enforces a shrunken aggregate cap across mixed tables and preserves shared parent permissions', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ahk-ledger-mixed-cap-'))
  chmodSync(directory, 0o755)
  const path = join(directory, 'notifications.db')
  const ledger = new NotificationLedger(
    path,
    normalizeNotifications(undefined, { maxRecords: 10 }),
    () => 10000
  )
  const db = openSQLite(path)
  try {
    assert.equal(statSync(directory).mode & 0o777, 0o755)
    for (let i = 0; i < 300; i++) {
      // Reuse IDs across tables to prove deletion honors the exact table/id pair.
      const id = `id-${i}`
      db.prepare(
        'INSERT INTO events(id,eventKey,kind,projectKey,status,createdAt) VALUES(?,?,?,?,?,?)'
      ).run(id, id, 'task.completed', 'p', 'played', i)
      db.prepare(
        'INSERT INTO bindings(id,eventId,projectKey,provider,session,turn,createdAt) VALUES(?,?,?,?,?,?,?)'
      ).run(id, id, 'p', 'claude', 'session', id, i)
      db.prepare(
        'INSERT INTO episodes(id,projectKey,taskId,generation,createdAt) VALUES(?,?,?,?,?)'
      ).run(id, 'p', id, '1', i)
    }
    const result = ledger.reserveEvent({
      eventKey: 'fresh',
      kind: 'task.completed',
      projectKey: 'p',
    })
    assert.ok(result.ok)
    assert.equal(
      Number(
        db
          .prepare(
            'SELECT (SELECT count(*) FROM events)+(SELECT count(*) FROM bindings)+(SELECT count(*) FROM episodes) AS n'
          )
          .get()?.n
      ),
      10
    )
    assert.ok(db.prepare('SELECT id FROM events WHERE eventKey=?').get('fresh'))
    assert.equal(statSync(directory).mode & 0o777, 0o755)
  } finally {
    db.close()
    ledger.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
