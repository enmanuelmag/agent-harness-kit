/* eslint-disable @typescript-eslint/no-unused-vars */
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
  database: { type: 'sqlite' },
  storage: {
    dir: '.harness',
    sections: {
      toolsUsed: true,
      filesModified: true,
      result: true,
      blockers: true,
      nextSteps: false,
    },
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
