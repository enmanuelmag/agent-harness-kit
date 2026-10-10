import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const ROOT = join(import.meta.dirname, '../..')
const SCRIPT = join(ROOT, 'scripts/publish.sh')
const METADATA = join(ROOT, 'scripts/release-metadata.mjs')

function fixture(version: string, branch = 'release/v3') {
  const cwd = mkdtempSync(join(ROOT, '.tmp-release-preparation-'))
  const bin = join(cwd, '.test-bin')
  mkdirSync(join(cwd, 'scripts'))
  mkdirSync(bin)
  cpSync(SCRIPT, join(cwd, 'scripts/publish.sh'))
  cpSync(METADATA, join(cwd, 'scripts/release-metadata.mjs'))
  writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'test-package', version }))
  writeFileSync(join(cwd, '.gitignore'), '.test-bin/\ncalls.log\n*.tgz\n')
  const gitPath = execFileSync('which', ['git'], { encoding: 'utf8' }).trim()
  const git = (...args: string[]) =>
    execFileSync(gitPath, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git('init', '-b', branch)
  git('config', 'user.name', 'Release Test')
  git('config', 'user.email', 'test@example.invalid')
  git('add', '.')
  git('commit', '-m', 'test: initial fixture')
  symlinkSync(process.execPath, join(bin, 'node'))
  const executable = (name: string, body: string) =>
    writeFileSync(join(bin, name), '#!/bin/bash\n' + body, { mode: 0o755 })
  executable(
    'git',
    `if [[ "$1" == push ]]; then echo "git $*" >> "$CALL_LOG"; exit 0; fi\nexec "${gitPath}" "$@"\n`
  )
  executable(
    'pnpm',
    'echo "pnpm $*" >> "$CALL_LOG"\nif [[ "$1" == pack ]]; then echo fixture.tgz; fi\n'
  )
  executable('npm', 'echo "npm $*" >> "$CALL_LOG"\n')
  executable(
    'gh',
    'echo "gh $*" >> "$CALL_LOG"\nif [[ "$1" == repo ]]; then echo https://example.invalid/repo; fi\n'
  )
  const env = {
    ...process.env,
    RELEASE_BRANCH: branch,
    PATH: `${bin}:${process.env.PATH}`,
    CALL_LOG: join(cwd, 'calls.log'),
  }
  return {
    cwd,
    git,
    run: (...args: string[]) =>
      spawnSync('bash', ['scripts/publish.sh', ...args], { cwd, env, encoding: 'utf8' }),
    log: () => readFileSync(join(cwd, 'calls.log'), 'utf8'),
    cleanup: () => rmSync(cwd, { recursive: true, force: true }),
  }
}

test('RC dry-run reuses an annotated HEAD tag without auth, pushes or releases', () => {
  const f = fixture('3.0.0-rc.1')
  try {
    f.git('tag', '-a', 'v3.0.0-rc.1', '-m', 'Prepared RC')
    const before = f.git('show-ref', '--tags')
    const result = f.run('--dry-run', '--skip-tests')
    assert.equal(result.status, 0, result.stderr || result.stdout)
    const log = f.log()
    assert.match(log, /npm publish fixture.tgz --access public --tag rc --dry-run/)
    assert.doesNotMatch(log, /gh |git push/)
    assert.equal(f.git('show-ref', '--tags'), before)
  } finally {
    f.cleanup()
  }
})

test('prepared RC publishes to rc and marks GitHub prerelease, never latest', () => {
  const f = fixture('3.0.0-rc.1')
  try {
    f.git('tag', '-a', 'v3.0.0-rc.1', '-m', 'Prepared RC')
    const before = f.git('rev-parse', 'v3.0.0-rc.1')
    const result = f.run('--skip-tests')
    assert.equal(result.status, 0, result.stderr || result.stdout)
    assert.match(f.log(), /npm publish fixture.tgz --access public --tag rc/)
    assert.match(f.log(), /gh release create v3.0.0-rc.1[\s\S]*--prerelease --latest=false/)
    assert.equal(f.git('rev-parse', 'v3.0.0-rc.1'), before)
  } finally {
    f.cleanup()
  }
})

test('stable v2 release uses its maintenance channel and creates its new immutable tag', () => {
  const f = fixture('2.36.2', 'release/v2')
  try {
    const result = f.run('--skip-tests')
    assert.equal(result.status, 0, result.stderr || result.stdout)
    assert.match(f.log(), /npm publish fixture.tgz --access public --tag v2/)
    assert.doesNotMatch(f.log(), /--prerelease/)
    assert.match(f.log(), /--latest=false/)
    assert.equal(f.git('rev-parse', 'v2.36.2^{}'), f.git('rev-parse', 'HEAD'))
  } finally {
    f.cleanup()
  }
})

test('stable v3 dry-run targets latest from main without requiring an existing tag', () => {
  const f = fixture('3.0.0', 'main')
  try {
    const result = f.run('--dry-run', '--skip-tests')
    assert.equal(result.status, 0, result.stderr || result.stdout)
    assert.match(f.log(), /npm publish fixture.tgz --access public --tag latest --dry-run/)
    assert.doesNotMatch(f.log(), /gh |git push/)
    assert.equal(f.git('tag', '--list'), '')
  } finally {
    f.cleanup()
  }
})

test('divergent existing tag and branch/version mismatches stop before publishing', () => {
  const divergent = fixture('3.0.0-rc.1')
  try {
    divergent.git('tag', 'v3.0.0-rc.1')
    writeFileSync(join(divergent.cwd, 'change'), 'change')
    divergent.git('add', 'change')
    divergent.git('commit', '-m', 'test: later commit')
    const result = divergent.run('--dry-run', '--skip-tests')
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /another commit/)
  } finally {
    divergent.cleanup()
  }
  for (const [version, branch] of [
    ['3.0.0-rc.1', 'release/v2'],
    ['2.36.2', 'release/v3'],
    ['2.36.2', 'main'],
  ]) {
    const f = fixture(version, branch)
    try {
      const result = f.run('--dry-run', '--skip-tests')
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /requires a/)
    } finally {
      f.cleanup()
    }
  }
})
