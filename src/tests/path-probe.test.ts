import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'

import { isLocalInstallSatisfied } from '@/core/local-install-guard'
import { pkg } from '@/core/package-data'
import { isExecutableOnPath, printMissingGlobalBinaryWarning, resolveOnPath } from '@/core/path-probe'

const TMP_BASE = join(import.meta.dirname, '../../.tmp-path-probe')

function makeTmp(suffix: string): string {
  const dir = join(TMP_BASE, suffix)
  mkdirSync(dir, { recursive: true })
  return dir
}

function cleanTmp(): void {
  rmSync(TMP_BASE, { recursive: true, force: true })
}

/** Writes a file and, on POSIX, marks it executable (0o755) or not (0o644). */
function writeBin(dir: string, name: string, executable: boolean): void {
  const p = join(dir, name)
  writeFileSync(p, '#!/bin/sh\n')
  chmodSync(p, executable ? 0o755 : 0o644)
}

/** Captures every console.error line emitted while `fn` runs. */
function captureStderr(fn: () => void): string[] {
  const original = console.error
  const lines: string[] = []
  console.error = (...args: unknown[]) => {
    lines.push(args.map((a) => String(a)).join(' '))
  }
  try {
    fn()
  } finally {
    console.error = original
  }
  return lines
}

// ─── Pure resolver — fully injected, no global state touched ────────────────
// These suites drive both platforms deterministically via injected params and
// never mutate process-wide state, so they are safe to run concurrently.

describe('resolveOnPath — POSIX', () => {
  test('resolves true when a PATH dir contains an executable `ahk`', () => {
    const dir = makeTmp('posix-present')
    writeBin(dir, 'ahk', true)
    assert.equal(resolveOnPath('ahk', { pathValue: dir, platform: 'linux' }), true)
    cleanTmp()
  })

  test('resolves false when no PATH dir contains `ahk`', () => {
    const dir = makeTmp('posix-absent')
    assert.equal(resolveOnPath('ahk', { pathValue: dir, platform: 'linux' }), false)
    cleanTmp()
  })

  test('resolves false when a file named `ahk` exists but is not executable', () => {
    const dir = makeTmp('posix-nonexec')
    writeBin(dir, 'ahk', false)
    assert.equal(resolveOnPath('ahk', { pathValue: dir, platform: 'darwin' }), false)
    cleanTmp()
  })

  test('splits PATH on `:` and finds `ahk` in a later directory', () => {
    const empty = makeTmp('posix-multi-empty')
    const real = makeTmp('posix-multi-real')
    writeBin(real, 'ahk', true)
    assert.equal(resolveOnPath('ahk', { pathValue: `${empty}:${real}`, platform: 'linux' }), true)
    cleanTmp()
  })
})

describe('resolveOnPath — win32', () => {
  test('resolves true when a PATH dir contains `ahk.cmd` and PATHEXT is set', () => {
    const dir = makeTmp('win-cmd')
    writeFileSync(join(dir, 'ahk.cmd'), '')
    assert.equal(
      resolveOnPath('ahk', { pathValue: dir, pathext: '.COM;.EXE;.BAT;.CMD;.PS1', platform: 'win32' }),
      true
    )
    cleanTmp()
  })

  test('matches case-insensitively (dir has `AHK.CMD`, query is `ahk`)', () => {
    const dir = makeTmp('win-caseins')
    writeFileSync(join(dir, 'AHK.CMD'), '')
    assert.equal(resolveOnPath('ahk', { pathValue: dir, pathext: '.CMD', platform: 'win32' }), true)
    cleanTmp()
  })

  test('handles a bare name with no extension present on PATH', () => {
    const dir = makeTmp('win-bare')
    writeFileSync(join(dir, 'ahk'), '')
    assert.equal(resolveOnPath('ahk', { pathValue: dir, pathext: '.EXE;.CMD', platform: 'win32' }), true)
    cleanTmp()
  })

  test('falls back to a default PATHEXT list when PATHEXT is unset', () => {
    const dir = makeTmp('win-default-pathext')
    writeFileSync(join(dir, 'ahk.cmd'), '')
    assert.equal(resolveOnPath('ahk', { pathValue: dir, pathext: undefined, platform: 'win32' }), true)
    cleanTmp()
  })

  test('splits PATH on `;` on win32', () => {
    const empty = makeTmp('win-multi-empty')
    const real = makeTmp('win-multi-real')
    writeFileSync(join(real, 'ahk.cmd'), '')
    assert.equal(resolveOnPath('ahk', { pathValue: `${empty};${real}`, pathext: '.CMD', platform: 'win32' }), true)
    cleanTmp()
  })
})

