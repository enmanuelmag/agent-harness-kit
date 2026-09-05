/* eslint-disable @typescript-eslint/no-unused-vars */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, test } from 'node:test'

import { type HarnessDB, openDB, readStorageStateFile, resolveGlobalStorageDir } from '@/core/db'
import { SQLiteDriver } from '@/core/drivers/sqlite'
import { ActionRepository } from '@/core/repositories/ActionRepository'

import type { ActionFileRow, HarnessConfig, StorageState } from '@/types'

const TMP = join(import.meta.dirname, '../../.tmp-test')

const config: HarnessConfig = {
  project: { name: 'test', description: 'test project', docsPath: './docs' },
  provider: 'claude-code',
  database: { type: 'sqlite' },
  storage: {
    dir: '.harness',
    sections: {
      toolsUsed: true,
      filesModified: true,
      result: true,
      blockers: true,
      nextSteps: false,
    },
    scope: 'local',
    projectId: 'test-project-id-local',
    sqlitePath: join(TMP, 'test.db'),
  },
  health: { scriptPath: './health.sh', required: false },
  tools: {
    mcp: { enabled: false, port: 3456 },
    scripts: { enabled: false, outputDir: '.harness/scripts' },
  },
}

describe('HarnessDB', () => {
  let db: HarnessDB

  beforeEach(async () => {
    mkdirSync(TMP, { recursive: true })
    db = await openDB(config, TMP)
  })

  afterEach(async () => {
    await db.close()
    rmSync(TMP, { recursive: true, force: true })
  })

  test('addTask creates a task with pending status', async () => {
    const task = await db.addTask({ slug: 'my-feature', title: 'My Feature' })
    assert.equal(task.slug, 'my-feature')
    assert.equal(task.title, 'My Feature')
    assert.equal(task.status, 'pending')
    assert.ok(task.id > 0)
    assert.ok(task.updated_at)
  })

  test('getTasks returns all tasks', async () => {
    await db.addTask({ slug: 'a', title: 'Task A' })
    await db.addTask({ slug: 'b', title: 'Task B' })
    const tasks = await db.getTasks()
    assert.equal(tasks.length, 2)
  })

  test('getTasks filters by status', async () => {
    await db.addTask({ slug: 'a', title: 'Task A' })
    await db.addTask({ slug: 'b', title: 'Task B' })
    await db.updateTaskStatus('a', 'in_progress')
    const pending = await db.getTasks('pending')
    assert.equal(pending.length, 1)
    assert.equal(pending[0].slug, 'b')
  })

  test('claimTask atomically claims a pending task', async () => {
    const task = await db.addTask({ slug: 'work', title: 'Work' })
    const claimed = await db.claimTask(task.id, 'lead')
    assert.ok(claimed)
    assert.equal(claimed.status, 'in_progress')
    assert.equal(claimed.assigned_to, 'lead')
    assert.ok(claimed.updated_at)
  })

  test('claimTask returns null for already claimed task', async () => {
    const task = await db.addTask({ slug: 'work2', title: 'Work2' })
    await db.claimTask(task.id, 'lead')
    const second = await db.claimTask(task.id, 'builder')
    assert.equal(second, null)
  })

  test('startAction / writeSection / completeAction full lifecycle', async () => {
    const task = await db.addTask({ slug: 'feat', title: 'Feature' })
    const action = await db.startAction(task.id, 'lead')
    assert.equal(action.status, 'in_progress')
    assert.ok(
      typeof action.id === 'number',
      'action.id must be an autoincrement integer, not a UUID string (task #73)'
    )

    await db.writeSection(action.id, 'result', 'Plan is done')
    const sections = await db.getActionSections(action.id)
    assert.equal(sections.length, 1)
    assert.equal(sections[0].content, 'Plan is done')

    const completed = await db.completeAction(action.id, 'Plan defined')
    assert.equal(completed.status, 'completed')
    assert.equal(completed.summary, 'Plan defined')
  })

  test('addTask with acceptance criteria', async () => {
    const task = await db.addTask({
      slug: 'with-ac',
      title: 'With AC',
      acceptance: ['Must pass tests', 'Must be reviewed'],
    })
    const ac = await db.getTaskAcceptance(task.id)
    assert.equal(ac.length, 2)
    assert.equal(ac[0].criterion, 'Must pass tests')
  })

  test('getTaskAcceptance returns empty array for unknown taskId', async () => {
    const criteria = await db.getTaskAcceptance(99999)
    assert.equal(criteria.length, 0)
  })

  test('getTaskAcceptance returns criteria with correct shape', async () => {
    const task = await db.addTask({
      slug: 'ac-shape',
      title: 'AC Shape',
      acceptance: ['Criterion A', 'Criterion B'],
    })
    const criteria = await db.getTaskAcceptance(task.id)
    assert.equal(criteria.length, 2)
    assert.ok(typeof criteria[0].id === 'number')
    assert.equal(criteria[0].task_id, task.id)
    assert.equal(criteria[0].criterion, 'Criterion A')
    assert.equal(criteria[0].met, 0)
  })

  test('getTaskById returns task by id', async () => {
    const task = await db.addTask({ slug: 'find-me', title: 'Find Me' })
    const found = await db.getTaskById(task.id)
    assert.ok(found)
    assert.equal(found.slug, 'find-me')
  })

  test('getTaskById returns null for unknown id', async () => {
    const found = await db.getTaskById(99999)
    assert.equal(found, null)
  })

  test('updateTaskStatus changes task status', async () => {
    await db.addTask({ slug: 'status-test', title: 'Status Test' })
    const updated = await db.updateTaskStatus('status-test', 'done')
    assert.equal(updated.status, 'done')
    assert.ok(updated.updated_at)
  })

  test('getActionsForTask returns actions for a task', async () => {
    const task = await db.addTask({ slug: 'with-actions', title: 'With Actions' })
    await db.startAction(task.id, 'lead')
    await db.startAction(task.id, 'builder')
    const actions = await db.getActionsForTask(task.id)
    assert.equal(actions.length, 2)
  })

  test('recordFiles stores a file operation from a single-element array', async () => {
    const task = await db.addTask({ slug: 'file-task', title: 'File Task' })
    const action = await db.startAction(task.id, 'builder')
    const recorded = await db.recordFiles(action.id, [
      { filePath: 'src/index.ts', operation: 'modified', notes: 'refactored' },
    ])
    assert.equal(recorded, 1)
    const files = await db.getFilesForTask(task.id)
    assert.equal(files.length, 1)
    assert.equal(files[0].file_path, 'src/index.ts')
    assert.equal(files[0].operation, 'modified')
    assert.equal(files[0].notes, 'refactored')
  })

  test('recordFiles stores every entry in a multi-element batch atomically', async () => {
    const task = await db.addTask({ slug: 'file-batch-task', title: 'File Batch Task' })
    const action = await db.startAction(task.id, 'builder')
    const recorded = await db.recordFiles(action.id, [
      { filePath: 'src/a.ts', operation: 'created' },
      { filePath: 'src/b.ts', operation: 'modified' },
      { filePath: 'src/c.ts', operation: 'deleted' },
    ])
    assert.equal(recorded, 3)
    const files = await db.getFilesForTask(task.id)
    assert.equal(files.length, 3)
    assert.deepEqual(files.map((f) => f.file_path).sort(), ['src/a.ts', 'src/b.ts', 'src/c.ts'])
  })

  test('recordFiles rolls back the whole batch when one entry is invalid', async () => {
    const task = await db.addTask({ slug: 'file-rollback-task', title: 'File Rollback Task' })
    const action = await db.startAction(task.id, 'builder')
    await assert.rejects(
      db.recordFiles(action.id, [
        { filePath: 'src/good.ts', operation: 'modified' },
        { filePath: 'src/bad.ts', operation: 'not-a-real-operation' as ActionFileRow['operation'] },
      ])
    )
    const files = await db.getFilesForTask(task.id)
    assert.equal(files.length, 0)
  })

  test('recordTools stores a tool call from a single-element array', async () => {
    const task = await db.addTask({ slug: 'tool-task', title: 'Tool Task' })
    const action = await db.startAction(task.id, 'explorer')
    const recorded = await db.recordTools(action.id, [
      { toolName: 'Bash', argsJson: '{"cmd":"ls"}', resultSummary: 'file list' },
    ])
    assert.equal(recorded, 1)
    const top = await db.getTopTools(10)
    assert.equal(top.length, 1)
    assert.equal(top[0].tool_name, 'Bash')
    assert.equal(top[0].uses, 1)
  })

  test('recordTools rolls back the whole batch when one entry is invalid', async () => {
    const task = await db.addTask({ slug: 'tool-rollback-task', title: 'Tool Rollback Task' })
    const action = await db.startAction(task.id, 'explorer')
    await assert.rejects(
      db.recordTools(action.id, [{ toolName: 'Read' }, { toolName: null as unknown as string }])
    )
    const top = await db.getTopTools(10)
    assert.equal(
      top.find((t) => t.tool_name === 'Read'),
      undefined
    )
  })

  test('getTopTools returns tools sorted by usage', async () => {
    const task = await db.addTask({ slug: 'multi-tools', title: 'Multi Tools' })
    const action = await db.startAction(task.id, 'lead')
    const recorded = await db.recordTools(action.id, [
      { toolName: 'Read' },
      { toolName: 'Read' },
      { toolName: 'Bash' },
    ])
    assert.equal(recorded, 3)
    const top = await db.getTopTools(10)
    assert.equal(top[0].tool_name, 'Read')
    assert.equal(top[0].uses, 2)
    assert.equal(top[1].tool_name, 'Bash')
    assert.equal(top[1].uses, 1)
  })

  test('getStatusSummary counts tasks by status', async () => {
    await db.addTask({ slug: 'p1', title: 'P1' })
    await db.addTask({ slug: 'p2', title: 'P2' })
    const t3 = await db.addTask({ slug: 'p3', title: 'P3' })
    await db.claimTask(t3.id, 'lead')
    const summary = await db.getStatusSummary()
    const pending = summary.find((s) => s.status === 'pending')
    const inProgress = summary.find((s) => s.status === 'in_progress')
    assert.ok(pending)
    assert.equal(pending.total, 2)
    assert.ok(inProgress)
    assert.equal(inProgress.total, 1)
  })

  test('archiveTask sets archived_at', async () => {
    const task = await db.addTask({ slug: 'to-archive', title: 'To Archive' })
    assert.equal(task.archived_at, null)

    const archived = await db.archiveTask(task.id)
    assert.notEqual(archived.archived_at, null)
    assert.ok(archived.archived_at!)
    assert.ok(archived.updated_at)
  })

  test('unarchiveTask clears archived_at', async () => {
    const task = await db.addTask({ slug: 'to-unarchive', title: 'To Unarchive' })
    await db.archiveTask(task.id)

    const unarchived = await db.unarchiveTask(task.id)
    assert.equal(unarchived.archived_at, null)
    assert.ok(unarchived.updated_at)
  })

  test('getTasks excludes archived by default', async () => {
    await db.addTask({ slug: 'active-a', title: 'Active A' })
    await db.addTask({ slug: 'active-b', title: 'Active B' })
    const task = await db.addTask({ slug: 'will-archive', title: 'Will Archive' })
    await db.archiveTask(task.id)

    const tasks = await db.getTasks()
    assert.equal(tasks.length, 2)
    assert.equal(
      tasks.find((t) => t.slug === 'will-archive'),
      undefined
    )
  })

  test('getTasks includes archived when includeArchived=true', async () => {
    await db.addTask({ slug: 'active-c', title: 'Active C' })
    const task = await db.addTask({ slug: 'archived-d', title: 'Archived D' })
    await db.archiveTask(task.id)

    const tasks = await db.getTasks(undefined, true)
    assert.equal(tasks.length, 2)
    assert.ok(tasks.find((t) => t.slug === 'archived-d'))
    assert.ok(tasks.find((t) => t.slug === 'active-c'))
  })

  test('getStatusSummary excludes archived from counts', async () => {
    await db.addTask({ slug: 'summary-a', title: 'Summary A' })
    await db.addTask({ slug: 'summary-b', title: 'Summary B' })
    const task = await db.addTask({ slug: 'summary-archived', title: 'Summary Archived' })
    await db.archiveTask(task.id)

    const summary = await db.getStatusSummary()
    const total = summary.reduce((acc, s) => acc + s.total, 0)
    assert.equal(total, 2) // archived should not be counted
  })

  test('getArchivedTasks returns only archived tasks', async () => {
    await db.addTask({ slug: 'active-e', title: 'Active E' })
    const t1 = await db.addTask({ slug: 'archived-f', title: 'Archived F' })
    const t2 = await db.addTask({ slug: 'archived-g', title: 'Archived G' })
    await db.archiveTask(t1.id)
    await db.archiveTask(t2.id)

    const archived = await db.getArchivedTasks()
    assert.equal(archived.length, 2)
    assert.equal(
      archived.find((t) => t.slug === 'active-e'),
      undefined
    )
  })
})

