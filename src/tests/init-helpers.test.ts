import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'

import { applyConfigDefaults, detectConfigExtension } from '@/commands/init-helpers'

const TMP_BASE = join(import.meta.dirname, '../../.tmp-init-helpers')

/**
 * Creates a temp project dir. `localInstall` defaults to true because a local
 * install is now the precondition for the ts/mjs/cjs detection to run at all —
 * without it every case short-circuits to 'json' and the detection under test
 * is never reached.
 */
function makeTmp(suffix: string, opts: { localInstall?: boolean } = {}): string {
  const dir = join(TMP_BASE, suffix)
  mkdirSync(dir, { recursive: true })
  if (opts.localInstall ?? true) {
    mkdirSync(join(dir, 'node_modules', '@cardor', 'agent-harness-kit'), { recursive: true })
  }
  return dir
}

function cleanTmp(): void {
  rmSync(TMP_BASE, { recursive: true, force: true })
}

describe('detectConfigExtension — package installed locally (existing detection)', () => {
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

  test('a declared-but-not-installed dependency is NOT a local install (no node_modules, no PnP)', () => {
    // Guards the boundary the whole feature rests on: declaring the package in
    // package.json without installing it leaves it unresolvable, so the editor
    // would still red-underline a .ts config. Only a real install counts.
    const dir = makeTmp('declared-only', { localInstall: false })
    writeFileSync(join(dir, 'tsconfig.json'), '{}')
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'x', devDependencies: { '@cardor/agent-harness-kit': '^1.0.0' } }),
    )
    assert.equal(detectConfigExtension(dir), 'json')
    cleanTmp()
  })
})

// ─── JSON config when the package is not installed locally (task #61) ─────────
//
// Precondition, checked before any project-type detection: with no local
// install the project cannot resolve '@cardor/agent-harness-kit', so a .ts
// config's `import type` red-underlines in the editor and fails `tsc --noEmit`
// on a package that isn't there. JSON has nothing to resolve.

describe('detectConfigExtension — package NOT installed locally', () => {
  test('returns json even when tsconfig.json exists (local install outranks TS detection)', () => {
    const dir = makeTmp('no-install-ts', { localInstall: false })
    writeFileSync(join(dir, 'tsconfig.json'), '{}')
    assert.equal(detectConfigExtension(dir), 'json')
    cleanTmp()
  })

  test('returns json even when package.json has type module', () => {
    const dir = makeTmp('no-install-mjs', { localInstall: false })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'module' }))
    assert.equal(detectConfigExtension(dir), 'json')
    cleanTmp()
  })

  test('returns json for a bare directory with neither tsconfig.json nor package.json', () => {
    const dir = makeTmp('no-install-bare', { localInstall: false })
    assert.equal(detectConfigExtension(dir), 'json')
    cleanTmp()
  })

  test('a Yarn Berry PnP project counts as installed and keeps the ts/mjs/cjs detection', () => {
    // PnP never creates node_modules, so the naive check fails there even
    // though the package IS resolvable — isLocalInstallSatisfied handles this,
    // and the format choice must inherit that, not re-derive it.
    const dir = makeTmp('pnp', { localInstall: false })
    writeFileSync(join(dir, '.pnp.cjs'), '')
    writeFileSync(join(dir, 'tsconfig.json'), '{}')
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'x', dependencies: { '@cardor/agent-harness-kit': '^1.0.0' } }),
    )
    assert.equal(detectConfigExtension(dir), 'ts')
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

  // ─── discriminated StorageConfig shape (task #56) ───────────────────────

  test('scope=local emits markdownFallback.path and no sqlitePath override by default', () => {
    const config = applyConfigDefaults({ ...baseParams, scope: 'local' })
    assert.equal(config.storage.scope, 'local')
    if (config.storage.scope === 'local') {
      assert.equal(config.storage.markdownFallback.path, '.harness/current.md')
      assert.equal(config.storage.sqlitePath, undefined)
    }
    assert.ok(!('path' in config.database), 'database.type=sqlite must never carry a path field')
  })

  test('scope=global omits markdownFallback.path entirely (not present, not empty string)', () => {
    const config = applyConfigDefaults({ ...baseParams, scope: 'global' })
    assert.equal(config.storage.scope, 'global')
    assert.ok(
      !('path' in config.storage.markdownFallback),
      'GlobalStorageConfig.markdownFallback must not declare a path field',
    )
    assert.ok(!('sqlitePath' in config.storage), 'GlobalStorageConfig must not declare a sqlitePath field')
    assert.ok(!('path' in config.database), 'database.type=sqlite must never carry a path field')
  })
})

// ─── the `agents` key is gone entirely ───────────────────────────────────────
//
// Successor to `applyConfigDefaults — no per-agent path fields`. That suite
// guarded the runtime twin of the generated config body in templates.ts against
// drift; the same pairing still has to be kept in step, only now the assertion
// is that NEITHER emits an `agents` key at all.

describe('applyConfigDefaults — no `agents` key', () => {
  test('the returned config declares no agents key', () => {
    const config = applyConfigDefaults(baseParams) as unknown as Record<string, unknown>
    assert.ok(!('agents' in config), 'applyConfigDefaults must not emit an agents key')
  })

  test('the removed per-agent fields cannot reappear under any key', () => {
    // Guards the whole surface rather than named roles: with the container
    // gone, a reintroduced `instructionsPath` / `model` / `allowedPaths`
    // anywhere in the config object means someone rebuilt the key by hand.
    const serialized = JSON.stringify(applyConfigDefaults(baseParams))
    for (const field of ['instructionsPath', 'allowedPaths', 'writablePaths', 'custom']) {
      assert.ok(!serialized.includes(field), `${field} must not appear in the config`)
    }
  })

  test('the rest of the config is unaffected', () => {
    const config = applyConfigDefaults(baseParams)
    assert.equal(config.provider, baseParams.provider)
    assert.equal(config.project.name, baseParams.name)
    assert.equal(config.storage.scope, 'local')
  })
})
