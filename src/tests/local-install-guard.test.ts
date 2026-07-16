import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'

import { isLocalInstallSatisfied, printLocalInstallWarning } from '@/core/local-install-guard'
import { pkg } from '@/core/package-data'

const TMP_BASE = join(import.meta.dirname, '../../.tmp-local-install-guard')

function makeTmp(suffix: string): string {
  const dir = join(TMP_BASE, suffix)
  mkdirSync(dir, { recursive: true })
  return dir
}

function cleanTmp(): void {
  rmSync(TMP_BASE, { recursive: true, force: true })
}

describe('isLocalInstallSatisfied', () => {
  test('returns true when package is present in local node_modules', () => {
    const dir = makeTmp('local-present')
    const [scope, name] = pkg.name.split('/')
    mkdirSync(join(dir, 'node_modules', scope, name), { recursive: true })
    assert.equal(isLocalInstallSatisfied(dir), true)
    cleanTmp()
  })

  test('returns false when node_modules entry is absent and cwd is not the package itself', () => {
    const dir = makeTmp('global-only')
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'some-other-project' }))
    assert.equal(isLocalInstallSatisfied(dir), false)
    cleanTmp()
  })

  test('returns false when there is no node_modules and no package.json at all', () => {
    const dir = makeTmp('no-pkg-no-modules')
    assert.equal(isLocalInstallSatisfied(dir), false)
    cleanTmp()
  })

  test('returns true when cwd IS the agent-harness-kit package itself (self-dev case)', () => {
    const dir = makeTmp('self-dev')
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: pkg.name }))
    assert.equal(isLocalInstallSatisfied(dir), true)
    cleanTmp()
  })

  test('ignores malformed package.json and falls back to node_modules check', () => {
    const dir = makeTmp('malformed-pkg')
    writeFileSync(join(dir, 'package.json'), '{ not valid json')
    assert.equal(isLocalInstallSatisfied(dir), false)
    cleanTmp()
  })

  test('returns true in Yarn Berry PnP mode when the package is declared as a dependency', () => {
    const dir = makeTmp('pnp-declared')
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'some-other-project', devDependencies: { [pkg.name]: '^1.0.0' } })
    )
    writeFileSync(join(dir, '.pnp.cjs'), '')
    // No node_modules directory at all — PnP intentionally never creates one.
    assert.equal(isLocalInstallSatisfied(dir), true)
    cleanTmp()
  })

  test('returns true in Yarn Berry PnP mode via .pnp.loader.mjs and dependencies field', () => {
    const dir = makeTmp('pnp-loader-mjs')
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'some-other-project', dependencies: { [pkg.name]: '^1.0.0' } })
    )
    writeFileSync(join(dir, '.pnp.loader.mjs'), '')
    assert.equal(isLocalInstallSatisfied(dir), true)
    cleanTmp()
  })

  test('returns false in PnP mode when the package is not declared as a dependency', () => {
    const dir = makeTmp('pnp-not-declared')
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'some-other-project' }))
    writeFileSync(join(dir, '.pnp.cjs'), '')
    assert.equal(isLocalInstallSatisfied(dir), false)
    cleanTmp()
  })
})

describe('guard never forces a non-zero exit by itself', () => {
  test('printLocalInstallWarning() never calls process.exit, regardless of isLocalInstallSatisfied() result', () => {
    const originalExit = process.exit
    let exitCalled = false
    process.exit = ((..._args: unknown[]) => {
      exitCalled = true
      return undefined as never
    }) as typeof process.exit
    try {
      const dir = makeTmp('exit-check-false')
      assert.equal(isLocalInstallSatisfied(dir), false)
      printLocalInstallWarning()
      assert.equal(exitCalled, false, 'printLocalInstallWarning() must never call process.exit')
      cleanTmp()

      const dir2 = makeTmp('exit-check-true')
      writeFileSync(join(dir2, 'package.json'), JSON.stringify({ name: pkg.name }))
      assert.equal(isLocalInstallSatisfied(dir2), true)
      printLocalInstallWarning()
      assert.equal(exitCalled, false, 'printLocalInstallWarning() must never call process.exit')
      cleanTmp()
    } finally {
      process.exit = originalExit
    }
  })
})