// ─── storage scope (task #45) ──────────────────────────────────────────────

describe('openDB — storage scope resolution', () => {
  const TMP_SCOPE = join(import.meta.dirname, '../../.tmp-scope-test')
  const FAKE_HOME = join(TMP_SCOPE, 'fake-home')

  afterEach(() => {
    rmSync(TMP_SCOPE, { recursive: true, force: true })
  })
})

describe('storage-state.json', () => {
  const TMP_STATE = join(import.meta.dirname, '../../.tmp-storage-state-test')

  afterEach(() => {
    rmSync(TMP_STATE, { recursive: true, force: true })
  })

  test('readStorageStateFile returns null when the file does not exist', () => {
    const projectDir = join(TMP_STATE, 'missing-project')
    mkdirSync(projectDir, { recursive: true })
    const state = readStorageStateFile(projectDir, '.harness')
    assert.equal(state, null)
  })
})

// ─── actions.id UUID -> INTEGER migration (task #73) ───────────────────────

describe('actions.id UUID -> INTEGER migration (task #73)', () => {
  const TMP_MIGRATE = join(import.meta.dirname, '../../.tmp-actions-migration-test')

  afterEach(() => {
    rmSync(TMP_MIGRATE, { recursive: true, force: true })
  })

  /** Old (pre-#73) sqlite schema: actions.id / *.action_id are TEXT/UUID.
   *  tasks/task_acceptance are unchanged from the current schema — only the
   *  actions family needs to be seeded in the legacy shape. */
  const OLD_SQLITE_SCHEMA = `
    CREATE TABLE tasks (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      slug         TEXT    NOT NULL UNIQUE,
      title        TEXT    NOT NULL,
      description  TEXT,
      status       TEXT    NOT NULL DEFAULT 'pending',
      assigned_to  TEXT,
      created_at   TEXT    NOT NULL,
      started_at   TEXT,
      completed_at TEXT,
      archived_at  TEXT,
      updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE actions (
      id           TEXT    PRIMARY KEY,
      task_id      INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      agent        TEXT    NOT NULL,
      status       TEXT    NOT NULL DEFAULT 'in_progress',
      created_at   TEXT    NOT NULL,
      completed_at TEXT,
      summary      TEXT
    );
    CREATE TABLE action_sections (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      action_id    TEXT    NOT NULL REFERENCES actions(id) ON DELETE CASCADE,
      section_type TEXT    NOT NULL,
      content      TEXT    NOT NULL,
      created_at   TEXT    NOT NULL
    );
    CREATE TABLE action_files (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      action_id   TEXT    NOT NULL REFERENCES actions(id) ON DELETE CASCADE,
      file_path   TEXT    NOT NULL,
      operation   TEXT    NOT NULL,
      notes       TEXT
    );
    CREATE TABLE action_tools (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      action_id      TEXT    NOT NULL REFERENCES actions(id) ON DELETE CASCADE,
      tool_name      TEXT    NOT NULL,
      args_json      TEXT,
      result_summary TEXT,
      called_at      TEXT    NOT NULL
    );
  `

  test('migrates an existing UUID-id DB to sequential integers, preserving every row and FK relationship, and continuing the sqlite sequence correctly', async () => {
    mkdirSync(TMP_MIGRATE, { recursive: true })
    const dbPath = join(TMP_MIGRATE, 'legacy.db')
    const driver = new SQLiteDriver(dbPath)

    await driver.execRaw(OLD_SQLITE_SCHEMA)

    const now = new Date().toISOString()
    const later = new Date(Date.now() + 1000).toISOString()
    await driver.exec(
      `INSERT INTO tasks (slug, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      ['legacy-task', 'Legacy Task', 'pending', now, now]
    )

    const uuidA = 'aaaaaaaa-0000-0000-0000-000000000001'
    const uuidB = 'bbbbbbbb-0000-0000-0000-000000000002'
    await driver.exec(
      `INSERT INTO actions (id, task_id, agent, status, created_at) VALUES (?, 1, 'lead', 'completed', ?)`,
      [uuidA, now]
    )
    await driver.exec(
      `INSERT INTO actions (id, task_id, agent, status, created_at) VALUES (?, 1, 'builder', 'in_progress', ?)`,
      [uuidB, later]
    )
    await driver.exec(
      `INSERT INTO action_sections (action_id, section_type, content, created_at) VALUES (?, 'result', 'plan A', ?)`,
      [uuidA, now]
    )
    await driver.exec(
      `INSERT INTO action_sections (action_id, section_type, content, created_at) VALUES (?, 'result', 'plan B', ?)`,
      [uuidB, later]
    )
    await driver.exec(
      `INSERT INTO action_files (action_id, file_path, operation) VALUES (?, 'src/a.ts', 'modified')`,
      [uuidA]
    )
    await driver.exec(
      `INSERT INTO action_tools (action_id, tool_name, called_at) VALUES (?, 'Read', ?)`,
      [uuidB, now]
    )

    // Triggers the migration.
    await driver.ensureSchema()
    // Idempotency: a second call must be a no-op, not an error or a re-migration.
    await driver.ensureSchema()

    const idCol = (
      await driver.query<{ name: string; type: string }>(`PRAGMA table_info(actions)`)
    ).find((c) => c.name === 'id')
    assert.equal(idCol?.type?.toUpperCase(), 'INTEGER')

    const actionsRows = await driver.query<{ id: number; agent: string }>(
      `SELECT id, agent FROM actions ORDER BY id`
    )
    assert.equal(actionsRows.length, 2)
    assert.ok(actionsRows.every((r) => typeof r.id === 'number'))
    const idA = actionsRows.find((r) => r.agent === 'lead')!.id
    const idB = actionsRows.find((r) => r.agent === 'builder')!.id
    assert.notEqual(idA, idB)

    // FK integrity — not just row counts. Every child row must resolve to
    // the CORRECT remapped parent, not just any valid integer.
    const sections = await driver.query<{ action_id: number; content: string }>(
      `SELECT action_id, content FROM action_sections ORDER BY id`
    )
    assert.equal(sections.find((s) => s.content === 'plan A')?.action_id, idA)
    assert.equal(sections.find((s) => s.content === 'plan B')?.action_id, idB)

    const files = await driver.query<{ action_id: number; file_path: string }>(
      `SELECT action_id, file_path FROM action_files`
    )
    assert.equal(files.length, 1)
    assert.equal(files[0].action_id, idA)

    const tools = await driver.query<{ action_id: number; tool_name: string }>(
      `SELECT action_id, tool_name FROM action_tools`
    )
    assert.equal(tools.length, 1)
    assert.equal(tools[0].action_id, idB)

    // Old renamed tables must be gone.
    const leftover = await driver.query<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '%_old_v2migration'`
    )
    assert.equal(leftover.length, 0)

    // Sequence continues correctly: a subsequent insert with no explicit id
    // must not collide with a migrated id.
    const repo = new ActionRepository(driver)
    const newId = await repo.create(1, 'reviewer', new Date().toISOString())
    assert.ok(
      newId > Math.max(idA, idB),
      `new id ${newId} must be greater than max migrated id ${Math.max(idA, idB)}`
    )

    await driver.close()
  })

  test('a fresh DB (never had the old TEXT-id shape) is created directly in the new shape — migration is a no-op', async () => {
    mkdirSync(TMP_MIGRATE, { recursive: true })
    const dbPath = join(TMP_MIGRATE, 'fresh.db')
    const driver = new SQLiteDriver(dbPath)

    await driver.ensureSchema()

    const idCol = (
      await driver.query<{ name: string; type: string }>(`PRAGMA table_info(actions)`)
    ).find((c) => c.name === 'id')
    assert.equal(idCol?.type?.toUpperCase(), 'INTEGER')

    const leftover = await driver.query<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '%_old_v2migration'`
    )
    assert.equal(leftover.length, 0)

    await driver.close()
  })

  // ─── resumeIfInterrupted() — task #73 review fix ─────────────────────────
  // The original resumeIfInterrupted() assumed "if actions_old_v2migration
  // exists, all 4 old-suffixed tables exist" and unconditionally dropped
  // whatever currently sat under the live table names before restoring from
  // `_old`. That's wrong whenever the rename (step 2) or the old-table drop
  // (step 6) loop — each 4 separate non-atomic DDL statements — is caught
  // mid-way. These 3 tests simulate exactly the interruption points a crash
  // (a real risk on MySQL, whose DDL isn't transactional) could leave
  // behind and assert no data loss + a consistent end state after
  // `ensureSchema()` runs.

  /** Seeds a single action (with one section/file/tool row) in the legacy
   *  TEXT-id shape, matching the fixture the happy-path test above uses. */
  async function seedSingleLegacyAction(driver: SQLiteDriver, now: string): Promise<string> {
    await driver.execRaw(OLD_SQLITE_SCHEMA)
    await driver.exec(
      `INSERT INTO tasks (slug, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      ['legacy-task', 'Legacy Task', 'pending', now, now]
    )
    const uuid = 'aaaaaaaa-0000-0000-0000-000000000001'
    await driver.exec(
      `INSERT INTO actions (id, task_id, agent, status, created_at) VALUES (?, 1, 'lead', 'completed', ?)`,
      [uuid, now]
    )
    await driver.exec(
      `INSERT INTO action_sections (action_id, section_type, content, created_at) VALUES (?, 'result', 'plan A', ?)`,
      [uuid, now]
    )
    await driver.exec(
      `INSERT INTO action_files (action_id, file_path, operation) VALUES (?, 'src/a.ts', 'modified')`,
      [uuid]
    )
    await driver.exec(
      `INSERT INTO action_tools (action_id, tool_name, called_at) VALUES (?, 'Read', ?)`,
      [uuid, now]
    )
    return uuid
  }

  /** Asserts the DB is in a single fully-migrated, consistent state: one
   *  action (integer id), its section/file/tool rows correctly pointing at
   *  it, and no leftover `_old_v2migration` tables. */
  async function assertFullyMigratedSingleAction(driver: SQLiteDriver): Promise<void> {
    const idCol = (
      await driver.query<{ name: string; type: string }>(`PRAGMA table_info(actions)`)
    ).find((c) => c.name === 'id')
    assert.equal(idCol?.type?.toUpperCase(), 'INTEGER')

    const actionsRows = await driver.query<{ id: number }>(`SELECT id FROM actions`)
    assert.equal(actionsRows.length, 1, 'no data loss: exactly the one action must survive')
    const newId = actionsRows[0].id
    assert.equal(typeof newId, 'number')

    const sections = await driver.query<{ action_id: number; content: string }>(
      `SELECT action_id, content FROM action_sections`
    )
    assert.equal(sections.length, 1)
    assert.equal(sections[0].content, 'plan A')
    assert.equal(sections[0].action_id, newId)

    const files = await driver.query<{ action_id: number }>(`SELECT action_id FROM action_files`)
    assert.equal(files.length, 1)
    assert.equal(files[0].action_id, newId)

    const tools = await driver.query<{ action_id: number }>(`SELECT action_id FROM action_tools`)
    assert.equal(tools.length, 1)
    assert.equal(tools[0].action_id, newId)

    const leftover = await driver.query<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '%_old_v2migration'`
    )
    assert.equal(leftover.length, 0)
  }

  test('resumeIfInterrupted: crash mid-rename (only actions_old_v2migration present, the other 3 tables still live under original names with data) — no data loss', async () => {
    mkdirSync(TMP_MIGRATE, { recursive: true })
    const driver = new SQLiteDriver(join(TMP_MIGRATE, 'mid-rename.db'))
    const now = new Date().toISOString()
    await seedSingleLegacyAction(driver, now)

    // Simulate a crash right after step 2's loop renamed ONLY the first
    // table (`actions`) — action_sections/action_files/action_tools are
    // still live, original, TEXT-id tables holding their real data, exactly
    // as a kill -9 mid-loop would leave them.
    await driver.execRaw(`ALTER TABLE actions RENAME TO actions_old_v2migration`)

    await driver.ensureSchema() // resumeIfInterrupted() + full migration retry

    await assertFullyMigratedSingleAction(driver)
    await driver.close()
  })

  test('resumeIfInterrupted: crash right after all 4 tables were renamed away, before the new tables were recreated — no data loss', async () => {
    mkdirSync(TMP_MIGRATE, { recursive: true })
    const driver = new SQLiteDriver(join(TMP_MIGRATE, 'fully-renamed.db'))
    const now = new Date().toISOString()
    await seedSingleLegacyAction(driver, now)

    // Simulate step 2 fully completing (all 4 renamed) but the crash landing
    // before step 3 (recreate) ever runs — no live tables exist at all.
    await driver.execRaw(`ALTER TABLE actions RENAME TO actions_old_v2migration`)
    await driver.execRaw(`ALTER TABLE action_sections RENAME TO action_sections_old_v2migration`)
    await driver.execRaw(`ALTER TABLE action_files RENAME TO action_files_old_v2migration`)
    await driver.execRaw(`ALTER TABLE action_tools RENAME TO action_tools_old_v2migration`)

    await driver.ensureSchema()

    await assertFullyMigratedSingleAction(driver)
    await driver.close()
  })

  test('resumeIfInterrupted: new tables fully populated and correct, old tables only partially dropped — cleanup-only, live data never touched', async () => {
    mkdirSync(TMP_MIGRATE, { recursive: true })
    const driver = new SQLiteDriver(join(TMP_MIGRATE, 'mid-cleanup.db'))
    const now = new Date().toISOString()
    await seedSingleLegacyAction(driver, now)

    // Run the real migration to completion first, so the live tables are
    // genuinely in the fully-migrated, correct state.
    await driver.ensureSchema()
    const migratedId = (await driver.query<{ id: number }>(`SELECT id FROM actions`))[0].id

    // Now simulate step 6 (drop old tables) being interrupted after it
    // dropped action_sections_old_v2migration/action_files_old_v2migration
    // but before it got to action_tools_old_v2migration/actions_old_v2migration
    // — recreate just those 2 leftover backups, with the SAME row counts the
    // (already fully migrated) live tables hold, mirroring what a
    // partially-completed drop loop leaves behind.
    await driver.execRaw(
      `CREATE TABLE actions_old_v2migration (id TEXT PRIMARY KEY, task_id INTEGER, agent TEXT, status TEXT, created_at TEXT, completed_at TEXT, summary TEXT)`
    )
    await driver.exec(
      `INSERT INTO actions_old_v2migration (id, task_id, agent, status, created_at) VALUES ('stale-uuid', 1, 'lead', 'completed', ?)`,
      [now]
    )
    await driver.execRaw(
      `CREATE TABLE action_tools_old_v2migration (id INTEGER PRIMARY KEY, action_id TEXT, tool_name TEXT, args_json TEXT, result_summary TEXT, called_at TEXT)`
    )
    await driver.exec(
      `INSERT INTO action_tools_old_v2migration (action_id, tool_name, called_at) VALUES ('stale-uuid', 'Read', ?)`,
      [now]
    )
    // action_sections_old_v2migration / action_files_old_v2migration were
    // already dropped by the time the simulated crash happened — deliberately
    // not recreated here.

    await driver.ensureSchema() // must be cleanup-only: touch nothing live

    // Live data completely untouched — same id, same rows, nothing re-migrated.
    const actionsAfter = await driver.query<{ id: number }>(`SELECT id FROM actions`)
    assert.equal(actionsAfter.length, 1)
    assert.equal(
      actionsAfter[0].id,
      migratedId,
      'the live action must keep its already-migrated id, not be re-created'
    )

    await assertFullyMigratedSingleAction(driver)
    await driver.close()
  })
})
