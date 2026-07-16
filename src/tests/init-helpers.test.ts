import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'

import { applyConfigDefaults, detectConfigExtension } from '@/commands/init-helpers'

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

// ─── storage scope + projectId (task #45) ─────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const baseParams = {
  name: 'demo',
  description: 'demo project',
  provider: 'claude-code' as const,
  docsPath: './docs',
  tasksAdapter: 'local',
}

describe('applyConfigDefaults — storage scope', () => {
  test('defaults to scope=local and generates a fresh UUID projectId when omitted', () => {
    const config = applyConfigDefaults(baseParams)
    assert.equal(config.storage.scope, 'local')
    assert.match(config.storage.projectId, UUID_RE)
  })

  test('scope=local applies explicitly', () => {
    const config = applyConfigDefaults({ ...baseParams, scope: 'local' })
    assert.equal(config.storage.scope, 'local')
  })

  test('scope=global applies and generates a UUID projectId (never a path hash)', () => {
    const config = applyConfigDefaults({ ...baseParams, scope: 'global' })
    assert.equal(config.storage.scope, 'global')
    assert.match(config.storage.projectId, UUID_RE)
  })

  test('returns a StorageConfig with both scope and projectId fields present', () => {
    const config = applyConfigDefaults(baseParams)
    assert.ok('scope' in config.storage)
    assert.ok('projectId' in config.storage)
  })

  test('two separate calls generate two different projectIds (never derived/reused implicitly)', () => {
    const a = applyConfigDefaults(baseParams)
    const b = applyConfigDefaults(baseParams)
    assert.notEqual(a.storage.projectId, b.storage.projectId)
  })

  test('reuses an explicitly provided projectId instead of regenerating', () => {
    const fixedId = 'fixed-project-id-123'
    const config = applyConfigDefaults({ ...baseParams, projectId: fixedId })
    assert.equal(config.storage.projectId, fixedId)
  })
})
