import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, test } from 'node:test'

import { applyConfigDefaults } from '@/commands/init-helpers'
import { openDB } from '@/core/db'
import { getMaterializer } from '@/core/materializer/index'

// ─── Regression test for task #51 ──────────────────────────────────────────
// Task #46 previously synced provider agent/skill files into the user's home
// directory whenever `storage.scope === 'global'`. Task #51 reverts that:
// agents/skills must ALWAYS live in the project tree, regardless of storage
// scope — only the DB location (and its current.md fallback) is affected by
// `storage.scope`. This test exercises the same scaffold + openDB sequence
// that `ahk init` runs (see src/commands/init.ts) with `scope: 'global'` and
// asserts that no file is ever created under the (fake) home directory
// except the DB storage dir itself (`~/.harness/dbs/<projectId>/...`).

const TMP_ROOT = join(import.meta.dirname, '../../.tmp-init-no-home-sync')

function makeTmpDirs(suffix: string): { installDir: string; fakeHome: string } {
  const installDir = join(TMP_ROOT, suffix, 'project')
  const fakeHome = join(TMP_ROOT, suffix, 'home')
  mkdirSync(installDir, { recursive: true })
  mkdirSync(fakeHome, { recursive: true })
  return { installDir, fakeHome }
}

describe('storage.scope=global never writes agent/skill files under the home dir (task #51 revert)', () => {
  afterEach(() => {
    rmSync(TMP_ROOT, { recursive: true, force: true })
  })

  test('claude-code: only ~/.harness/dbs/<projectId>/ is created under the fake home, never .claude/', async () => {
    const { installDir, fakeHome } = makeTmpDirs('claude-code')

    const config = applyConfigDefaults({
      name: 'demo-app',
      description: 'demo',
      provider: 'claude-code',
      docsPath: './docs',
      tasksAdapter: 'local',
      scope: 'global',
    })

    const materializer = getMaterializer('claude-code')
    await materializer.scaffold(config, { cwd: installDir })

    const db = await openDB(config, installDir, fakeHome)
    await db.writeStorageState(installDir)
    await db.close()

    // No provider agent/skill directories should ever appear under the fake home.
    assert.ok(!existsSync(join(fakeHome, '.claude', 'agents')), 'must not create ~/.claude/agents')
    assert.ok(!existsSync(join(fakeHome, '.claude', 'skills')), 'must not create ~/.claude/skills')
    assert.ok(!existsSync(join(fakeHome, '.codex')), 'must not create ~/.codex')
    assert.ok(!existsSync(join(fakeHome, '.config')), 'must not create ~/.config')
    assert.ok(!existsSync(join(fakeHome, '.agents')), 'must not create ~/.agents')

    // The DB storage dir (task #45 behavior) is the only thing expected under
    // the fake home when scope=global.
    assert.ok(existsSync(join(fakeHome, '.harness', 'dbs')), 'DB storage dir should still be created under home')

    // Provider agent/skill files must exist project-locally instead.
    assert.ok(existsSync(join(installDir, '.claude', 'agents', 'lead.md')), 'agents must be scaffolded project-locally')
    assert.ok(existsSync(join(installDir, '.claude', 'skills')), 'skills must be scaffolded project-locally')

    // Sanity: fake home only contains the expected .harness tree, nothing else.
    const homeEntries = readdirSync(fakeHome)
    assert.deepEqual(homeEntries.sort(), ['.harness'])
  })
})
