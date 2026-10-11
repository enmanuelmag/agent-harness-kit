import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { Client, InMemoryTransport } from '@modelcontextprotocol/client'

import {
  DatabaseDiagnostics,
  normalizeDatabaseDiagnostics,
  withDatabaseNoticeSink,
} from '../core/database-diagnostics'
import { HarnessDB, openDB } from '../core/db'
import { SQLiteDriver } from '../core/drivers/sqlite'
import { createMcpServer } from '../core/mcp-server'

import type { DBDriver } from '../core/drivers/types'
import type { HarnessConfig } from '../types'
const root = join(import.meta.dirname, '../../.tmp-database-diagnostics')
const config: HarnessConfig = {
  project: { name: 'diagnostics', description: '', docsPath: './docs' },
  provider: 'codex-cli',
  database: { type: 'sqlite' },
  storage: {
    scope: 'local',
    dir: '.harness',
    projectId: 'diagnostics',
    sqlitePath: join(root, 'harness.db'),
    sections: {
      toolsUsed: true,
      filesModified: true,
      result: true,
      blockers: true,
      nextSteps: false,
    },
  },
  health: { scriptPath: './health.sh', required: true },
  tools: {
    mcp: { enabled: true, port: 3742 },
    scripts: { enabled: false, outputDir: '.harness/scripts' },
  },
}
function fixture(settings?: unknown) {
  let time = 0,
    delay = 500,
    probes = 0,
    committed = 0,
    rolledBack = 0
  let failure: unknown
  const driver: DBDriver = {
    async query() {
      time += delay
      if (failure) throw failure
      return []
    },
    async queryOne<T>(sql: string) {
      time += delay
      if (failure) throw failure
      if (sql.includes('COUNT')) {
        probes++
        return { count: 1000 } as T
      }
      return null
    },
    async insert() {
      time += delay
      return 7
    },
    async exec() {
      time += delay
      return 1
    },
    async execRaw() {
      time += delay
    },
    async transaction(fn) {
      try {
        const result = await fn(driver)
        committed++
        return result
      } catch (error) {
        rolledBack++
        throw error
      }
    },
    async ensureSchema() {},
    async reconnect() {},
    async close() {},
  }
  const observer = new DatabaseDiagnostics(
    settings,
    () => time,
    () => new Date('2026-10-10T00:00:00Z')
  )
  return {
    driver,
    observer,
    tick: (n: number) => {
      time += n
    },
    delay: (n: number) => {
      delay = n
    },
    fail: (e: unknown) => {
      failure = e
    },
    counts: () => ({ probes, committed, rolledBack }),
  }
}
test('actual driver calls preserve values, original rejection and transaction outcomes without inclusive or delegated counting', async () => {
  const f = fixture(),
    db = f.observer.wrap(f.driver)
  for (let i = 0; i < 8; i++) await db.query('ignored')
  assert.equal(
    await db.transaction(async (tx) => {
      assert.equal(await tx.insert('ignored'), 7)
      return 'committed'
    }),
    'committed'
  )
  assert.equal(f.observer.takeNotice(), undefined, 'nine calls, no inclusive transaction sample')
  await db.execRaw('ignored')
  assert.equal(f.observer.takeNotice()?.code, 'database-sustained-latency')
  assert.equal(f.observer.takeNotice(), undefined, 'cooldown')
  const original = { message: 'original rejection' }
  f.fail(original)
  await assert.rejects(
    db.transaction((tx) => tx.queryOne('ignored')),
    (e) => e === original
  )
  assert.deepEqual(f.counts(), { probes: 0, committed: 1, rolledBack: 1 })
  const broken = new DatabaseDiagnostics(undefined, () => {
    throw original
  }).wrap(f.driver)
  await assert.rejects(broken.query('ignored'), (e) => e === original)
})
test('all conditions, window, bounded sample cap, cooldown and instance isolation matter', async () => {
  const f = fixture(),
    db = f.observer.wrap(f.driver)
  for (let i = 0; i < 10; i++) {
    f.delay(i < 2 ? 500 : 1)
    await db.exec('ignored')
  }
  assert.equal(f.observer.takeNotice(), undefined, 'two slow samples are insufficient')
  f.delay(500)
  await db.exec('ignored')
  assert.ok(f.observer.takeNotice())
  f.tick(600_001)
  assert.equal(f.observer.takeNotice(), undefined, 'old window expired')
  for (let i = 0; i < 10; i++) await db.exec('ignored')
  assert.ok(f.observer.takeNotice())
  assert.equal(fixture().observer.takeNotice(), undefined)
  f.delay(1)
  for (let i = 0; i < 128; i++) await db.exec('ignored')
  f.tick(600_001)
  assert.equal(f.observer.takeNotice(), undefined)
  const settings = normalizeDatabaseDiagnostics({
    slowMs: Infinity,
    minSamples: 129,
    cooldownMs: -1,
  })
  assert.equal(settings.slowMs, 500)
  assert.equal(settings.minSamples, 10)
  const disabled = new DatabaseDiagnostics({ enabled: false }, () => {
    throw Error('must not clock')
  })
  await disabled.wrap(f.driver).exec('ignored')
  assert.equal(disabled.takeNotice(), undefined)
  await disabled.inspect(f.driver)
  assert.equal(f.counts().probes, 0)
})
test('explicit history facts cache for five minutes, include archived rows, and expire from normal advice', async () => {
  const f = fixture(),
    db = f.observer.wrap(f.driver)
  const queries: { sql: string; params?: unknown[] }[] = []
  const original = f.driver.queryOne.bind(f.driver)
  f.driver.queryOne = (sql, params) => {
    queries.push({ sql, params })
    return original(sql, params)
  }
  const notice = await f.observer.inspect(db)
  assert.match(notice.message, /including archived/)
  assert.match(notice.message, /manually/)
  assert.equal(queries.length, 1)
  assert.match(queries[0].sql, /completed_at < \?/)
  assert.doesNotMatch(queries[0].sql, /archived_at|created_at/)
  assert.deepEqual(queries[0].params, ['2026-07-12T00:00:00.000Z'])
  assert.equal((await f.observer.inspect(db)).details?.storageBytes, 'unknown')
  assert.equal(queries.length, 1)
  for (let i = 0; i < 10; i++) await db.exec('ignored')
  assert.match(f.observer.takeNotice()!.message, /retention/)
  assert.equal(queries.length, 1)
  f.tick(600_001)
  for (let i = 0; i < 10; i++) await db.exec('ignored')
  assert.doesNotMatch(f.observer.takeNotice()!.message, /retention/)
  f.fail(new Error('probe unavailable'))
  assert.match((await f.observer.inspect(db)).message, /unavailable/)
  assert.equal(queries.length, 2)
  await f.observer.inspect(db)
  assert.equal(queries.length, 2, 'failed probe also cached')
})
test('SQLite main plus WAL context and caller sink remain advisory with owned close', async () => {
  mkdirSync(root, { recursive: true })
  const file = join(root, 'size-only')
  writeFileSync(file, '123')
  writeFileSync(file + '-wal', '45')
  try {
    const f = fixture()
    assert.equal((await f.observer.inspect(f.driver, file)).details?.storageBytes, '5')
    let delivered = 0
    await withDatabaseNoticeSink(
      () => {
        delivered++
        throw Error('sink failed')
      },
      async () => {
        const db = new HarnessDB(f.driver, config, undefined, f.observer)
        for (let i = 0; i < 10; i++) await db.getTasks()
        await db.close()
      }
    )
    assert.equal(delivered, 1)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
test('real SDK DB read/write notices preserve DTO, doctor flag and error while file tools get none', async () => {
  mkdirSync(root, { recursive: true })
  mkdirSync(join(root, 'docs'), { recursive: true })
  const driver = new SQLiteDriver(join(root, 'harness.db'))
  await driver.ensureSchema()
  let clock = 0
  const diagnostics = new DatabaseDiagnostics(
    { slowMs: 1, minSamples: 1, minSlow: 1, cooldownMs: 1000 },
    () => {
      clock += 600
      return clock
    }
  )
  const db = new HarnessDB(driver, config, undefined, diagnostics)
  const client = new Client({ name: 'test', version: '1' })
  const server = createMcpServer(config, root, db)
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  try {
    await server.connect(serverTransport)
    await client.connect(clientTransport)
    const tools = await client.listTools()
    assert.ok(tools.tools.find((t) => t.name === 'ahk.doctor')?.inputSchema.properties?.db)
    const added = await client.callTool({
      name: 'tasks.add',
      arguments: { title: 'diagnostic proof', slug: 'proof' },
    })
    assert.equal(added.isError, false)
    assert.equal((added.content as { text: string }[]).length, 2)
    assert.deepEqual(
      JSON.parse((added.content as { text: string }[])[0].text),
      added.structuredContent
    )
    const read = await client.callTool({ name: 'tasks.get', arguments: {} })
    assert.equal((read.content as unknown[]).length, 2)
    const files = await client.callTool({ name: 'specs.list', arguments: {} })
    assert.equal((files.content as unknown[]).length, 1)
    const metadata = await client.callTool({ name: 'ahk.doctor', arguments: {} })
    assert.ok(
      !(metadata.content as { text: string }[]).some((c) => c.text.includes('database-diagnostics'))
    )
    const diagnostic = await client.callTool({ name: 'ahk.doctor', arguments: { db: true } })
    assert.ok(
      (diagnostic.content as { text: string }[]).some((c) =>
        c.text.includes('database-diagnostics')
      )
    )
    assert.deepEqual(
      diagnostic.structuredContent,
      JSON.parse((diagnostic.content as { text: string }[])[0].text)
    )
    const failure = await client.callTool({
      name: 'actions.start',
      arguments: { taskId: 999999, agent: 'builder' },
    })
    assert.equal(failure.isError, true)
    assert.equal((failure.content as unknown[]).length, 2)
  } finally {
    await client.close()
    await server.close()
    await db.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('explicit facade probe never contributes latency samples', async () => {
  const f = fixture()
  const db = new HarnessDB(f.driver, config, undefined, f.observer)
  await db.databaseDiagnosticNotice()
  for (let i = 0; i < 9; i++) await db.getTasks()
  assert.equal(f.observer.takeNotice(), undefined)
  await db.getTasks()
  assert.ok(f.observer.takeNotice())
  assert.equal(f.counts().probes, 1)
  await db.close()
})

test('diagnostic-only SQLite opening never migrates schema, changes journal mode or removes sidecars', async () => {
  mkdirSync(root, { recursive: true })
  const file = join(root, 'legacy.db')
  const { openSQLite } = await import('../core/sqlite-adapter')
  const raw = openSQLite(file)
  raw.exec("CREATE TABLE sentinel (value TEXT); INSERT INTO sentinel VALUES ('preserve')")
  raw.close()
  const before = readFileSync(file)
  writeFileSync(file + '-wal', '')
  writeFileSync(file + '-shm', 'preserve stale sidecar')
  try {
    const db = await openDB(
      { ...config, storage: { ...config.storage, scope: 'local', sqlitePath: file } },
      root,
      undefined,
      { initializeSchema: false }
    )
    assert.match((await db.databaseDiagnosticNotice()).message, /unavailable/)
    await db.close()
    assert.deepEqual(readFileSync(file), before)
    assert.equal(readFileSync(file + '-shm', 'utf8'), 'preserve stale sidecar')
    const missing = join(root, 'absent.db')
    await assert.rejects(
      openDB(
        { ...config, storage: { ...config.storage, scope: 'local', sqlitePath: missing } },
        root,
        undefined,
        { initializeSchema: false }
      )
    )
    assert.equal(existsSync(missing), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('slow fraction and fixed sample cap prevent warnings from a minority or evicted history', async () => {
  const f = fixture({ cooldownMs: 1000 }),
    driver = f.observer.wrap(f.driver)
  for (let i = 0; i < 20; i++) {
    f.delay(i < 3 ? 500 : 1)
    await driver.exec('ignored')
  }
  assert.equal(f.observer.takeNotice(), undefined, 'three slow calls below twenty percent')
  f.delay(500)
  for (let i = 0; i < 10; i++) await driver.exec('ignored')
  assert.ok(f.observer.takeNotice())
  f.delay(1)
  for (let i = 0; i < 128; i++) await driver.exec('ignored')
  f.tick(1001)
  assert.equal(
    f.observer.takeNotice(),
    undefined,
    'slow history evicted by cap before window expires'
  )
})

test('three concurrent explicit diagnostics share one in-flight probe and cached result', async () => {
  const f = fixture()
  let release!: (value: { count: number }) => void
  let probes = 0
  const wait = new Promise<{ count: number }>((resolve) => {
    release = resolve
  })
  f.driver.queryOne = async <T>() => {
    probes++
    return (await wait) as T
  }
  const first = f.observer.inspect(f.driver)
  const second = f.observer.inspect(f.driver)
  const third = f.observer.inspect(f.driver)
  assert.equal(probes, 1)
  release({ count: 1000 })
  const notices = await Promise.all([first, second, third])
  assert.deepEqual(notices[0], notices[1])
  assert.deepEqual(notices[1], notices[2])
  assert.equal(probes, 1)
  assert.deepEqual(await f.observer.inspect(f.driver), notices[0])
  assert.equal(probes, 1)
})
