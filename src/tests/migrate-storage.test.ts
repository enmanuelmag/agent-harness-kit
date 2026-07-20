import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, test } from 'node:test'

import { runMigrateStorage } from '@/commands/migrate-storage'
import {
  getRowCounts,
  importFullExport,
  isEmptyDatabase,
  openDB,
  readStorageStateFile,
  resolveGlobalStorageDir,
} from '@/core/db'
import { SQLiteDriver } from '@/core/drivers/sqlite'
import { TaskRepository } from '@/core/repositories/TaskRepository'
import { MockRemoteDriver } from '@/tests/helpers/mock-remote-driver'

import type { HarnessDB } from '@/core/db'
import type { HarnessConfig, LocalStorageConfig } from '@/types'

const TMP = join(import.meta.dirname, '../../.tmp-migrate-storage-test')

function baseConfig(overrides: Partial<HarnessConfig> = {}): HarnessConfig {
  return {
    project: { name: 'test', description: 'test project', docsPath: './docs' },
    provider: 'claude-code',
    database: { type: 'sqlite' },
    storage: {
      dir: '.harness',
      tasks: { adapter: 'local' },
      sections: {
        toolsUsed: true,
        filesModified: true,
        result: true,
        blockers: true,
        nextSteps: false,
      },
      markdownFallback: { enabled: true, path: '.harness/current.md' },
      scope: 'local',
      projectId: 'migrate-storage-test-project',
    },
    health: { scriptPath: './health.sh', required: false },
    tools: {
      mcp: { enabled: false, port: 3456 },
      scripts: { enabled: false, outputDir: '.harness/scripts' },
    },
    ...overrides,
  }
}

const SHARED_STORAGE_FIELDS = {
  dir: '.harness',
  tasks: { adapter: 'local' as const },
  sections: {
    toolsUsed: true,
    filesModified: true,
    result: true,
    blockers: true,
    nextSteps: false,
  },
}

/** Builds a `LocalStorageConfig`-shaped storage override for `baseConfig()`.
 *  NOT a spread of `baseConfig().storage` — that property's static type is
 *  the `StorageConfig` union (not narrowed to a specific member just because
 *  the runtime value happens to be 'local'), so spreading it and overriding
 *  `scope` doesn't type-check cleanly against either union member (task #56).
 *  Building the object from known-local fields sidesteps that entirely. */
function localStorage(projectId: string, overrides: Partial<Omit<LocalStorageConfig, 'scope' | 'projectId'>> = {}): HarnessConfig['storage'] {
  return {
    ...SHARED_STORAGE_FIELDS,
    markdownFallback: { enabled: true, path: '.harness/current.md' },
    scope: 'local',
    projectId,
    ...overrides,
  }
}

/** Builds a `GlobalStorageConfig`-shaped storage override for `baseConfig()`.
 *  Not a spread of `baseConfig().storage` — that's the 'local' branch of the
 *  discriminated union (has `markdownFallback.path`), and per task #56 there
 *  is no valid way to spread a LocalStorageConfig into a GlobalStorageConfig
 *  (the union forbids `markdownFallback.path` under scope='global'). */
function globalStorage(projectId: string): HarnessConfig['storage'] {
  return {
    ...SHARED_STORAGE_FIELDS,
    markdownFallback: { enabled: true },
    scope: 'global',
    projectId,
  }
}

async function writeConfigFile(projectDir: string, config: HarnessConfig): Promise<void> {
  mkdirSync(projectDir, { recursive: true })
  const content = `export default ${JSON.stringify(config, null, 2)}\n`
  writeFileSync(join(projectDir, 'agent-harness-kit.config.ts'), content, 'utf8')
}

let seedCounter = 0

async function seedData(db: HarnessDB): Promise<{ taskId: number }> {
  const slug = `seed-task-${++seedCounter}`
  const task = await db.addTask({ slug, title: 'Seed Task', acceptance: ['must pass'] })
  const action = await db.startAction(task.id, 'lead')
  await db.recordFile(action.id, 'src/index.ts', 'modified', 'note')
  await db.recordTool(action.id, 'Bash', '{"cmd":"ls"}', 'summary')
  await db.writeSection(action.id, 'result', 'done')
  await db.completeAction(action.id, 'done')
  return { taskId: task.id }
}

