import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, test } from 'node:test'

import { type HarnessDB, openDB } from '@/core/db'
import { executeHealthCheck } from '@/core/health-check'
import { agentLead, agentReviewer } from '@/core/materializer/templates'
import { dispatch } from '@/core/mcp-server'
import { HEALTH_EVIDENCE_TTL_MS } from '@/core/task-health'

import type { HarnessConfig } from '@/types'

const TMP = join(import.meta.dirname, '../../.tmp-mcp-health-gate')
const config: HarnessConfig = {
  project: { name: 'test', description: 'test', docsPath: './docs' }, provider: 'claude-code',
  database: { type: 'sqlite' },
  storage: { dir: '.harness', sections: { toolsUsed: true, filesModified: true, result: true, blockers: true, nextSteps: false }, scope: 'local', projectId: 'mcp-health-gate', sqlitePath: join(TMP, 'harness.db') },
  health: { scriptPath: './health.sh', required: false },
  tools: { mcp: { enabled: false, port: 3456 }, scripts: { enabled: false, outputDir: '.harness/scripts' } },
}

function body(result: Awaited<ReturnType<typeof dispatch>>) {
  const item = result.content[0]
  assert.equal(item.type, 'text')
  return JSON.parse(item.text) as Record<string, unknown>
}

describe('MCP task health completion gate', () => {
  let db: HarnessDB
  let taskId: number
  beforeEach(async () => {
    mkdirSync(TMP, { recursive: true })
    writeFileSync(join(TMP, 'health.sh'), '#!/usr/bin/env bash\necho healthy\nexit 0\n')
    db = await openDB(config, TMP)
    taskId = (await db.addTask({ slug: 'health-gate', title: 'Health gate' })).id
  })
  afterEach(async () => { await db.close(); rmSync(TMP, { recursive: true, force: true }) })

  test('only a post-claim server health pass can atomically close task and orphan actions', async () => {
    await db.claimTask(taskId, 'lead')
    const orphan = await db.startAction(taskId, 'builder')
    const health = body(await dispatch('health.run', { taskId }, db, TMP, TMP, config))
    assert.equal(health.state, 'passed')
    assert.ok(typeof health.logPath === 'string')
    const done = await dispatch('tasks.update', { id: taskId, status: 'done' }, db, TMP, TMP, config)
    assert.equal(done.isError, false)
    assert.equal(body(done).status, 'done')
    assert.equal((await db.getAction(orphan.id))?.status, 'completed')
  })

  test('preclaim health and spoofed action sections cannot close a task', async () => {
    assert.equal(body(await dispatch('health.run', { taskId }, db, TMP, TMP, config)).state, 'passed')
    await db.claimTask(taskId, 'lead')
    const orphan = await db.startAction(taskId, 'builder')
    await db.writeSection(orphan.id, 'result', 'health passed')
    const denied = await dispatch('tasks.update', { id: taskId, status: 'done' }, db, TMP, TMP, config)
    assert.equal(denied.isError, true)
    assert.equal(body(denied).error, 'recent_task_health_required')
    assert.equal((await db.getAction(orphan.id))?.status, 'in_progress')
  })

  test('absent or expired evidence cannot close a task', async () => {
    await db.claimTask(taskId, 'lead')
    assert.equal((await dispatch('tasks.update', { id: taskId, status: 'done' }, db, TMP, TMP, config)).isError, true)
    await dispatch('health.run', { taskId }, db, TMP, TMP, config)
    assert.equal(
      await db.completeTaskWithHealthEvidence(taskId, HEALTH_EVIDENCE_TTL_MS, new Date(Date.now() + HEALTH_EVIDENCE_TTL_MS + 1)),
      null
    )
  })

  test('a later failed run invalidates the earlier pass', async () => {
    await db.claimTask(taskId, 'lead')
    assert.equal(body(await dispatch('health.run', { taskId }, db, TMP, TMP, config)).state, 'passed')
    writeFileSync(join(TMP, 'health.sh'), '#!/usr/bin/env bash\necho failed\nexit 1\n')
    const failed = await dispatch('health.run', { taskId }, db, TMP, TMP, config)
    assert.equal(failed.isError, true)
    assert.equal(body(failed).state, 'failed')
    assert.equal((await dispatch('tasks.update', { id: taskId, status: 'done' }, db, TMP, TMP, config)).isError, true)
  })

  test('missing and placeholder health scripts fail as bootstrap evidence', async () => {
    await db.claimTask(taskId, 'lead')
    rmSync(join(TMP, 'health.sh'))
    const missing = await dispatch('health.run', { taskId }, db, TMP, TMP, config)
    assert.equal(missing.isError, true)
    assert.equal(body(missing).state, 'missing')
    writeFileSync(join(TMP, 'health.sh'), '# AHK_HEALTH_CHECK_PLACEHOLDER\necho "health.sh not implemented yet"\nexit 1\n')
    const placeholder = await dispatch('health.run', { taskId }, db, TMP, TMP, config)
    assert.equal(placeholder.isError, true)
    assert.equal(body(placeholder).state, 'placeholder')
  })

  test('manual health execution remains stateless and cannot close a task', async () => {
    await db.claimTask(taskId, 'lead')
    const manual = executeHealthCheck(TMP, join(TMP, 'health.sh'))
    assert.equal(manual.status, 0)
    const task = await db.getTaskById(taskId)
    assert.equal(task?.health_status, null)
    assert.equal((await dispatch('tasks.update', { id: taskId, status: 'done' }, db, TMP, TMP, config)).isError, true)
  })

  test('generated lead and reviewer instructions order health.run before work and done', () => {
    const lead = agentLead({ projectName: 'test' })
    const reviewer = agentReviewer({ projectName: 'test' })
    assert.ok(lead.indexOf('health.run(taskId)') < lead.indexOf('tasks.update(taskId, \'done\')'))
    assert.ok(reviewer.indexOf('health.run(taskId)') < reviewer.indexOf('tasks.update(taskId, \'done\')'))
    assert.doesNotMatch(lead, /Use `ahk health` for the platform-native compact health check/)
    assert.doesNotMatch(reviewer, /Run ahk health before approving/)
  })

})
