import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'

// This test exercises the compiled CLI (dist/cli.js) end-to-end so the
// commander preAction hook wiring is verified, not just the guard
// utility in isolation. It is skipped when dist/cli.js hasn't been built
// yet (e.g. a fresh checkout before `pnpm run build`).
const CLI_PATH = join(import.meta.dirname, '../../dist/cli.js')
const TMP_BASE = join(import.meta.dirname, '../../.tmp-cli-guard-integration')

function runCli(args: string[], cwd: string, timeout?: number) {
  return spawnSync('node', [CLI_PATH, ...args], { cwd, encoding: 'utf8', timeout, killSignal: 'SIGKILL' })
}

// Minimal valid config so `status`/`doctor` succeed on their own merits —
// isolates the guard's behavior (warning only, never blocking) from
// unrelated failures like a missing config file.
function writeMinimalConfig(dir: string): void {
  writeFileSync(
    join(dir, 'agent-harness-kit.config.mjs'),
    `export default { project: { name: 'tmp-project', description: 'tmp' } }\n`,
    'utf8'
  )
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

  test('a project command prints a non-blocking warning when global-only, but still exits 0', () => {
    const dir = join(TMP_BASE, 'status-warned')
    mkdirSync(dir, { recursive: true })
    writeMinimalConfig(dir)
    const result = runCli(['status'], dir)
    assert.equal(result.status, 0)
    assert.match(result.stderr, /is not installed locally/)
    assert.match(result.stderr, /npm install --save-dev @cardor\/agent-harness-kit/)
    rmSync(TMP_BASE, { recursive: true, force: true })
  })

  test('the guard never forces a non-zero exit code, regardless of command or install state', () => {
    const dir = join(TMP_BASE, 'never-blocks')
    mkdirSync(dir, { recursive: true })
    writeMinimalConfig(dir)
    for (const args of [['status'], ['doctor'], ['--help']]) {
      const result = runCli(args, dir)
      assert.equal(result.status, 0, `expected exit 0 for ${JSON.stringify(args)}, got ${result.status}`)
    }
    rmSync(TMP_BASE, { recursive: true, force: true })
  })
})

// The shared `parsePort` coercion validates `--port` at the CLI boundary for
// BOTH `dashboard` and `serve`. A bad value must produce a clean, non-zero
// commander error naming the flag and the valid range (1-65535) — never a
// silent NaN or a truncated value. Commander runs the coercion synchronously
// at parse time (before any action/async work), so an invalid value always
// exits fast; only a valid value proceeds far enough to potentially hang, so
// valid-port cases are run with a timeout and asserted on the absence of a
// parse error rather than on a successful start.
const INVALID_ARG = /is invalid/
const RANGE_HINT = /must be an integer between 1 and 65535/

describe('CLI --port validation (integration)', { skip: !existsSync(CLI_PATH) }, () => {
  test('dashboard -p abc: non-numeric is rejected with a clean, non-zero error naming --port', () => {
    const dir = join(TMP_BASE, 'port-abc')
    mkdirSync(dir, { recursive: true })
    const result = runCli(['dashboard', '-p', 'abc', '--no-open'], dir)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /--port/)
    assert.match(result.stderr, RANGE_HINT)
    assert.doesNotMatch(result.stderr, /NaN/)
    rmSync(TMP_BASE, { recursive: true, force: true })
  })

  test('dashboard -p 0 and -p 65536: out-of-range values are rejected', () => {
    const dir = join(TMP_BASE, 'port-range')
    mkdirSync(dir, { recursive: true })
    for (const bad of ['0', '65536']) {
      const result = runCli(['dashboard', '-p', bad, '--no-open'], dir)
      assert.notEqual(result.status, 0, `expected non-zero exit for -p ${bad}`)
      assert.match(result.stderr, RANGE_HINT, `expected range hint for -p ${bad}`)
    }
    rmSync(TMP_BASE, { recursive: true, force: true })
  })

  test('dashboard -p 4242abc: trailing garbage is rejected, not truncated to 4242', () => {
    const dir = join(TMP_BASE, 'port-garbage')
    mkdirSync(dir, { recursive: true })
    const result = runCli(['dashboard', '-p', '4242abc', '--no-open'], dir)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, INVALID_ARG)
    rmSync(TMP_BASE, { recursive: true, force: true })
  })

  test('dashboard -p 1 and -p 65535: valid boundaries pass validation (no parse error)', () => {
    const dir = join(TMP_BASE, 'port-boundaries')
    mkdirSync(dir, { recursive: true })
    writeMinimalConfig(dir)
    for (const good of ['1', '65535']) {
      // A valid port gets past parsing and may start (and hang) or fail for an
      // unrelated reason (e.g. a privileged port cannot bind); the timeout kills
      // any started server. Either way there must be NO parse/validation error.
      const result = runCli(['dashboard', '-p', good, '--no-open'], dir, 4000)
      assert.doesNotMatch(result.stderr ?? '', INVALID_ARG, `-p ${good} should not be a parse error`)
      assert.doesNotMatch(result.stderr ?? '', RANGE_HINT, `-p ${good} should not be a range error`)
    }
    rmSync(TMP_BASE, { recursive: true, force: true })
  })

  test('serve --port abc: the same validation covers serve, not just dashboard', () => {
    const dir = join(TMP_BASE, 'serve-abc')
    mkdirSync(dir, { recursive: true })
    const result = runCli(['serve', '--port', 'abc'], dir)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /--port/)
    assert.match(result.stderr, RANGE_HINT)
    rmSync(TMP_BASE, { recursive: true, force: true })
  })
})