describe('exportJson — full 6-table export (task #47)', () => {
  const dir = join(TMP, 'export-full')
  afterEach(() => rmSync(TMP, { recursive: true, force: true }))

  test('includes tasks, task_acceptance, actions, action_sections, action_files, action_tools', async () => {
    mkdirSync(dir, { recursive: true })
    const config = baseConfig({ storage: localStorage('migrate-storage-test-project', { sqlitePath: join(dir, 'harness.db') }) })
    const db = await openDB(config, dir)
    try {
      await seedData(db)
      const data = await db.exportJson()
      assert.equal(data.tasks.length, 1)
      assert.equal(data.taskAcceptance.length, 1)
      assert.equal(data.actions.length, 1)
      assert.equal(data.sections.length, 1)
      assert.equal(data.actionFiles.length, 1)
      assert.equal(data.actionTools.length, 1)
    } finally {
      await db.close()
    }
  })
})

describe('importFullExport — id preservation, transactional rollback, sequence reset', () => {
  const dir = join(TMP, 'import-full')
  afterEach(() => rmSync(TMP, { recursive: true, force: true }))

  test('imports all 6 tables into an empty sqlite destination with matching row counts', async () => {
    mkdirSync(dir, { recursive: true })
    const srcConfig = baseConfig({ storage: localStorage('migrate-storage-test-project', { sqlitePath: join(dir, 'src.db') }) })
    const srcDb = await openDB(srcConfig, dir)
    let data
    try {
      await seedData(srcDb)
      await seedData(srcDb)
      data = await srcDb.exportJson()
    } finally {
      await srcDb.close()
    }

    const destDriver = new SQLiteDriver(join(dir, 'dest.db'))
    await destDriver.ensureSchema()
    try {
      assert.equal(await isEmptyDatabase(destDriver), true)
      await importFullExport(destDriver, data, 'sqlite', { truncateFirst: false })
      const counts = await getRowCounts(destDriver)
      assert.equal(counts.tasks, 2)
      assert.equal(counts.task_acceptance, 2)
      assert.equal(counts.actions, 2)
      assert.equal(counts.action_sections, 2)
      assert.equal(counts.action_files, 2)
      assert.equal(counts.action_tools, 2)
    } finally {
      await destDriver.close()
    }
  })

  test('a failing insert rolls back the ENTIRE import — destination left exactly as found', async () => {
    mkdirSync(dir, { recursive: true })
    const srcConfig = baseConfig({ storage: localStorage('migrate-storage-test-project', { sqlitePath: join(dir, 'src2.db') }) })
    const srcDb = await openDB(srcConfig, dir)
    let data
    try {
      await seedData(srcDb)
      data = await srcDb.exportJson()
    } finally {
      await srcDb.close()
    }

    // Corrupt one row to force a constraint violation partway through the import
    // (task_acceptance references a task_id that will never exist).
    data.taskAcceptance.push({ id: 9999, task_id: 999999, criterion: 'broken', met: 0 })

    const destDriver = new SQLiteDriver(join(dir, 'dest2.db'))
    await destDriver.ensureSchema()
    try {
      await assert.rejects(() =>
        importFullExport(destDriver, data, 'sqlite', { truncateFirst: false })
      )
      const counts = await getRowCounts(destDriver)
      assert.equal(
        counts.tasks,
        0,
        'tasks insert should have been rolled back too, even though it succeeded before the failure'
      )
      assert.equal(counts.task_acceptance, 0)
    } finally {
      await destDriver.close()
    }
  })

  test('sqlite: after import, a subsequent TaskRepository.add() (no explicit id) does not collide with imported ids', async () => {
    mkdirSync(dir, { recursive: true })
    const srcConfig = baseConfig({ storage: localStorage('migrate-storage-test-project', { sqlitePath: join(dir, 'src3.db') }) })
    const srcDb = await openDB(srcConfig, dir)
    let data
    try {
      await seedData(srcDb)
      await seedData(srcDb)
      await seedData(srcDb)
      data = await srcDb.exportJson()
    } finally {
      await srcDb.close()
    }

    const maxImportedId = Math.max(...data.tasks.map((t) => t.id))

    const destDriver = new SQLiteDriver(join(dir, 'dest3.db'))
    await destDriver.ensureSchema()
    try {
      await importFullExport(destDriver, data, 'sqlite', { truncateFirst: false })
      const repo = new TaskRepository(destDriver)
      const newId = await repo.add({ slug: 'post-migration-task', title: 'Post Migration' })
      assert.ok(
        newId > maxImportedId,
        `new id ${newId} must be greater than max imported id ${maxImportedId}`
      )
    } finally {
      await destDriver.close()
    }
  })

  test('mocked remote (postgres-dialect) destination: sequence reset prevents id collision on next insert', async () => {
    mkdirSync(dir, { recursive: true })
    const srcConfig = baseConfig({ storage: localStorage('migrate-storage-test-project', { sqlitePath: join(dir, 'src4.db') }) })
    const srcDb = await openDB(srcConfig, dir)
    let data
    try {
      await seedData(srcDb)
      await seedData(srcDb)
      data = await srcDb.exportJson()
    } finally {
      await srcDb.close()
    }

    const maxImportedId = Math.max(...data.tasks.map((t) => t.id))

    const mockRemote = new MockRemoteDriver()
    await importFullExport(mockRemote, data, 'postgres', { truncateFirst: false })

    const repo = new TaskRepository(mockRemote)
    const newId = await repo.add({ slug: 'remote-post-migration', title: 'Remote Post Migration' })
    assert.ok(
      newId > maxImportedId,
      `new id ${newId} must be greater than max imported id ${maxImportedId} (sequence reset must have run)`
    )
  })

  test('without the sequence reset, the mocked remote driver WOULD collide (sanity check the mock itself)', async () => {
    const mockRemote = new MockRemoteDriver()
    await mockRemote.exec(
      `INSERT INTO tasks (id, slug, title, description, status, assigned_to, created_at, started_at, completed_at, archived_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [5, 'explicit-id-task', 'T', null, 'pending', null, 'now', null, null, null, 'now']
    )
    const repo = new TaskRepository(mockRemote)
    const newId = await repo.add({ slug: 'collides', title: 'Collides' })
    // Demonstrates why resetAutoincrementSequences() is non-negotiable: without it,
    // the mock's internal counter is still at 0, so the very next implicit insert reuses id 1.
    assert.equal(newId, 1)
    assert.notEqual(newId, 6, 'sanity: this driver does NOT auto-advance on explicit-id inserts')
  })
})

describe('runMigrateStorage — CLI command (task #47)', () => {
  const TMP_CMD = join(TMP, 'cmd')
  const FAKE_HOME = join(TMP_CMD, 'fake-home')

  afterEach(() => rmSync(TMP, { recursive: true, force: true }))

  test('case: scope + dbType already match config → "nothing to migrate", storage-state written', async () => {
    const projectDir = join(TMP_CMD, 'match')
    const config = baseConfig({
      storage: localStorage('match-project'),
    })
    await writeConfigFile(projectDir, config)

    await runMigrateStorage(projectDir, {}, FAKE_HOME)

    const state = readStorageStateFile(projectDir, '.harness')
    assert.ok(state)
    assert.equal(state?.scope, 'local')
    assert.equal(state?.dbType, 'sqlite')
  })

  test('case: local -> global scope migration moves the .db file and current.md, preserves task data', async () => {
    const projectDir = join(TMP_CMD, 'local-to-global')
    const localConfig = baseConfig({
      storage: localStorage('l2g-project'),
    })
    await writeConfigFile(projectDir, localConfig)

    // Seed local data and record state=local first.
    const db = await openDB(localConfig, projectDir, FAKE_HOME)
    await seedData(db)
    await db.writeStorageState(projectDir)
    await db.close()

    const localDbPath = join(projectDir, '.harness', 'harness.db')
    assert.ok(existsSync(localDbPath))

    // Now flip config to scope=global and run the migration.
    const globalConfig = baseConfig({
      storage: globalStorage('l2g-project'),
    })
    await writeConfigFile(projectDir, globalConfig)

    await runMigrateStorage(projectDir, {}, FAKE_HOME)

    const globalDir = resolveGlobalStorageDir(globalConfig, FAKE_HOME)
    assert.ok(
      existsSync(join(globalDir, 'harness.db')),
      'db should now exist at the global location'
    )
    assert.ok(
      !existsSync(localDbPath),
      'local db file should have been removed after a verified copy'
    )

    const state = readStorageStateFile(projectDir, '.harness')
    assert.equal(state?.scope, 'global')

    // Verify data survived the move.
    const movedDriver = new SQLiteDriver(join(globalDir, 'harness.db'))
    try {
      const counts = await getRowCounts(movedDriver)
      assert.equal(counts.tasks, 1)
    } finally {
      await movedDriver.close()
    }
  })

  test('case: global -> local scope migration moves data back', async () => {
    const projectDir = join(TMP_CMD, 'global-to-local')
    const globalConfig = baseConfig({
      storage: globalStorage('g2l-project'),
    })
    await writeConfigFile(projectDir, globalConfig)

    const db = await openDB(globalConfig, projectDir, FAKE_HOME)
    await seedData(db)
    await db.writeStorageState(projectDir)
    await db.close()

    const globalDir = resolveGlobalStorageDir(globalConfig, FAKE_HOME)
    assert.ok(existsSync(join(globalDir, 'harness.db')))

    const localConfig = baseConfig({
      storage: localStorage('g2l-project'),
    })
    await writeConfigFile(projectDir, localConfig)

    await runMigrateStorage(projectDir, {}, FAKE_HOME)

    const localDbPath = join(projectDir, '.harness', 'harness.db')
    assert.ok(existsSync(localDbPath), 'db should now exist locally')
    assert.ok(
      !existsSync(join(globalDir, 'harness.db')),
      'global db file should have been removed after a verified copy'
    )

    const state = readStorageStateFile(projectDir, '.harness')
    assert.equal(state?.scope, 'local')

    const movedDriver = new SQLiteDriver(localDbPath)
    try {
      const counts = await getRowCounts(movedDriver)
      assert.equal(counts.tasks, 1)
    } finally {
      await movedDriver.close()
    }
  })

  test('case: destination has data, no --force → aborts cleanly, touches NOTHING', async () => {
    const projectDir = join(TMP_CMD, 'force-required')
    const localConfig = baseConfig({
      storage: localStorage('force-project'),
    })
    await writeConfigFile(projectDir, localConfig)

    const db = await openDB(localConfig, projectDir, FAKE_HOME)
    await seedData(db)
    await db.writeStorageState(projectDir)
    await db.close()

    // Pre-create a global destination that ALSO has data (diverging).
    const globalConfig = baseConfig({
      storage: globalStorage('force-project'),
    })
    const globalDb = await openDB(globalConfig, projectDir, FAKE_HOME)
    await seedData(globalDb)
    await globalDb.close()
    const globalDir = resolveGlobalStorageDir(globalConfig, FAKE_HOME)
    const globalDbPath = join(globalDir, 'harness.db')

    // Flip desired scope to global — destination (global) already has data.
    await writeConfigFile(projectDir, globalConfig)

    await assert.rejects(
      () => runMigrateStorage(projectDir, {}, FAKE_HOME),
      /already has data|--force/i
    )

    // Nothing should have moved: local db still present, global db untouched (still exactly 1 task, not 2).
    const localDbPath = join(projectDir, '.harness', 'harness.db')
    assert.ok(
      existsSync(localDbPath),
      'local source must remain untouched after an aborted migration'
    )
    const globalDriverAfter = new SQLiteDriver(globalDbPath)
    try {
      const counts = await getRowCounts(globalDriverAfter)
      assert.equal(
        counts.tasks,
        1,
        'destination must be untouched — still its own original single task, nothing imported/overwritten'
      )
    } finally {
      await globalDriverAfter.close()
    }

    // storage-state must remain whatever it was before (local), not silently flipped to global.
    const state = readStorageStateFile(projectDir, '.harness')
    assert.equal(state?.scope, 'local', 'storage-state must not change when the migration aborted')
  })

  test('case: destination has data + --force → backs up destination JSON before overwriting, then migrates', async () => {
    const projectDir = join(TMP_CMD, 'force-backup')
    const localConfig = baseConfig({
      storage: localStorage('force-backup-project'),
    })
    await writeConfigFile(projectDir, localConfig)

    const db = await openDB(localConfig, projectDir, FAKE_HOME)
    await seedData(db)
    await db.writeStorageState(projectDir)
    await db.close()

    const globalConfig = baseConfig({
      storage: globalStorage('force-backup-project'),
    })
    const globalDb = await openDB(globalConfig, projectDir, FAKE_HOME)
    await seedData(globalDb) // destination has different, pre-existing data
    await globalDb.close()

    await writeConfigFile(projectDir, globalConfig)

    await runMigrateStorage(projectDir, { force: true }, FAKE_HOME)

    const backupsDir = join(projectDir, '.harness', 'backups')
    assert.ok(existsSync(backupsDir), 'backup directory must be created before a forced overwrite')
    const backupFiles = readdirSync(backupsDir)
    assert.ok(backupFiles.length >= 1, 'a pre-migrate backup JSON must exist')
    const backupContent = JSON.parse(readFileSync(join(backupsDir, backupFiles[0]), 'utf8'))
    assert.equal(
      backupContent.tasks.length,
      1,
      'backup must contain the ORIGINAL destination data (from before overwrite)'
    )

    const state = readStorageStateFile(projectDir, '.harness')
    assert.equal(state?.scope, 'global')
  })

  test('case: storage-state.json missing, no data anywhere → records state, nothing to migrate', async () => {
    const projectDir = join(TMP_CMD, 'missing-state-empty')
    const config = baseConfig({
      storage: localStorage('missing-empty-project'),
    })
    await writeConfigFile(projectDir, config)
    mkdirSync(projectDir, { recursive: true })

    assert.equal(readStorageStateFile(projectDir, '.harness'), null)

    await runMigrateStorage(projectDir, {}, FAKE_HOME)

    const state = readStorageStateFile(projectDir, '.harness')
    assert.ok(state, 'storage-state.json should be recorded even though nothing was migrated')
    assert.equal(state?.scope, 'local')
  })

  test('case: storage-state.json missing, BOTH candidate locations have data → refuses to guess, touches nothing', async () => {
    const projectDir = join(TMP_CMD, 'missing-state-both')
    const localConfig = baseConfig({
      storage: localStorage('missing-both-project'),
    })
    await writeConfigFile(projectDir, localConfig)

    // Seed BOTH local and global sqlite files directly (bypassing writeStorageState,
    // simulating "storage-state.json got lost/never written but both DBs exist").
    const localDb = await openDB(localConfig, projectDir, FAKE_HOME)
    await seedData(localDb)
    await localDb.close()

    const globalConfig = baseConfig({
      storage: globalStorage('missing-both-project'),
    })
    const globalDb = await openDB(globalConfig, projectDir, FAKE_HOME)
    await seedData(globalDb)
    await globalDb.close()

    assert.equal(readStorageStateFile(projectDir, '.harness'), null)

    await assert.rejects(
      () => runMigrateStorage(projectDir, {}, FAKE_HOME),
      /BOTH candidate locations have data/i
    )

    // Still no state file — command must not have silently picked one.
    assert.equal(readStorageStateFile(projectDir, '.harness'), null)
  })

  test('--dry-run previews a scope migration without moving anything', async () => {
    const projectDir = join(TMP_CMD, 'dry-run')
    const localConfig = baseConfig({
      storage: localStorage('dry-run-project'),
    })
    await writeConfigFile(projectDir, localConfig)

    const db = await openDB(localConfig, projectDir, FAKE_HOME)
    await seedData(db)
    await db.writeStorageState(projectDir)
    await db.close()

    const globalConfig = baseConfig({
      storage: globalStorage('dry-run-project'),
    })
    await writeConfigFile(projectDir, globalConfig)

    await runMigrateStorage(projectDir, { dryRun: true }, FAKE_HOME)

    const localDbPath = join(projectDir, '.harness', 'harness.db')
    assert.ok(existsSync(localDbPath), 'dry-run must not move the source db')
    const globalDir = resolveGlobalStorageDir(globalConfig, FAKE_HOME)
    assert.ok(
      !existsSync(join(globalDir, 'harness.db')),
      'dry-run must not create the destination db'
    )

    const state = readStorageStateFile(projectDir, '.harness')
    assert.equal(state?.scope, 'local', 'dry-run must not write storage-state')
  })
})
