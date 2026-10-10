import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { test } from 'node:test'

import { SQLiteDriver } from '@/core/drivers/sqlite'
import { openSQLite } from '@/core/sqlite-adapter'

const FIXTURE = join(import.meta.dirname, 'fixtures/sqlite-v12/harness.sqlite')
const provenance = JSON.parse(
  readFileSync(join(import.meta.dirname, 'fixtures/sqlite-v12/provenance.json'), 'utf8')
) as { writer: string; sha256: string }
const digest = () => createHash('sha256').update(readFileSync(FIXTURE)).digest('hex')

test('native adapter preserves a v12 file through schema checks, writes, transactions and reopen', async (t) => {
  assert.equal(provenance.writer, '12.11.1')
  assert.equal(digest(), provenance.sha256)
  const cwd = mkdtempSync(join(import.meta.dirname, '../../.tmp-sqlite-native-'))
  const path = join(cwd, 'copy.sqlite')
  copyFileSync(FIXTURE, path)
  let driver = new SQLiteDriver(path)
  let driverOpen = true
  try {
    const require = createRequire(import.meta.url)
    t.diagnostic(
      JSON.stringify({
        node: process.version,
        napi: process.versions.napi,
        platform: process.platform,
        arch: process.arch,
        driver: require('better-sqlite3/package.json').version,
        sqlite: await driver.queryOne('SELECT sqlite_version() AS version'),
      })
    )
    const originalSchema = await driver.query('SELECT name, sql FROM sqlite_master ORDER BY name')
    await driver.ensureSchema()
    await driver.ensureSchema()
    assert.deepEqual(
      await driver.query('SELECT name, sql FROM sqlite_master ORDER BY name'),
      originalSchema
    )
    const originalRows = await driver.query(`
      SELECT t.id AS taskId, t.title, a.id AS actionId, s.id AS sectionId, s.content,
             ac.id AS acceptanceId, ac.criterion, ac.met
      FROM tasks t JOIN actions a ON a.task_id = t.id
      JOIN action_sections s ON s.action_id = a.id
      JOIN task_acceptance ac ON ac.task_id = t.id
    `)
    assert.deepEqual(originalRows, [
      {
        taskId: 7,
        title: 'Persisted café ✓',
        actionId: 11,
        sectionId: 13,
        content: 'Original v12 evidence 日本語',
        acceptanceId: 9,
        criterion: 'Preserve old relationships',
        met: 1,
      },
    ])
    await assert.rejects(
      () =>
        driver.insert(
          "INSERT INTO actions (task_id, agent, created_at) VALUES (999, 'builder', 'now')"
        ),
      /FOREIGN KEY/
    )
    const committed = await driver.transaction(async (tx) => {
      const id = await tx.insert(
        "INSERT INTO tasks (slug, title, created_at) VALUES ('committed', 'New write', 'now')"
      )
      const actionId = await tx.insert(
        "INSERT INTO actions (task_id, agent, created_at) VALUES (?, 'reviewer', 'now')",
        [id]
      )
      assert.ok(id > 7)
      assert.ok(actionId > 11)
      assert.equal(
        await tx.exec('UPDATE tasks SET description = ? WHERE id = ?', ['Committed ✓', id]),
        1
      )
      return { id, actionId }
    })
    await assert.rejects(
      () =>
        driver.transaction(async (tx) => {
          await tx.exec("UPDATE tasks SET title = 'Lost' WHERE id = 7")
          await tx.insert(
            "INSERT INTO tasks (slug, title, created_at) VALUES ('rolled-back', 'Lost', 'now')"
          )
          throw new Error('Deliberate rollback')
        }),
      /Deliberate rollback/
    )
    await driver.reconnect()
    assert.deepEqual(await driver.queryOne('SELECT title FROM tasks WHERE id = 7'), {
      title: 'Persisted café ✓',
    })
    await driver.close()
    driverOpen = false
    driver = new SQLiteDriver(path)
    driverOpen = true
    await driver.ensureSchema()
    assert.deepEqual(
      await driver.queryOne('SELECT description FROM tasks WHERE id = ?', [committed.id]),
      { description: 'Committed ✓' }
    )
    assert.deepEqual(
      await driver.queryOne('SELECT task_id FROM actions WHERE id = ?', [committed.actionId]),
      { task_id: committed.id }
    )
    assert.equal(await driver.queryOne("SELECT id FROM tasks WHERE slug = 'rolled-back'"), null)
    assert.deepEqual(await driver.query('PRAGMA foreign_key_check'), [])
    await driver.close()
    driverOpen = false
    const native = openSQLite(path)
    try {
      assert.deepEqual(native.prepare('PRAGMA integrity_check').get(), { integrity_check: 'ok' })
      assert.equal(native.prepare('SELECT count(*) AS n FROM tasks').get()!.n, 2)
    } finally {
      native.close()
    }
  } finally {
    if (driverOpen) await driver.close()
    rmSync(cwd, { recursive: true, force: true })
    assert.equal(digest(), provenance.sha256, 'pristine v12 fixture must not be changed')
  }
})
