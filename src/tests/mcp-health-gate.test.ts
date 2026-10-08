import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, test } from 'node:test'

import { type HarnessDB, openDB } from '@/core/db'
import { dispatch } from '@/core/mcp-server'
import { runTaskHealthCheck } from '@/core/task-health'

import type { HarnessConfig } from '@/types'

const TMP = join(import.meta.dirname, '../../.tmp-mcp-health-gate')
const config: HarnessConfig = {
  project: { name: 'test', description: 'test', docsPath: './docs' }, provider: 'claude-code',
  database: { type: 'sqlite' },
  storage: { dir: '.harness', sections: { toolsUsed: true, filesModified: true, result: true, blockers: true, nextSteps: false }, scope: 'local', projectId: 'mcp-health-gate', sqlitePath: join(TMP, 'harness.db') },
  health: { scriptPath: './health.sh', required: false },
  tools: { mcp: { enabled: false, port: 3456 }, scripts: { enabled: false, outputDir: '.harness/scripts' } },
}

interface ResultBody {
  health?: { state?: string }
  executionMode?: string
  task?: { execution_mode?: string; status?: string }
  error?: string
  actionId?: number
}

function body(result: Awaited<ReturnType<typeof dispatch>>): ResultBody {
  const item = result.content[0]
  assert.equal(item.type, 'text')
  return JSON.parse(item.text) as ResultBody
}

