import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, test } from 'node:test'

import { printSuccessfulHealthTail } from '@/commands/task/done'
import {
  executeHealthCheck,
  getDefaultHealthScriptPath,
  inspectHealthCheck,
  isHealthPlaceholder,
} from '@/core/health-check'
import { ensureNativeHealthScaffold } from '@/core/materializer/scaffold-utils'
import { HEALTH_BAT, HEALTH_SH } from '@/core/materializer/templates'

const TMP = join(import.meta.dirname, '../../.tmp-health-core-test')

describe('portable health checks', () => {
  beforeEach(() => { rmSync(TMP, { recursive: true, force: true }); mkdirSync(TMP, { recursive: true }) })
  afterEach(() => rmSync(TMP, { recursive: true, force: true }))

  test('selects a native reserved filename', () => {
    assert.equal(getDefaultHealthScriptPath('darwin'), './health.sh')
    assert.equal(getDefaultHealthScriptPath('linux'), './health.sh')
    assert.equal(getDefaultHealthScriptPath('win32'), './health.bat')
  })

  test('creates only the native scaffold and preserves an opposite script', () => {
    writeFileSync(join(TMP, 'health.sh'), '#!/usr/bin/env bash\necho old\n', 'utf8')
    assert.equal(ensureNativeHealthScaffold(TMP, 'win32'), './health.bat')
    assert.match(requireText('health.bat'), /AHK_HEALTH_CHECK_PLACEHOLDER/)
    assert.equal(requireText('health.sh'), '#!/usr/bin/env bash\necho old\n')
  })

  test('recognizes the marker and legacy dummy echo but not real checks', () => {
    assert.equal(isHealthPlaceholder('# AHK_HEALTH_CHECK_PLACEHOLDER\n'), true)
    assert.equal(isHealthPlaceholder('echo "health.sh not implemented yet."\necho "Edit this file with your project checks."\nexit 1\n'), true)
    assert.equal(isHealthPlaceholder('echo "dummy fixture tests"\nnpm test\n'), false)
  })

  test('normalizes historical default config but rejects an explicit wrong-platform custom path', () => {
    writeFileSync(join(TMP, 'health.bat'), '@echo off\nexit /b 0\n', 'utf8')
    assert.equal(inspectHealthCheck(TMP, './health.sh', 'win32').path, join(TMP, 'health.bat'))
    assert.equal(inspectHealthCheck(TMP, './scripts/check.sh', 'win32').state, 'incompatible')
  })

  test('captures complete output and returns bounded 10/100-line previews', () => {
    const script = join(TMP, 'health.sh')
    writeFileSync(script, '#!/usr/bin/env bash\nfor i in $(seq 1 150); do echo "line $i"; done\nexit 1\n', 'utf8')
    chmodSync(script, 0o755)
    const failed = executeHealthCheck(TMP, script, 'linux')
    assert.equal(failed.status, 1)
    assert.equal(failed.tail.split('\n').length, 100)
    assert.match(failed.tail, /line 150/)
    writeFileSync(script, '#!/usr/bin/env bash\nfor i in $(seq 1 20); do echo "line $i"; done\n', 'utf8')
    const passed = executeHealthCheck(TMP, script, 'linux')
    assert.equal(passed.status, 0)
    assert.equal(passed.tail.split('\n').length, 10)
  })

  test('generated Bash scaffold directly reports its failure tail and retained log', () => {
    const script = join(TMP, 'health.sh')
    writeFileSync(script, HEALTH_SH, 'utf8')
    chmodSync(script, 0o755)
    const result = spawnSync('bash', [script], { encoding: 'utf8' })
    assert.equal(result.status, 1)
    assert.match(result.stdout, /health\.sh not implemented yet/)
    assert.match(result.stderr, /Full health log: .*ahk-health/)
  })

  test('generated Bash wrapper keeps the 10-line success contract after checks are implemented', () => {
    const script = join(TMP, 'health.sh')
    const completed = HEALTH_SH
      .replace('# AHK_HEALTH_CHECK_PLACEHOLDER — replace this marker when implementing real checks.\n', '')
      .replace(/  echo "health\.sh not implemented yet\."\n  echo "Edit this file with your project's health checks\."\n  echo "It must exit 0 for agents to start working\."\n  exit 1/, '  for i in $(seq 1 20); do echo "check $i"; done')
    writeFileSync(script, completed, 'utf8')
    chmodSync(script, 0o755)
    const result = spawnSync('bash', [script], { encoding: 'utf8' })
    assert.equal(result.status, 0)
    assert.equal(result.stdout.trim().split('\n').length, 10)
    assert.match(result.stdout, /check 20/)
  })

  test('generated batch scaffold retains the static native compact-output contract', () => {
    assert.match(HEALTH_BAT, /AHK_HEALTH_CHECK_PLACEHOLDER/)
    assert.match(HEALTH_BAT, /call :checks > "%LOG_FILE%" 2>&1/)
    assert.match(HEALTH_BAT, /-Tail 10/)
    assert.match(HEALTH_BAT, /-Tail 100/)
    assert.match(HEALTH_BAT, /exit \/b %STATUS%/)
  })

  test('task completion renders the successful compact health tail', () => {
    const messages: string[] = []
    const original = console.log
    console.log = (...args: unknown[]) => { messages.push(args.join(' ')) }
    try { printSuccessfulHealthTail('check 11\ncheck 12') } finally { console.log = original }
    assert.deepEqual(messages, ['check 11\ncheck 12'])
  })

  function requireText(name: string): string {
    return readFileSync(join(TMP, name), 'utf8')
  }
})
