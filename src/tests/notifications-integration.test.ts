import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { Client, InMemoryTransport } from '@modelcontextprotocol/client'

import { HarnessDB } from '../core/db'
import { SQLiteDriver } from '../core/drivers/sqlite'
import { createMcpServer } from '../core/mcp-server'
import { NotificationLedger } from '../core/notifications/ledger'
import {
  appendNotificationMarker,
  captureNotificationEvents,
  readNotificationMarkers,
} from '../core/notifications/marker'
import { NotificationService } from '../core/notifications/runtime'

import type { DBDriver } from '../core/drivers/types'
import type { NotificationEvent } from '../core/notifications/types'
import type { HarnessConfig } from '../types'

async function fixture(now?: () => number) {
  const cwd = mkdtempSync(join(import.meta.dirname, '../../.tmp-notifications-integration-'))
  mkdirSync(join(cwd, 'docs'))
  const config: HarnessConfig = {
    project: { name: 'notifications', description: '', docsPath: './docs' },
    provider: 'codex-cli',
    database: { type: 'sqlite' },
    notifications: { enabled: true, pendingWaitMs: 0 },
    storage: {
      scope: 'local',
      dir: '.harness',
      projectId: 'isolated',
      sqlitePath: join(cwd, 'tasks.db'),
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
  const events: NotificationEvent[] = []
  const service = new NotificationService(config, cwd, {
    homeDir: join(cwd, 'private-home'),
    now,
    dispatch: (event) => {
      events.push(event)
    },
  })
  const driver = new SQLiteDriver(join(cwd, 'tasks.db'))
  await driver.ensureSchema()
  const db = new HarnessDB(driver, config, undefined, undefined, undefined, service)
  return {
    cwd,
    config,
    events,
    service,
    driver,
    db,
    async close() {
      await db.close()
      rmSync(cwd, { recursive: true, force: true })
    },
  }
}
async function health(
  f: Awaited<ReturnType<typeof fixture>>,
  taskId: number,
  mode: 'checking' | 'blocked' | 'verifying' | 'repair' | 'normal',
  state: 'passed' | 'failed',
  phase: 'claim' | 'manual' | 'verify',
  run: string
) {
  await f.driver.exec(
    'UPDATE tasks SET execution_mode=?,health_run_id=?,health_status=? WHERE id=?',
    [mode, run, state, taskId]
  )
  const task = (await f.db.getTaskById(taskId))!
  return f.db.resolveHealthMode(
    taskId,
    { state, runId: run, claimGeneration: task.claim_generation, executionMode: mode },
    phase
  )
}
function markPlayed(
  f: Awaited<ReturnType<typeof fixture>>,
  event: NotificationEvent,
  now?: () => number
) {
  const ledger = new NotificationLedger(f.service.ledgerPath, f.service.settings, now)
  assert.deepEqual(ledger.claimEvent(event.id, 'test-owner'), { ok: true, value: true })
  assert.deepEqual(ledger.finishEvent(event.id, 'test-owner', 'played'), { ok: true, value: true })
  ledger.close()
}
test('blocked episodes survive repeated diagnostics/verifying/repair and reset only after real recovery', async () => {
  const f = await fixture()
  try {
    const task = await f.db.addTask({ slug: 'episode', title: 'episode' })
    await f.db.claimTask(task.id, 'lead')
    await health(f, task.id, 'checking', 'failed', 'claim', 'first')
    assert.equal(f.events.length, 1)
    assert.equal(f.events[0].kind, 'health.blocked')
    await health(f, task.id, 'blocked', 'failed', 'manual', 'repeat')
    await health(f, task.id, 'verifying', 'failed', 'verify', 'transient')
    await health(f, task.id, 'repair', 'passed', 'manual', 'repair-green')
    await health(f, task.id, 'verifying', 'passed', 'verify', 'verify-green')
    await health(f, task.id, 'verifying', 'failed', 'verify', 'still-same')
    assert.equal(f.events.length, 1, 'transient green verifying/repair never clears episode')
    await health(f, task.id, 'blocked', 'passed', 'manual', 'recovered')
    await health(f, task.id, 'normal', 'failed', 'manual', 'new-episode')
    assert.equal(f.events.length, 2)
    assert.notEqual(f.events[0].id, f.events[1].id)
    const previous = f.events.length
    const row = (await f.db.getTaskById(task.id))!
    assert.equal(
      await f.db.resolveHealthMode(
        task.id,
        {
          state: 'failed',
          runId: 'not-current',
          claimGeneration: row.claim_generation,
          executionMode: 'blocked',
        },
        'manual'
      ),
      null
    )
    assert.equal(f.events.length, previous)
  } finally {
    await f.close()
  }
})
test('DONE is postcommit only; null, action completion and rollback emit no task event', async () => {
  const f = await fixture()
  try {
    const task = await f.db.addTask({ slug: 'done', title: 'done' })
    await f.db.claimTask(task.id, 'lead')
    const action = await f.db.startAction(task.id, 'lead')
    await f.db.completeAction(action.id, 'analysis finished')
    assert.equal(f.events.length, 0, 'action completion is not task completion')
    await health(f, task.id, 'verifying', 'passed', 'verify', 'done-run')
    const row = (await f.db.getTaskById(task.id))!
    assert.equal(
      await f.db.finalizeVerifiedTask(task.id, {
        state: 'failed',
        runId: 'done-run',
        claimGeneration: row.claim_generation,
        executionMode: 'verifying',
      }),
      null
    )
    assert.equal(f.events.length, 0)
    const cause = new Error('forced transaction rollback')
    const driver = new Proxy(f.driver, {
      get(target, key) {
        if (key === 'transaction')
          return <T>(fn: (tx: DBDriver) => Promise<T>) =>
            target.transaction(async (tx) => {
              await fn(tx)
              throw cause
            })
        const value = Reflect.get(target, key)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    const rollback = new HarnessDB(driver, f.config, undefined, undefined, undefined, f.service)
    await assert.rejects(
      rollback.finalizeVerifiedTask(task.id, {
        state: 'passed',
        runId: 'done-run',
        claimGeneration: row.claim_generation,
        executionMode: 'verifying',
      }),
      (e) => e === cause
    )
    assert.equal((await f.db.getTaskById(task.id))?.status, 'in_progress')
    assert.equal(f.events.length, 0)
    const complete = await f.db.finalizeVerifiedTask(task.id, {
      state: 'passed',
      runId: 'done-run',
      claimGeneration: row.claim_generation,
      executionMode: 'verifying',
    })
    assert.equal(complete?.status, 'done')
    assert.equal(f.events.length, 1)
    assert.equal(f.events[0].kind, 'task.completed')
    const stored = await f.db.getTaskById(task.id)
    assert.equal(stored?.status, 'done')
    assert.equal(
      await f.db.finalizeVerifiedTask(task.id, {
        state: 'passed',
        runId: 'done-run',
        claimGeneration: row.claim_generation,
        executionMode: 'verifying',
      }),
      null
    )
    assert.equal(f.events.length, 1)
  } finally {
    await f.close()
  }
})
test('same-turn played event suppresses Stop once, other turns/projects do not; attention remains independent', async () => {
  const f = await fixture()
  try {
    const result = await captureNotificationEvents(async () => {
      f.service.publish('task.completed', 'commit')
      return {
        content: [{ type: 'text' as const, text: '{"ok":true}' }],
        structuredContent: { ok: true },
        isError: false,
      }
    })
    const marked = appendNotificationMarker(result.result, result.events)
    assert.deepEqual(marked.structuredContent, result.result.structuredContent)
    assert.equal(marked.content[0], result.result.content[0])
    assert.equal(readNotificationMarkers(marked).length, 1)
    markPlayed(f, f.events[0])
    f.service.bindResponse(marked, 'cursor', 'conversation', 'turn1')
    await f.service.completeTurn('cursor', 'conversation', 'turn1', 'stop1')
    await f.service.completeTurn('cursor', 'conversation', 'turn1', 'stop1')
    assert.equal(f.events.length, 1)
    f.service.attention('cursor', 'question-after-done', 'conversation', 'turn1')
    assert.equal(f.events[1].kind, 'attention.requested')
    await f.service.completeTurn('cursor', 'conversation', 'turn2', 'stop2')
    assert.equal(f.events[2].kind, 'provider.completed')
    await f.service.completeTurn('cursor', 'conversation', 'turn2', 'stop2')
    assert.equal(f.events.length, 3)
    const foreign = new NotificationService(
      { ...f.config, storage: { ...f.config.storage, projectId: 'foreign' } },
      f.cwd,
      { homeDir: join(f.cwd, 'private-home'), dispatch: (e) => f.events.push(e) }
    )
    foreign.bindResponse(marked, 'cursor', 'conversation', 'turn1')
    await foreign.completeTurn('cursor', 'conversation', 'turn1', 'foreign-stop')
    assert.equal(f.events.length, 4)
    f.service.bindResponse(
      {
        content: [
          {
            type: 'text',
            text:
              'assistant says ' +
              JSON.stringify({ notificationSchemaVersion: 1, events: result.events }),
          },
        ],
      },
      'cursor',
      'conversation',
      'turn3'
    )
    await f.service.completeTurn('cursor', 'conversation', undefined, 'missing-id')
    assert.equal(f.events[4].kind, 'provider.completed')
  } finally {
    await f.close()
  }
})
test('disabled path creates no ledger and observer/delivery failure never changes persisted business outcome', async () => {
  const f = await fixture()
  try {
    const off = new NotificationService({ ...f.config, notifications: { enabled: false } }, f.cwd, {
      homeDir: join(f.cwd, 'disabled-home'),
    })
    off.publish('task.completed', 'disabled')
    await off.completeTurn('cursor', 's', 't', 'stop')
    assert.equal(existsSync(join(f.cwd, 'disabled-home')), false)
    const throwing = new NotificationService(f.config, f.cwd, {
      homeDir: join(f.cwd, 'failure-home'),
      dispatch: () => {
        throw Error('spawn failed')
      },
    })
    const db = new HarnessDB(f.driver, f.config, undefined, undefined, undefined, throwing)
    const task = await db.addTask({ slug: 'failure', title: 'failure' })
    await db.claimTask(task.id, 'lead')
    await health({ ...f, db }, task.id, 'checking', 'failed', 'claim', 'failure-run')
    assert.equal((await db.getTaskById(task.id))?.execution_mode, 'blocked')
    const ledger = new NotificationLedger(throwing.ledgerPath, throwing.settings)
    ledger.close()
  } finally {
    await f.close()
  }
})
test('real SDK adds call-scoped marker on blocked error and DONE without stripping DTO or mixing concurrent calls', async () => {
  const f = await fixture()
  writeFileSync(join(f.cwd, 'health.sh'), '#!/bin/sh\nexit 1\n', { mode: 0o755 })
  const client = new Client({ name: 'notification-test', version: '1' })
  const server = createMcpServer(f.config, f.cwd, f.db)
  const [a, b] = InMemoryTransport.createLinkedPair()
  try {
    await server.connect(b)
    await client.connect(a)
    const task = await f.db.addTask({ slug: 'sdk', title: 'sdk' })
    const [blocked, read] = await Promise.all([
      client.callTool({ name: 'tasks.claim', arguments: { id: task.id, agent: 'lead' } }),
      client.callTool({ name: 'tasks.get', arguments: {} }),
    ])
    assert.equal(readNotificationMarkers(read).length, 0)
    const markers = readNotificationMarkers(blocked)
    assert.equal(markers.length, 1)
    assert.equal(markers[0].kind, 'health.blocked')
    assert.equal(blocked.isError, true)
    const primary = JSON.parse((blocked.content as { text: string }[])[0].text)
    assert.equal(primary.executionMode, 'blocked')
    assert.equal(blocked.structuredContent, undefined, 'legacy error responses have no DTO')
    writeFileSync(join(f.cwd, 'health.sh'), '#!/bin/sh\nexit 0\n')
    const done = await client.callTool({
      name: 'tasks.update',
      arguments: { id: task.id, status: 'done' },
    })
    assert.equal(done.isError, false)
    assert.equal(readNotificationMarkers(done)[0].kind, 'task.completed')
    assert.deepEqual(
      done.structuredContent,
      JSON.parse((done.content as { text: string }[])[0].text)
    )
  } finally {
    await client.close()
    await server.close()
    await f.close()
  }
})

test('pending specific event waits for completion; failed event keeps general fallback available', async () => {
  const f = await fixture()
  f.service.settings.pendingWaitMs = 1500
  try {
    const captured = await captureNotificationEvents(async () => {
      f.service.publish('task.completed', 'pending-specific')
      return { content: [] }
    })
    const response = appendNotificationMarker(captured.result, captured.events)
    f.service.bindResponse(response, 'codex-cli', 'session', 'pending-turn')
    setImmediate(() => markPlayed(f, f.events[0]))
    await f.service.completeTurn('codex-cli', 'session', 'pending-turn', 'pending-stop')
    assert.equal(
      f.events.length,
      1,
      'no predictable fallback while successful specific playback completes'
    )
    const failed = await captureNotificationEvents(async () => {
      f.service.publish('health.blocked', 'failed-specific')
      return { content: [] }
    })
    f.service.bindResponse(
      appendNotificationMarker(failed.result, failed.events),
      'codex-cli',
      'session',
      'failed-turn'
    )
    const ledger = new NotificationLedger(f.service.ledgerPath, f.service.settings)
    ledger.claimEvent(f.events[1].id, 'failing-owner')
    ledger.finishEvent(f.events[1].id, 'failing-owner', 'failed')
    ledger.close()
    await f.service.completeTurn('codex-cli', 'session', 'failed-turn', 'failed-stop')
    assert.equal(f.events[2].kind, 'provider.completed')
  } finally {
    await f.close()
  }
})

test('expired terminal binding falls back with no intervening ledger write', async () => {
  let time = 1000000
  const now = () => time
  const f = await fixture(now)
  f.service.settings.maxAgeMs = 1000
  try {
    const captured = await captureNotificationEvents(async () => {
      f.service.publish('task.completed', 'ttl-specific')
      return { content: [] }
    })
    markPlayed(f, f.events[0], now)
    f.service.bindResponse(
      appendNotificationMarker(captured.result, captured.events),
      'cursor',
      'session',
      'reported-turn'
    )
    await f.service.completeTurn('cursor', 'session', 'reported-turn', 'reported-stop')
    await f.service.completeTurn('cursor', 'session', 'reported-turn', 'reported-stop')
    assert.equal(f.events.length, 1, 'fresh terminal retains idempotency')
    time += 1001 // No mutation/prune/write between terminalization and this completion.
    await f.service.completeTurn('cursor', 'session', 'reported-turn', 'reported-stop')
    assert.equal(f.events.length, 2)
    assert.equal(f.events[1].kind, 'provider.completed')
  } finally {
    await f.close()
  }
})

test('fresh terminal cannot suppress when its associated specific event was evicted', async () => {
  const f = await fixture()
  try {
    const captured = await captureNotificationEvents(async () => {
      f.service.publish('task.completed', 'evicted-specific')
      return { content: [] }
    })
    markPlayed(f, f.events[0])
    f.service.bindResponse(
      appendNotificationMarker(captured.result, captured.events),
      'cursor',
      'session',
      'reported-turn'
    )
    await f.service.completeTurn('cursor', 'session', 'reported-turn', 'reported-stop')
    const { openSQLite } = await import('../core/sqlite-adapter')
    const raw = openSQLite(f.service.ledgerPath)
    raw.prepare('DELETE FROM events WHERE id=?').run(f.events[0].id)
    raw.close()
    await f.service.completeTurn('cursor', 'session', 'reported-turn', 'reported-stop')
    assert.equal(f.events.length, 2)
    assert.equal(f.events[1].kind, 'provider.completed')
  } finally {
    await f.close()
  }
})
