import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, test } from 'node:test'

import { type HarnessDB, openDB, readStorageStateFile, resolveGlobalStorageDir } from '@/core/db'

import type { HarnessConfig, StorageState } from '@/types'

const TMP = join(import.meta.dirname, '../../.tmp-test')

const config: HarnessConfig = {
  project: { name: 'test', description: 'test project', docsPath: './docs' },
  provider: 'claude-code',
  agents: {
    lead: { instructionsPath: null },
    explorer: { instructionsPath: null, allowedPaths: [] },
    builder: { instructionsPath: null, writablePaths: [] },
    reviewer: { instructionsPath: null },
    custom: [],
  },
  database: { type: 'sqlite' },
  storage: {
    dir: '.harness',
    tasks: { adapter: 'local' },
    sections: { toolsUsed: true, filesModified: true, result: true, blockers: true, nextSteps: false },
    markdownFallback: { enabled: false, path: join(TMP, 'current.md') },
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

  test('recordFile stores a file operation', async () => {
    const task = await db.addTask({ slug: 'file-task', title: 'File Task' })
    const action = await db.startAction(task.id, 'builder')
    await db.recordFile(action.id, 'src/index.ts', 'modified', 'refactored')
    const files = await db.getFilesForTask(task.id)
    assert.equal(files.length, 1)
    assert.equal(files[0].file_path, 'src/index.ts')
    assert.equal(files[0].operation, 'modified')
    assert.equal(files[0].notes, 'refactored')
  })

  test('recordTool stores a tool call', async () => {
    const task = await db.addTask({ slug: 'tool-task', title: 'Tool Task' })
    const action = await db.startAction(task.id, 'explorer')
    await db.recordTool(action.id, 'Bash', '{"cmd":"ls"}', 'file list')
    const top = await db.getTopTools(10)
    assert.equal(top.length, 1)
    assert.equal(top[0].tool_name, 'Bash')
    assert.equal(top[0].uses, 1)
  })

  test('getTopTools returns tools sorted by usage', async () => {
    const task = await db.addTask({ slug: 'multi-tools', title: 'Multi Tools' })
    const action = await db.startAction(task.id, 'lead')
    await db.recordTool(action.id, 'Read')
    await db.recordTool(action.id, 'Read')
    await db.recordTool(action.id, 'Bash')
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

  test('syncFromFeatureList skips duplicates', async () => {
    await db.addTask({ slug: 'exists', title: 'Exists' })
    const result = await db.syncFromFeatureList([
      { slug: 'exists', title: 'Exists' },
      { slug: 'new-one', title: 'New One' },
    ])
    assert.equal(result.added, 1)
    assert.equal(result.skipped, 1)
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
    assert.equal(tasks.find((t) => t.slug === 'will-archive'), undefined)
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
    assert.equal(archived.find((t) => t.slug === 'active-e'), undefined)
  })
})

// ─── storage scope (task #45) ──────────────────────────────────────────────

describe('openDB — storage scope resolution', () => {
  const TMP_SCOPE = join(import.meta.dirname, '../../.tmp-scope-test')
  const FAKE_HOME = join(TMP_SCOPE, 'fake-home')

  afterEach(() => {
    rmSync(TMP_SCOPE, { recursive: true, force: true })
  })

  test('scope=local creates DB at ./.harness/harness.db (unchanged behavior), never touches homeDir', async () => {
    const projectDir = join(TMP_SCOPE, 'local-project')
    mkdirSync(projectDir, { recursive: true })

    const localConfig: HarnessConfig = {
      ...config,
      database: { type: 'sqlite' },
      storage: {
        dir: config.storage.dir,
        tasks: config.storage.tasks,
        sections: config.storage.sections,
        markdownFallback: { enabled: false, path: join(TMP, 'current.md') },
        scope: 'local',
        projectId: 'local-scope-project',
        sqlitePath: '.harness/harness.db',
      },
    }

    const db = await openDB(localConfig, projectDir, FAKE_HOME)
    try {
      assert.ok(existsSync(join(projectDir, '.harness', 'harness.db')))
      assert.ok(!existsSync(FAKE_HOME), 'local scope must never create anything under homeDir')
    } finally {
      await db.close()
    }
  })

  test('scope=global creates DB under <homeDir>/.harness/dbs/<projectId>/harness.db', async () => {
    const projectDir = join(TMP_SCOPE, 'global-project')
    mkdirSync(projectDir, { recursive: true })

    const projectId = 'global-scope-project-uuid'
    const globalConfig: HarnessConfig = {
      ...config,
      database: { type: 'sqlite' },
      storage: {
        dir: config.storage.dir,
        tasks: config.storage.tasks,
        sections: config.storage.sections,
        markdownFallback: { enabled: true },
        scope: 'global',
        projectId,
      },
    }

    const db = await openDB(globalConfig, projectDir, FAKE_HOME)
    try {
      const expectedDir = resolveGlobalStorageDir(globalConfig, FAKE_HOME)
      assert.equal(expectedDir, join(FAKE_HOME, '.harness', 'dbs', projectId))
      assert.ok(existsSync(join(expectedDir, 'harness.db')))
      assert.ok(!existsSync(join(projectDir, '.harness', 'harness.db')), 'global scope must not write DB into the project')
    } finally {
      await db.close()
    }
  })

  test('regenerateCurrentMd respects scope=global, writing current.md under homeDir', async () => {
    const projectDir = join(TMP_SCOPE, 'global-md-project')
    mkdirSync(projectDir, { recursive: true })

    const projectId = 'global-md-project-uuid'
    const globalConfig: HarnessConfig = {
      ...config,
      database: { type: 'sqlite' },
      storage: {
        dir: config.storage.dir,
        tasks: config.storage.tasks,
        sections: config.storage.sections,
        scope: 'global',
        projectId,
        markdownFallback: { enabled: true },
      },
    }

    const db = await openDB(globalConfig, projectDir, FAKE_HOME)
    try {
      await db.addTask({ slug: 'md-scope-task', title: 'MD Scope Task' })
      const expectedDir = resolveGlobalStorageDir(globalConfig, FAKE_HOME)
      assert.ok(existsSync(join(expectedDir, 'current.md')))
      assert.ok(
        !existsSync(join(projectDir, '.harness', 'current.md')),
        'global scope must not write current.md into the project',
      )
    } finally {
      await db.close()
    }
  })
})

describe('storage-state.json', () => {
  const TMP_STATE = join(import.meta.dirname, '../../.tmp-storage-state-test')

  afterEach(() => {
    rmSync(TMP_STATE, { recursive: true, force: true })
  })

  test('writeStorageState writes .harness/storage-state.json with the fixed shape, project-local regardless of scope', async () => {
    const projectDir = join(TMP_STATE, 'write-project')
    mkdirSync(projectDir, { recursive: true })
    const homeDir = join(TMP_STATE, 'fake-home')

    const projectId = 'storage-state-project-uuid'
    const globalConfig: HarnessConfig = {
      ...config,
      database: { type: 'sqlite' },
      storage: {
        dir: config.storage.dir,
        tasks: config.storage.tasks,
        sections: config.storage.sections,
        markdownFallback: { enabled: true },
        scope: 'global',
        projectId,
      },
    }

    const db = await openDB(globalConfig, projectDir, homeDir)
    try {
      await db.writeStorageState(projectDir)

      const statePath = join(projectDir, '.harness', 'storage-state.json')
      assert.ok(existsSync(statePath), 'storage-state.json must always be written project-local')

      const state = JSON.parse(readFileSync(statePath, 'utf8')) as StorageState
      assert.equal(state.scope, 'global')
      assert.equal(state.projectId, projectId)
      assert.equal(state.dbType, 'sqlite')
      assert.ok(state.migratedAt)
      assert.ok(!Number.isNaN(Date.parse(state.migratedAt)))
    } finally {
      await db.close()
    }
  })

  test('readStorageStateFile reads back what writeStorageState wrote', async () => {
    const projectDir = join(TMP_STATE, 'read-project')
    mkdirSync(projectDir, { recursive: true })
    const homeDir = join(TMP_STATE, 'fake-home-2')

    const localConfig: HarnessConfig = {
      ...config,
      database: { type: 'sqlite' },
      storage: {
        dir: config.storage.dir,
        tasks: config.storage.tasks,
        sections: config.storage.sections,
        markdownFallback: { enabled: false, path: join(TMP, 'current.md') },
        scope: 'local',
        projectId: 'read-back-project',
        sqlitePath: '.harness/harness.db',
      },
    }

    const db = await openDB(localConfig, projectDir, homeDir)
    try {
      await db.writeStorageState(projectDir)
      const state = readStorageStateFile(projectDir, localConfig.storage.dir)
      assert.ok(state)
      assert.equal(state?.scope, 'local')
      assert.equal(state?.projectId, 'read-back-project')
      assert.equal(state?.dbType, 'sqlite')
    } finally {
      await db.close()
    }
  })

  test('readStorageStateFile returns null when the file does not exist', () => {
    const projectDir = join(TMP_STATE, 'missing-project')
    mkdirSync(projectDir, { recursive: true })
    const state = readStorageStateFile(projectDir, '.harness')
    assert.equal(state, null)
  })
})
