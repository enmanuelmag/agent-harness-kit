import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { normalizeNotifications } from '../core/notifications/config.js'
import { NotificationLedger } from '../core/notifications/ledger.js'
import { playNotification, resolveSoundAsset } from '../core/notifications/player.js'
import { deliverEvent } from '../core/notifications/worker.js'

test('blocking sound is one sequential event with a 150 ms gap and a shared deadline', async () => {
  const settings = normalizeNotifications({ enabled: true })
  let now = 0
  const calls: unknown[] = []
  const result = await playNotification('health.blocked', settings, {
    platform: 'darwin',
    command: '/fake/player',
    now: () => now,
    run: async (command, args, timeout) => {
      calls.push([command, args, timeout])
      now += 100
    },
    delay: async (ms) => {
      calls.push(ms)
      now += ms
    },
  })
  assert.deepEqual(result, { ok: true, value: 'played' })
  assert.equal(calls.length, 3)
  assert.equal(calls[1], 150)
  assert.equal((calls[0] as unknown[])[2], 3000)
  assert.equal((calls[2] as unknown[])[2], 2750)
  assert.ok(resolveSoundAsset('task-completed.wav').endsWith('assets/sounds/task-completed.wav'))
  assert.throws(() => resolveSoundAsset('../../private.wav'))
})

test('partial playback failure preserves cause and prevents retries', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ahk-notification-player-'))
  const path = join(directory, 'notifications.db')
  const settings = normalizeNotifications({ enabled: true })
  const ledger = new NotificationLedger(path, settings)
  const event = ledger.reserveEvent({
    eventKey: 'blocked',
    kind: 'health.blocked',
    projectKey: 'p',
  })
  ledger.close()
  assert.ok(event.ok)
  const cause = new Error('second playback failed')
  let calls = 0
  const options = {
    command: '/fake/player',
    run: async () => {
      if (++calls === 2) throw cause
    },
    delay: async () => {},
  }
  try {
    const result = await deliverEvent(event.value.id, settings, path, options)
    assert.ok(!result.ok)
    assert.equal(result.error.cause, cause)
    const repeat = await deliverEvent(event.value.id, settings, path, options)
    assert.deepEqual(repeat, { ok: true, value: 'skipped' })
    assert.equal(calls, 2)
    const check = new NotificationLedger(path, settings)
    try {
      const stored = check.getEvent(event.value.id)
      assert.ok(stored.ok)
      assert.equal(stored.value?.status, 'failed')
    } finally {
      check.close()
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('disabled and unsupported capabilities skip without spawning', async () => {
  let calls = 0
  const run = async () => {
    calls++
  }
  assert.deepEqual(
    await playNotification('task.completed', normalizeNotifications(undefined), { run }),
    { ok: true, value: 'skipped' }
  )
  assert.deepEqual(
    await playNotification('task.completed', normalizeNotifications({ enabled: true }), {
      platform: 'win32',
      run,
    }),
    { ok: true, value: 'skipped' }
  )
  assert.equal(calls, 0)
})

test('quiet child timeout and command failure are controlled Results', async () => {
  const settings = normalizeNotifications({ enabled: true, playerTimeoutMs: 100 })
  // Node treats the asset as JavaScript and fails without playing audio; stdout/stderr stay ignored.
  const failed = await playNotification('task.completed', settings, { command: process.execPath })
  assert.ok(!failed.ok)
  const missing = await playNotification('task.completed', settings, {
    command: '/does/not/exist/ahk-player',
  })
  assert.ok(!missing.ok)
  if (process.platform !== 'win32') {
    const directory = mkdtempSync(join(tmpdir(), 'ahk-player-timeout-'))
    const command = join(directory, 'fake-player')
    writeFileSync(command, '#!/usr/bin/env node\nsetTimeout(() => {}, 10000)\n', { mode: 0o700 })
    try {
      const timedOut = await playNotification('task.completed', settings, { command })
      assert.ok(!timedOut.ok)
      assert.equal(timedOut.error.message, 'Notification player timed out')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  }
})
