import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, test } from 'node:test'

import { reconcileFeatureList } from '@/commands/init'
import { applyConfigDefaults } from '@/commands/init-helpers'
import { type HarnessDB, openDB } from '@/core/db'
import { getMaterializer } from '@/core/materializer/index'

// ─── Regression tests for task #62 ─────────────────────────────────────────
// `ahk init` used to write feature_list.json unconditionally from the three
// materializer scaffolds — clobbering a hand-written backlog and writing `[]`
// when the first-task prompt was skipped. The fix moves ownership of the file
// into `runInit`, which MERGES via the DB round-trip (syncFromFeatureList →
// writeFeatureList) so nothing is ever destroyed. These tests exercise
// `reconcileFeatureList`, the extracted core of that behavior, plus a
// path-regression guard that the claude-code scaffold no longer writes the
// file to the project ROOT.

const TMP_ROOT = join(import.meta.dirname, '../../.tmp-feature-list')

function makeConfig() {
  return applyConfigDefaults({
    name: 'demo-app',
    description: 'demo',
    provider: 'claude-code',
    docsPath: './docs',
    tasksAdapter: 'local',
    scope: 'local',
  })
}

async function setup(suffix: string): Promise<{
  installDir: string
  db: HarnessDB
  storageDir: string
  featureListPath: string
  rootPath: string
}> {
  const installDir = join(TMP_ROOT, suffix)
  const config = makeConfig()
  mkdirSync(join(installDir, config.storage.dir), { recursive: true })
  const db = await openDB(config, installDir)
  return {
    installDir,
    db,
    storageDir: config.storage.dir,
    featureListPath: join(installDir, config.storage.dir, 'feature_list.json'),
    rootPath: join(installDir, 'feature_list.json'),
  }
}

function readList(path: string): { slug: string; title: string }[] {
  return JSON.parse(readFileSync(path, 'utf8'))
}

