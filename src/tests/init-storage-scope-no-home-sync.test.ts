/* eslint-disable @typescript-eslint/no-unused-vars */
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
