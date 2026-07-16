import assert from 'node:assert/strict'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, test } from 'node:test'

// This test exercises the compiled CLI (dist/cli.js) end-to-end so the
// commander preAction hook wiring is verified, not just the guard
// utility in isolation. It is skipped when dist/cli.js hasn't been built
// yet (e.g. a fresh checkout before `pnpm run build`).
const CLI_PATH = join(import.meta.dirname, '../../dist/cli.js')
const TMP_BASE = join(import.meta.dirname, '../../.tmp-cli-guard-integration')

function runCli(args: string[], cwd: string) {
  return spawnSync('node', [CLI_PATH, ...args], { cwd, encoding: 'utf8' })
}

describe('CLI local-install guard (integration)', { skip: !existsSync(CLI_PATH) }, () => {
  test('--version is not blocked in a cwd with no local install', () => {
    const dir = join(TMP_BASE, 'version')
    mkdirSync(dir, { recursive: true })
    const result = runCli(['--version'], dir)
    assert.equal(result.status, 0)
    rmSync(TMP_BASE, { recursive: true, force: true })
  })

  test('--help is not blocked in a cwd with no local install', () => {
    const dir = join(TMP_BASE, 'help')
    mkdirSync(dir, { recursive: true })
    const result = runCli(['--help'], dir)
    assert.equal(result.status, 0)
    assert.match(result.stdout, /Usage: ahk/)
    rmSync(TMP_BASE, { recursive: true, force: true })
  })

  test('a project command is blocked with a clear message when global-only', () => {
    const dir = join(TMP_BASE, 'status-blocked')
    mkdirSync(dir, { recursive: true })
    const result = runCli(['status'], dir)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /must be installed locally/)
    assert.match(result.stderr, /npm install --save-dev @cardor\/agent-harness-kit/)
    rmSync(TMP_BASE, { recursive: true, force: true })
  })
})