describe('reconcileFeatureList (task #62 — never clobber the feature_list backlog)', () => {
  afterEach(() => {
    rmSync(TMP_ROOT, { recursive: true, force: true })
  })

  test('fresh init, file absent, no firstTask → creates .harness/feature_list.json as [] (never at project root)', async () => {
    const { installDir, db, storageDir, featureListPath, rootPath } = await setup('fresh-empty')

    const { parseFailed } = await reconcileFeatureList(db, installDir, storageDir)
    await db.close()

    assert.equal(parseFailed, false)
    assert.ok(existsSync(featureListPath), 'file must be created in .harness/')
    assert.ok(!existsSync(rootPath), 'file must NOT be created at the project root')
    assert.deepEqual(readList(featureListPath), [], 'fresh seed list is an empty array')
  })

  test('fresh init WITH firstTask → file contains exactly that one task', async () => {
    const { installDir, db, storageDir, featureListPath } = await setup('fresh-firsttask')

    await reconcileFeatureList(db, installDir, storageDir, {
      title: 'My First Task',
      description: 'do the thing',
      acceptance: ['it works'],
    })
    await db.close()

    const list = readList(featureListPath)
    assert.equal(list.length, 1)
    assert.equal(list[0].slug, 'my-first-task')
    assert.equal(list[0].title, 'My First Task')
  })

  test('init over an existing hand-written backlog, NO firstTask → backlog SURVIVES intact', async () => {
    const { installDir, db, storageDir, featureListPath } = await setup('backlog-survives')
    const backlog = [
      { slug: 'alpha', title: 'Alpha', acceptance: ['a done'] },
      { slug: 'beta', title: 'Beta', description: 'second', acceptance: ['b done'] },
    ]
    writeFileSync(featureListPath, JSON.stringify(backlog, null, 2) + '\n')

    await reconcileFeatureList(db, installDir, storageDir)
    await db.close()

    const list = readList(featureListPath)
    const slugs = list.map((t) => t.slug).sort()
    assert.deepEqual(slugs, ['alpha', 'beta'], 'every hand-written task must survive')
  })

  test('init over an existing backlog WITH a new firstTask → backlog preserved AND firstTask added exactly once', async () => {
    const { installDir, db, storageDir, featureListPath } = await setup('backlog-plus-firsttask')
    const backlog = [
      { slug: 'alpha', title: 'Alpha' },
      { slug: 'beta', title: 'Beta' },
    ]
    writeFileSync(featureListPath, JSON.stringify(backlog, null, 2) + '\n')

    await reconcileFeatureList(db, installDir, storageDir, { title: 'New Task', acceptance: [] })
    await db.close()

    const list = readList(featureListPath)
    const slugs = list.map((t) => t.slug).sort()
    assert.deepEqual(slugs, ['alpha', 'beta', 'new-task'])
    assert.equal(
      list.filter((t) => t.slug === 'new-task').length,
      1,
      'firstTask must be added exactly once, not doubled'
    )
  })

  test('duplicate-slug firstTask (already in backlog) → deduped, not doubled', async () => {
    const { installDir, db, storageDir, featureListPath } = await setup('dup-slug')
    const backlog = [{ slug: 'existing-feature', title: 'Existing Feature', acceptance: ['keep me'] }]
    writeFileSync(featureListPath, JSON.stringify(backlog, null, 2) + '\n')

    // firstTask title slugifies to the SAME slug already present.
    await reconcileFeatureList(db, installDir, storageDir, {
      title: 'Existing Feature',
      description: 'a duplicate',
      acceptance: ['different'],
    })
    await db.close()

    const list = readList(featureListPath)
    assert.equal(list.length, 1, 'duplicate slug must collapse to a single task')
    assert.equal(list[0].slug, 'existing-feature')
    // syncFromFeatureList skips duplicates, so the original backlog entry wins.
    assert.equal(list[0].title, 'Existing Feature')
  })

  test('malformed-JSON existing file → preserved byte-for-byte, no overwrite, no throw', async () => {
    const { installDir, db, storageDir, featureListPath, rootPath } = await setup('malformed')
    const broken = '{ this is not valid json ['
    writeFileSync(featureListPath, broken)

    const { parseFailed } = await reconcileFeatureList(db, installDir, storageDir)
    await db.close()

    assert.equal(parseFailed, true)
    assert.equal(readFileSync(featureListPath, 'utf8'), broken, 'malformed file must be left byte-for-byte intact')
    assert.ok(!existsSync(rootPath))
  })

  test('malformed-JSON existing file WITH firstTask → file still untouched, firstTask seeded into DB', async () => {
    const { installDir, db, storageDir, featureListPath } = await setup('malformed-firsttask')
    const broken = 'not json at all'
    writeFileSync(featureListPath, broken)

    const { parseFailed } = await reconcileFeatureList(db, installDir, storageDir, {
      title: 'Rescued Task',
      acceptance: [],
    })

    assert.equal(parseFailed, true)
    assert.equal(readFileSync(featureListPath, 'utf8'), broken, 'file must remain untouched even with a firstTask')
    const seeded = await db.getTaskBySlug('rescued-task')
    await db.close()
    assert.ok(seeded, 'a supplied firstTask must not be dropped just because the file is malformed')
  })

  test('claude-code path-regression guard: scaffold does not write feature_list.json to the project ROOT', async () => {
    const installDir = join(TMP_ROOT, 'path-guard')
    mkdirSync(installDir, { recursive: true })
    const config = makeConfig()
    const materializer = getMaterializer('claude-code')

    // The scaffold itself must NOT create feature_list.json anywhere anymore.
    await materializer.scaffold(config, {
      cwd: installDir,
      firstTask: { title: 'Seed', description: 'x', acceptance: [] },
    })
    assert.ok(
      !existsSync(join(installDir, 'feature_list.json')),
      'scaffold must not write feature_list.json to the project ROOT (the old claude-code bug)'
    )
    assert.ok(
      !existsSync(join(installDir, config.storage.dir, 'feature_list.json')),
      'scaffold no longer owns feature_list.json at all'
    )

    // Ownership belongs to the reconcile step, which always targets .harness/.
    const db = await openDB(config, installDir)
    await reconcileFeatureList(db, installDir, config.storage.dir, {
      title: 'Seed',
      description: 'x',
      acceptance: [],
    })
    await db.close()

    assert.ok(
      existsSync(join(installDir, config.storage.dir, 'feature_list.json')),
      'reconcile must write feature_list.json into .harness/'
    )
    assert.ok(
      !existsSync(join(installDir, 'feature_list.json')),
      'feature_list.json must never land at the project ROOT'
    )
  })
})
