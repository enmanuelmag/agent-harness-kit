import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'

import { detectConfigExtension } from '@/commands/init-helpers'

const TMP_BASE = join(import.meta.dirname, '../../.tmp-init-helpers')

function makeTmp(suffix: string): string {
  const dir = join(TMP_BASE, suffix)
  mkdirSync(dir, { recursive: true })
  return dir
}

function cleanTmp(): void {
  rmSync(TMP_BASE, { recursive: true, force: true })
}

describe('detectConfigExtension', () => {
  test('returns ts when tsconfig.json exists', () => {
    const dir = makeTmp('ts')
    writeFileSync(join(dir, 'tsconfig.json'), '{}')
    assert.equal(detectConfigExtension(dir), 'ts')
    cleanTmp()
  })

  test('returns mjs when package.json has type module', () => {
    const dir = makeTmp('mjs')
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'module' }))
    assert.equal(detectConfigExtension(dir), 'mjs')
    cleanTmp()
  })

  test('returns mjs when no tsconfig.json and no package.json', () => {
    const dir = makeTmp('no-pkg')
    assert.equal(detectConfigExtension(dir), 'mjs')
    cleanTmp()
  })

  test('returns mjs when package.json exists but has no type field', () => {
    const dir = makeTmp('no-type')
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x' }))
    assert.equal(detectConfigExtension(dir), 'mjs')
    cleanTmp()
  })
})