describe('automatic MCP task health gate', () => {
  let db: HarnessDB
  let taskId: number
  beforeEach(async () => {
    mkdirSync(TMP, { recursive: true })
    writeFileSync(join(TMP, 'health.sh'), '#!/usr/bin/env bash\necho healthy\nexit 0\n')
    db = await openDB(config, TMP)
    taskId = (await db.addTask({ slug: 'health-gate', title: 'Health gate' })).id
  })
  afterEach(async () => { await db.close(); rmSync(TMP, { recursive: true, force: true }) })

  test('claim runs health and enables normal work on a pass', async () => {
    const claim = await dispatch('tasks.claim', { id: taskId, agent: 'lead' }, db, TMP, TMP, config)
    assert.equal(claim.isError, false)
    assert.equal(body(claim).health?.state, 'passed')
    assert.equal(body(claim).executionMode, 'normal')
    assert.equal((await dispatch('actions.start', { taskId, agent: 'builder' }, db, TMP, TMP, config)).isError, false)
  })

  test('failed claim remains owned and blocks builder until an audited repair', async () => {
    writeFileSync(join(TMP, 'health.sh'), '#!/usr/bin/env bash\nexit 1\n')
    const claim = await dispatch('tasks.claim', { id: taskId, agent: 'lead' }, db, TMP, TMP, config)
    assert.equal(claim.isError, true)
    assert.equal(body(claim).executionMode, 'blocked')
    assert.equal((await db.getTaskById(taskId))?.assigned_to, 'lead')
    assert.equal((await dispatch('actions.start', { taskId, agent: 'explorer' }, db, TMP, TMP, config)).isError, false)
    await assert.rejects(() => dispatch('actions.start', { taskId, agent: 'builder' }, db, TMP, TMP, config), /execution mode is 'blocked'/)
    const repair = await dispatch('tasks.repair.begin', { taskId, actor: 'lead', reason: 'health script must be repaired', scope: 'health.sh only' }, db, TMP, TMP, config)
    assert.equal(repair.isError, false)
    assert.equal(body(repair).task?.execution_mode, 'repair')
    assert.equal((await dispatch('actions.start', { taskId, agent: 'builder' }, db, TMP, TMP, config)).isError, false)
  })

  test('repair entry requires failed server-owned health evidence', async () => {
    await dispatch('tasks.claim', { id: taskId, agent: 'lead' }, db, TMP, TMP, config)
    const denied = await dispatch('tasks.repair.begin', { taskId, actor: 'lead', reason: 'no failure', scope: 'none' }, db, TMP, TMP, config)
    assert.equal(denied.isError, true)
    assert.equal(body(denied).error, 'failed_health_required')
  })

  test('repair audit references persisted failed evidence and rejects duplicates or blank audit fields', async () => {
    writeFileSync(join(TMP, 'health.sh'), '#!/usr/bin/env bash\nexit 1\n')
    await dispatch('tasks.claim', { id: taskId, agent: 'lead' }, db, TMP, TMP, config)
    const blank = await dispatch('tasks.repair.begin', { taskId, actor: ' ', reason: ' ', scope: ' ' }, db, TMP, TMP, config)
    assert.equal(blank.isError, true)
    assert.equal(body(blank).error, 'invalid_repair_audit')
    const repair = await dispatch('tasks.repair.begin', { taskId, actor: 'lead', reason: 'broken check', scope: 'health.sh' }, db, TMP, TMP, config)
    assert.equal(repair.isError, false)
    const rows = await db.queryRaw<{ failed_health_run_id: string }>('SELECT failed_health_run_id FROM task_repairs WHERE task_id = ?', taskId)
    assert.equal(rows.length, 1)
    const runs = await db.queryRaw<{ status: string }>('SELECT status FROM task_health_runs WHERE id = ?', rows[0].failed_health_run_id)
    assert.equal(runs[0].status, 'failed')
    const duplicate = await dispatch('tasks.repair.begin', { taskId, actor: 'lead', reason: 'again', scope: 'health.sh' }, db, TMP, TMP, config)
    assert.equal(duplicate.isError, true)
    assert.equal(body(duplicate).error, 'repair_already_active')
  })

  test('superseded runs and released claims cannot authorize completion or repair', async () => {
    await dispatch('tasks.claim', { id: taskId, agent: 'lead' }, db, TMP, TMP, config)
    const first = await runTaskHealthCheck(db, TMP, config, taskId)
    const second = await runTaskHealthCheck(db, TMP, config, taskId)
    assert.equal(await db.resolveHealthMode(taskId, first, 'manual'), null)
    assert.ok(await db.resolveHealthMode(taskId, second, 'manual'))
    const verifying = await db.beginVerification(taskId)
    assert.ok(verifying)
    const final = await runTaskHealthCheck(db, TMP, config, taskId)
    assert.ok(await db.resolveHealthMode(taskId, final, 'verify'))
    await db.updateTaskStatus(taskId, 'pending')
    assert.equal(await db.finalizeVerifiedTask(taskId, final), null)
    const reclaimed = await dispatch('tasks.claim', { id: taskId, agent: 'lead' }, db, TMP, TMP, config)
    assert.equal(reclaimed.isError, false)
    const repair = await dispatch('tasks.repair.begin', { taskId, actor: 'lead', reason: 'old failure', scope: 'none' }, db, TMP, TMP, config)
    assert.equal(repair.isError, true)
    await assert.rejects(() => db.updateTaskStatus(taskId, 'done'), /Direct completion is forbidden/)
  })

  test('done runs fresh health itself and keeps a failed task open', async () => {
    await dispatch('tasks.claim', { id: taskId, agent: 'lead' }, db, TMP, TMP, config)
    writeFileSync(join(TMP, 'health.sh'), '#!/usr/bin/env bash\necho failed\nexit 1\n')
    const done = await dispatch('tasks.update', { id: taskId, status: 'done' }, db, TMP, TMP, config)
    assert.equal(done.isError, true)
    assert.equal(body(done).error, 'final_health_failed')
    assert.equal((await db.getTaskById(taskId))?.status, 'in_progress')
    assert.equal((await db.getTaskById(taskId))?.execution_mode, 'blocked')
  })

  test('done closes after its own fresh health pass', async () => {
    await dispatch('tasks.claim', { id: taskId, agent: 'lead' }, db, TMP, TMP, config)
    const orphan = body(await dispatch('actions.start', { taskId, agent: 'builder' }, db, TMP, TMP, config)).actionId
    assert.equal(typeof orphan, 'number')
    const done = await dispatch('tasks.update', { id: taskId, status: 'done' }, db, TMP, TMP, config)
    assert.equal(done.isError, false)
    assert.equal(body(done).task?.status, 'done')
    assert.equal((await db.getAction(orphan!))?.status, 'completed')
  })
})