describe('resolveOnPath — empty/undefined PATH', () => {
  test('returns false (no throw) when PATH is an empty string', () => {
    assert.doesNotThrow(() => resolveOnPath('ahk', { pathValue: '', platform: 'linux' }))
    assert.equal(resolveOnPath('ahk', { pathValue: '', platform: 'linux' }), false)
    assert.equal(resolveOnPath('ahk', { pathValue: '', platform: 'win32' }), false)
  })

  test('returns false (no throw) when PATH contains only empty segments', () => {
    assert.doesNotThrow(() => resolveOnPath('ahk', { pathValue: ':::', platform: 'linux' }))
    assert.equal(resolveOnPath('ahk', { pathValue: ':::', platform: 'linux' }), false)
    assert.equal(resolveOnPath('ahk', { pathValue: ';;;', platform: 'win32', pathext: '.CMD' }), false)
  })

  test('does not throw when a PATH dir does not exist', () => {
    assert.doesNotThrow(() =>
      resolveOnPath('ahk', { pathValue: join(TMP_BASE, 'does-not-exist'), platform: 'win32', pathext: '.CMD' })
    )
    assert.equal(resolveOnPath('ahk', { pathValue: join(TMP_BASE, 'does-not-exist'), platform: 'linux' }), false)
  })
})

// ─── Real-environment behavior ──────────────────────────────────────────────
// isExecutableOnPath reads the real process.env.PATH, the warning captures
// console.error / process.exit, and the hook-decision tests do both. All of
// these mutate process-wide state, so they MUST run sequentially and be
// isolated in a single suite — otherwise a sibling suite's PATH/console.error
// save-restore window interleaves and corrupts this one. `concurrency: false`
// guarantees the subtests here run one at a time.

// Reproduces the exact preAction-hook decision (cli.ts) with the real
// functions and fixtures, to prove the warning is scoped correctly.
function runHookDecision(cwd: string): string[] {
  return captureStderr(() => {
    if (!isLocalInstallSatisfied(cwd)) {
      if (!isExecutableOnPath('ahk')) {
        printMissingGlobalBinaryWarning()
      }
    }
  })
}

describe('real process state (PATH / console.error / process.exit)', { concurrency: false }, () => {
  test('isExecutableOnPath: true when the real PATH has an executable `ahk`, false when not', () => {
    const dir = makeTmp('wrapper-env')
    writeBin(dir, 'ahk', true)
    const originalPath = process.env.PATH
    try {
      process.env.PATH = dir
      assert.equal(isExecutableOnPath('ahk'), true)
      process.env.PATH = makeTmp('wrapper-env-empty')
      assert.equal(isExecutableOnPath('ahk'), false)
    } finally {
      process.env.PATH = originalPath
    }
    cleanTmp()
  })

  test('isExecutableOnPath: returns false (no throw) when process.env.PATH is undefined', () => {
    const originalPath = process.env.PATH
    try {
      delete process.env.PATH
      assert.doesNotThrow(() => isExecutableOnPath('ahk'))
      assert.equal(isExecutableOnPath('ahk'), false)
    } finally {
      process.env.PATH = originalPath
    }
  })

  test('printMissingGlobalBinaryWarning: names the exact global and local install commands', () => {
    const lines = captureStderr(() => printMissingGlobalBinaryWarning())
    const text = lines.join('\n')
    assert.ok(lines.length > 0, 'must emit at least one line')
    assert.ok(text.includes('PATH'), 'must mention PATH')
    assert.ok(text.includes(`npm i -g ${pkg.name}`), 'must name the global install command')
    assert.ok(text.includes(`npm install --save-dev ${pkg.name}`), 'must name the local install command')
  })

  test('printMissingGlobalBinaryWarning: never calls process.exit', () => {
    const originalExit = process.exit
    let exitCalled = false
    process.exit = ((..._args: unknown[]) => {
      exitCalled = true
      return undefined as never
    }) as typeof process.exit
    try {
      captureStderr(() => printMissingGlobalBinaryWarning())
      assert.equal(exitCalled, false, 'printMissingGlobalBinaryWarning() must never call process.exit')
    } finally {
      process.exit = originalExit
    }
  })

  test('hook scope: global install + `ahk` absent → warning emitted exactly once', () => {
    const project = makeTmp('scope-global-absent')
    writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'some-other-project' }))
    const originalPath = process.env.PATH
    try {
      process.env.PATH = makeTmp('scope-global-absent-emptypath')
      const lines = runHookDecision(project)
      const headers = lines.filter((l) => l.includes('was not found on your PATH'))
      assert.equal(headers.length, 1, 'exactly one warning per command')
    } finally {
      process.env.PATH = originalPath
    }
    cleanTmp()
  })

  test('hook scope: global install + `ahk` present → no warning', () => {
    const project = makeTmp('scope-global-present')
    writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'some-other-project' }))
    const binDir = makeTmp('scope-global-present-bin')
    writeBin(binDir, 'ahk', true)
    const originalPath = process.env.PATH
    try {
      process.env.PATH = binDir
      const lines = runHookDecision(project)
      assert.equal(lines.length, 0, 'no warning when ahk resolves on PATH')
    } finally {
      process.env.PATH = originalPath
    }
    cleanTmp()
  })

  test('hook scope: local install present → no warning even when `ahk` is absent from PATH', () => {
    const project = makeTmp('scope-local')
    const [scope, name] = pkg.name.split('/')
    mkdirSync(join(project, 'node_modules', scope, name), { recursive: true })
    const originalPath = process.env.PATH
    try {
      process.env.PATH = makeTmp('scope-local-emptypath')
      const lines = runHookDecision(project)
      assert.equal(lines.length, 0, 'local install must silence the probe entirely')
    } finally {
      process.env.PATH = originalPath
    }
    cleanTmp()
  })
})
