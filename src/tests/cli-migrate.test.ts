import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, test } from 'node:test'

// Exercises the compiled CLI (dist/cli.js) end-to-end, same pattern as
// cli-guard-integration.test.ts, so the commander subcommand wiring for
// `migrate provider` / `migrate storage` / the `migrate --to <x>`
// backward-compatible alias is verified, not just the handler functions in
// isolation. Skipped when dist/cli.js hasn't been built yet.
const CLI_PATH = join(import.meta.dirname, '../../dist/cli.js')
const TMP_BASE = join(import.meta.dirname, '../../.tmp-cli-migrate-test')

function runCli(args: string[], cwd: string) {
  return spawnSync('node', [CLI_PATH, ...args], { cwd, encoding: 'utf8' })
}

/** Sets up a project dir that satisfies the local-install guard via the
 *  "self-dev" bypass (package.json name === this package's name), so
 *  commands run without needing a node_modules install. */
function setupProject(dir: string): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@cardor/agent-harness-kit' }, null, 2), 'utf8')
  writeFileSync(
    join(dir, 'agent-harness-kit.config.ts'),
    `export default {\n  project: { name: 'test', description: 'test', docsPath: './docs' },\n  provider: 'claude-code',\n}\n`,
    'utf8',
  )
}

describe('ahk migrate — provider subcommand + backward-compatible alias (integration)', { skip: !existsSync(CLI_PATH) }, () => {
  afterEach(() => rmSync(TMP_BASE, { recursive: true, force: true }))

  test('`migrate --to <same-provider>` (legacy alias) reports nothing-to-migrate', () => {
    const dir = join(TMP_BASE, 'alias-noop')
    setupProject(dir)
    const result = runCli(['migrate', '--to', 'claude-code'], dir)
    assert.equal(result.status, 0)
    assert.match(result.stdout, /nothing to migrate/i)
  })

  test('`migrate provider --to <same-provider>` (explicit subcommand) reports the same nothing-to-migrate', () => {
    const dir = join(TMP_BASE, 'provider-noop')
    setupProject(dir)
    const result = runCli(['migrate', 'provider', '--to', 'claude-code'], dir)
    assert.equal(result.status, 0)
    assert.match(result.stdout, /nothing to migrate/i)
  })

  test('`migrate` (parent) and `migrate provider` (subcommand) both list in --help', () => {
    const dir = join(TMP_BASE, 'help')
    setupProject(dir)
    const result = runCli(['migrate', '--help'], dir)
    assert.equal(result.status, 0)
    assert.match(result.stdout, /provider \[options\]/)
    assert.match(result.stdout, /storage \[options\]/)
  })

  test('`migrate storage --help` documents --force and --dry-run', () => {
    const dir = join(TMP_BASE, 'storage-help')
    setupProject(dir)
    const result = runCli(['migrate', 'storage', '--help'], dir)
    assert.equal(result.status, 0)
    assert.match(result.stdout, /--force/)
    assert.match(result.stdout, /--dry-run/)
  })

  test('`migrate storage` on a fresh project (no prior data) records storage-state and exits 0', () => {
    const dir = join(TMP_BASE, 'storage-fresh')
    setupProject(dir)
    const result = runCli(['migrate', 'storage'], dir)
    assert.equal(result.status, 0, result.stderr)
    assert.ok(existsSync(join(dir, '.harness', 'storage-state.json')))
  })
})
