import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, test } from 'node:test'

import { loadConfig } from '@/core/config'

const TMP = join(import.meta.dirname, '../../.tmp-config-test')

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true })
})

function writeRawConfig(dir: string, objectLiteral: string): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'agent-harness-kit.config.ts'), `export default ${objectLiteral}\n`, 'utf8')
}

// ─── applyDefaults() legacy-shape warn+normalize (task #56) ────────────────
//
// loadConfig() loads agent-harness-kit.config.ts via jiti.import() at
// runtime, which strips TS types entirely before the module is evaluated —
// so a config file on disk that still has scope:'global' + database.path +
// markdownFallback.path (the pre-task-#56 shape) gets ZERO compile-time
// protection. applyDefaults() must detect and normalize this at runtime,
// with a console.warn, rather than crashing or silently keeping the
// contradictory fields.

describe('loadConfig — legacy contradictory storage shape (scope=global + local-only path fields)', () => {
  test('warns and strips database.path + markdownFallback.path when scope=global', async () => {
    const dir = join(TMP, 'legacy-global-contradictory')
    writeRawConfig(
      dir,
      `{
  project: { name: 'legacy', description: 'legacy shape', docsPath: './docs' },
  provider: 'claude-code',
  agents: { lead: { instructionsPath: null }, explorer: { instructionsPath: null }, builder: { instructionsPath: null }, reviewer: { instructionsPath: null }, custom: [] },
  database: { type: 'sqlite', path: '.harness/harness.db' },
  storage: {
    dir: '.harness',
    tasks: { adapter: 'local' },
    sections: { toolsUsed: true, filesModified: true, result: true, blockers: true, nextSteps: false },
    markdownFallback: { enabled: true, path: '.harness/current.md' },
    scope: 'global',
    projectId: 'legacy-contradictory-project',
  },
  health: { scriptPath: './health.sh', required: false },
  tools: { mcp: { enabled: false, port: 3456 }, scripts: { enabled: false, outputDir: '.harness/scripts' } },
}`,
    )

    const originalWarn = console.warn
    const warnings: string[] = []
    console.warn = (...args: unknown[]) => {
      warnings.push(args.join(' '))
    }

    let config
    try {
      config = await loadConfig(dir)
    } finally {
      console.warn = originalWarn
    }

    assert.ok(
      warnings.some((w) => w.includes('database.path') && w.includes('storage.scope') && w.includes('global')),
      `expected a warning about the legacy contradictory shape, got: ${JSON.stringify(warnings)}`,
    )
    assert.equal(config.storage.scope, 'global')
    assert.ok(!('path' in config.database), 'database.path must be stripped under scope=global')
    assert.ok(
      !('path' in config.storage.markdownFallback),
      'storage.markdownFallback.path must be stripped under scope=global',
    )
    // Non-contradictory fields must survive untouched.
    assert.equal(config.storage.projectId, 'legacy-contradictory-project')
    assert.equal(config.project.name, 'legacy')
  })

  test('does not warn when scope=local keeps database.path/markdownFallback.path (not contradictory)', async () => {
    const dir = join(TMP, 'local-non-contradictory')
    writeRawConfig(
      dir,
      `{
  project: { name: 'ok', description: 'fine', docsPath: './docs' },
  provider: 'claude-code',
  agents: { lead: { instructionsPath: null }, explorer: { instructionsPath: null }, builder: { instructionsPath: null }, reviewer: { instructionsPath: null }, custom: [] },
  database: { type: 'sqlite', path: '.harness/harness.db' },
  storage: {
    dir: '.harness',
    tasks: { adapter: 'local' },
    sections: { toolsUsed: true, filesModified: true, result: true, blockers: true, nextSteps: false },
    markdownFallback: { enabled: true, path: '.harness/current.md' },
    scope: 'local',
    projectId: 'ok-project',
  },
  health: { scriptPath: './health.sh', required: false },
  tools: { mcp: { enabled: false, port: 3456 }, scripts: { enabled: false, outputDir: '.harness/scripts' } },
}`,
    )

    const originalWarn = console.warn
    const warnings: string[] = []
    console.warn = (...args: unknown[]) => {
      warnings.push(args.join(' '))
    }

    let config
    try {
      config = await loadConfig(dir)
    } finally {
      console.warn = originalWarn
    }

    assert.equal(warnings.length, 0, `expected no warnings for a valid scope=local config, got: ${JSON.stringify(warnings)}`)
    assert.equal(config.storage.scope, 'local')
  })

  test('scope=global without the legacy fields loads cleanly, no warning', async () => {
    const dir = join(TMP, 'clean-global')
    writeRawConfig(
      dir,
      `{
  project: { name: 'clean', description: 'clean global shape', docsPath: './docs' },
  provider: 'claude-code',
  agents: { lead: { instructionsPath: null }, explorer: { instructionsPath: null }, builder: { instructionsPath: null }, reviewer: { instructionsPath: null }, custom: [] },
  database: { type: 'sqlite' },
  storage: {
    dir: '.harness',
    tasks: { adapter: 'local' },
    sections: { toolsUsed: true, filesModified: true, result: true, blockers: true, nextSteps: false },
    markdownFallback: { enabled: true },
    scope: 'global',
    projectId: 'clean-global-project',
  },
  health: { scriptPath: './health.sh', required: false },
  tools: { mcp: { enabled: false, port: 3456 }, scripts: { enabled: false, outputDir: '.harness/scripts' } },
}`,
    )

    const originalWarn = console.warn
    const warnings: string[] = []
    console.warn = (...args: unknown[]) => {
      warnings.push(args.join(' '))
    }

    let config
    try {
      config = await loadConfig(dir)
    } finally {
      console.warn = originalWarn
    }

    assert.equal(warnings.length, 0)
    assert.equal(config.storage.scope, 'global')
  })
})
