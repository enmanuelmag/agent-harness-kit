import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { HarnessDB } from '../core/db.js'
import type { HarnessConfig } from '../types.js'

const TMP = join(import.meta.dirname, '../../.tmp-test')

const config: HarnessConfig = {
  project: { name: 'test', description: 'test project', docsPath: './docs' },
  provider: 'claude-code',
  agents: {
    lead:     { instructionsPath: null },
    explorer: { instructionsPath: null, allowedPaths: [] },
    builder:  { instructionsPath: null, writablePaths: [] },
    reviewer: { instructionsPath: null },
    custom:   [],
  },
  storage: {
    dir: '.harness',
    dbPath: join(TMP, 'test.db'),
    tasks: { adapter: 'local' },
    sections: { toolsUsed: true, filesModified: true, result: true, blockers: true, nextSteps: false },
    markdownFallback: { enabled: false, path: join(TMP, 'current.md') },
  },
  health: { scriptPath: './health.sh', required: false },
  tools: {
    mcp:     { enabled: false, port: 3456 },
    scripts: { enabled: false, outputDir: '.harness/scripts' },
  },
}

describe('HarnessDB', () => {
  let db: HarnessDB

  beforeEach(() => {
    mkdirSync(TMP, { recursive: true })
    db = new HarnessDB(config.storage.dbPath, config)
  })

  afterEach(() => {
    db.close()
    rmSync(TMP, { recursive: true, force: true })
  })

  test('addTask creates a task with pending status', () => {
    const task = db.addTask({ slug: 'my-feature', title: 'My Feature' })
    assert.equal(task.slug, 'my-feature')
    assert.equal(task.title, 'My Feature')
    assert.equal(task.status, 'pending')
    assert.ok(task.id > 0)
  })

  test('getTasks returns all tasks', () => {
    db.addTask({ slug: 'a', title: 'Task A' })
    db.addTask({ slug: 'b', title: 'Task B' })
    const tasks = db.getTasks()
    assert.equal(tasks.length, 2)
  })

  test('getTasks filters by status', () => {
    db.addTask({ slug: 'a', title: 'Task A' })
    db.addTask({ slug: 'b', title: 'Task B' })
    db.updateTaskStatus('a', 'in_progress')
    const pending = db.getTasks('pending')
    assert.equal(pending.length, 1)
    assert.equal(pending[0].slug, 'b')
  })

  test('claimTask atomically claims a pending task', () => {
    const task = db.addTask({ slug: 'work', title: 'Work' })
    const claimed = db.claimTask(task.id, 'lead')
    assert.ok(claimed)
    assert.equal(claimed.status, 'in_progress')
    assert.equal(claimed.assigned_to, 'lead')
  })

  test('claimTask returns null for already claimed task', () => {
    const task = db.addTask({ slug: 'work2', title: 'Work2' })
    db.claimTask(task.id, 'lead')
    const second = db.claimTask(task.id, 'builder')
    assert.equal(second, null)
  })

  test('startAction / writeSection / completeAction full lifecycle', () => {
    const task = db.addTask({ slug: 'feat', title: 'Feature' })
    const action = db.startAction(task.id, 'lead')
    assert.equal(action.status, 'in_progress')

    db.writeSection(action.id, 'result', 'Plan is done')
    const sections = db.getActionSections(action.id)
    assert.equal(sections.length, 1)
    assert.equal(sections[0].content, 'Plan is done')

    const completed = db.completeAction(action.id, 'Plan defined')
    assert.equal(completed.status, 'completed')
    assert.equal(completed.summary, 'Plan defined')
  })

  test('addTask with acceptance criteria', () => {
    const task = db.addTask({
      slug: 'with-ac',
      title: 'With AC',
      acceptance: ['Must pass tests', 'Must be reviewed'],
    })
    const ac = db.getTaskAcceptance(task.id)
    assert.equal(ac.length, 2)
    assert.equal(ac[0].criterion, 'Must pass tests')
  })

  test('syncFromFeatureList skips duplicates', () => {
    db.addTask({ slug: 'exists', title: 'Exists' })
    const result = db.syncFromFeatureList([
      { slug: 'exists', title: 'Exists' },
      { slug: 'new-one', title: 'New One' },
    ])
    assert.equal(result.added, 1)
    assert.equal(result.skipped, 1)
  })
})
