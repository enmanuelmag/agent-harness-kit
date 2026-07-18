import assert from 'node:assert/strict'
import { mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, describe, test } from 'node:test'

import { resolveGlobalStorageDir, resolveSqlitePathForScope } from '@/core/db'

import type { HarnessConfig } from '@/types'

const TMP_SCOPE = join(import.meta.dirname, '../../.tmp-dashboard-scope-test')
const FAKE_HOME = join(TMP_SCOPE, 'fake-home')

const SQLITE_PATH = '.harness/harness.db'

const baseConfig: HarnessConfig = {
  project: { name: 'test', description: 'test project', docsPath: './docs' },
  provider: 'claude-code',
  agents: {
    lead: { instructionsPath: null },
    explorer: { instructionsPath: null, allowedPaths: [] },
    builder: { instructionsPath: null, writablePaths: [] },
    reviewer: { instructionsPath: null },
    custom: [],
  },
  database: { type: 'sqlite' },
  storage: {
    dir: '.harness',
    tasks: { adapter: 'local' },
    sections: { toolsUsed: true, filesModified: true, result: true, blockers: true, nextSteps: false },
    markdownFallback: { enabled: false, path: '.harness/current.md' },
    scope: 'local',
    projectId: 'dashboard-scope-test-id',
    sqlitePath: SQLITE_PATH,
  },
  health: { scriptPath: './health.sh', required: false },
  tools: {
    mcp: { enabled: false, port: 3456 },
    scripts: { enabled: false, outputDir: '.harness/scripts' },
  },
}

// ─── dashboard sqlite watch-path resolution (task #55) ────────────────────

describe('dashboard — sqlite watch path resolution', () => {
  afterEach(() => {
    rmSync(TMP_SCOPE, { recursive: true, force: true })
  })

  test('scope=local resolves watch path to project-relative .harness/harness.db (unchanged behavior)', () => {
    const projectDir = join(TMP_SCOPE, 'local-project')
    mkdirSync(projectDir, { recursive: true })

    const localConfig: HarnessConfig = {
      ...baseConfig,
      storage: {
        dir: baseConfig.storage.dir,
        tasks: baseConfig.storage.tasks,
        sections: baseConfig.storage.sections,
        markdownFallback: { enabled: false, path: '.harness/current.md' },
        scope: 'local',
        projectId: baseConfig.storage.projectId,
        sqlitePath: SQLITE_PATH,
      },
    }
    const sqlitePath = SQLITE_PATH

    const dbPath = resolveSqlitePathForScope(localConfig.storage.scope, sqlitePath, projectDir, localConfig, FAKE_HOME)

    assert.equal(dbPath, resolve(projectDir, sqlitePath))
  })

  test('scope=global resolves watch path to ~/.harness/dbs/<projectId>/harness.db, matching openDB()', () => {
    const projectDir = join(TMP_SCOPE, 'global-project')
    mkdirSync(projectDir, { recursive: true })

    const globalConfig: HarnessConfig = {
      ...baseConfig,
      storage: {
        dir: baseConfig.storage.dir,
        tasks: baseConfig.storage.tasks,
        sections: baseConfig.storage.sections,
        markdownFallback: { enabled: false },
        scope: 'global',
        projectId: 'global-dashboard-project-uuid',
      },
    }
    const sqlitePath = SQLITE_PATH

    const dbPath = resolveSqlitePathForScope(globalConfig.storage.scope, sqlitePath, projectDir, globalConfig, FAKE_HOME)

    const expected = join(resolveGlobalStorageDir(globalConfig, FAKE_HOME), 'harness.db')
    assert.equal(dbPath, expected)
    assert.notEqual(dbPath, resolve(projectDir, sqlitePath))
  })
})
