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

// ─── applyDefaults() removed agent path fields (task #59) ──────────────────
//
// `allowedPaths` / `writablePaths` were deleted from AgentConfig: they were
// interpolated into agent prompts as descriptive text and no provider ever
// enforced them per-agent, so they read as a security control without being
// one. The real per-role restriction is per-tool, in the generated agent files.
//
// Deleting them from the TS interface is a breaking change to the config
// shape, and — exactly as with the legacy storage shape above — gives ZERO
// runtime protection, because loadConfig() goes through jiti.import(), which
// strips types before evaluation. An existing user config still declaring the
// fields must load, not crash, with a non-blocking warning.

function captureWarnings(fn: () => Promise<unknown>): Promise<{ warnings: string[]; value: unknown }> {
  const originalWarn = console.warn
  const warnings: string[] = []
  console.warn = (...args: unknown[]) => {
    warnings.push(args.join(' '))
  }
  return fn()
    .then((value) => ({ warnings, value }))
    .finally(() => {
      console.warn = originalWarn
    })
}

/* Successor to `loadConfig — removed per-agent path fields`. That suite fixed
 * the guarantee that a config declaring `agents.*.allowedPaths` /
 * `writablePaths` loads without crashing. Removing the whole `agents` key
 * subsumes it: those fields are now dropped because their container is. The
 * guarantee is kept alive here rather than deleted — the fixtures still declare
 * the old path fields on purpose, so the same legacy config that motivated the
 * original suite is still exercised end to end. */
describe('loadConfig — removed `agents` key', () => {
  test('warns and drops the agents key, without crashing', async () => {
    const dir = join(TMP, 'legacy-agent-paths')
    writeRawConfig(
      dir,
      `{
  project: { name: 'legacy-paths', description: 'pre-#59 agent shape', docsPath: './docs' },
  provider: 'claude-code',
  agents: {
    lead: { instructionsPath: null },
    explorer: { instructionsPath: null, allowedPaths: ['./docs', './src'] },
    builder: { instructionsPath: null, writablePaths: ['./src', './tests'] },
    reviewer: { instructionsPath: null },
    custom: [],
  },
  database: { type: 'sqlite' },
  storage: {
    dir: '.harness',
    tasks: { adapter: 'local' },
    sections: { toolsUsed: true, filesModified: true, result: true, blockers: true, nextSteps: false },
    markdownFallback: { enabled: true, path: '.harness/current.md' },
    scope: 'local',
    projectId: 'legacy-agent-paths-project',
  },
  health: { scriptPath: './health.sh', required: false },
  tools: { mcp: { enabled: false, port: 3456 }, scripts: { enabled: false, outputDir: '.harness/scripts' } },
}`,
    )

    const { warnings, value } = await captureWarnings(() => loadConfig(dir))
    const config = value as Awaited<ReturnType<typeof loadConfig>>

    // The warning must name the offending key and say it no longer applies.
    assert.ok(
      warnings.some((w) => w.includes("'agents'") && w.includes('no longer')),
      `expected a warning naming the removed key, got: ${JSON.stringify(warnings)}`,
    )
    // It must say where the settings moved to, so the warning is actionable
    // rather than just an alarm. Naming the file is the whole point: the model
    // and the role instructions are now edited there.
    assert.ok(
      warnings.some((w) => w.includes('model') && w.includes('.claude/agents/')),
      `warning must point at the agent file, got: ${JSON.stringify(warnings)}`,
    )
    assert.ok(
      warnings.some((w) => w.includes('--force')),
      `warning must mention how to regenerate agent files, got: ${JSON.stringify(warnings)}`,
    )

    // Non-blocking: the config loads and the key is gone entirely.
    assert.ok(!('agents' in config), 'the agents key must be dropped')

    // Everything else survives untouched.
    assert.equal(config.project.name, 'legacy-paths')
    assert.equal(config.storage.projectId, 'legacy-agent-paths-project')
  })

  /* Rewritten, not deleted. This test used to assert that `model` and `custom`
   * SURVIVED the per-field strip. With the whole key removed the assertion
   * inverts: nothing under `agents` survives. Keeping the test (and its
   * fixture, which still declares path fields on every role) is what preserves
   * the legacy-config coverage the previous suite established. */
  test('drops every role entry, including model overrides and custom', async () => {
    const dir = join(TMP, 'legacy-agent-paths-all-roles')
    writeRawConfig(
      dir,
      `{
  project: { name: 'all-roles', description: 'paths on every role', docsPath: './docs' },
  provider: 'claude-code',
  agents: {
    lead: { instructionsPath: null, allowedPaths: ['./**'], model: 'sonnet' },
    explorer: { instructionsPath: null, allowedPaths: ['./**'] },
    consultant: { instructionsPath: null, allowedPaths: ['./**'] },
    builder: { instructionsPath: null, allowedPaths: ['./**'], writablePaths: ['./**'] },
    reviewer: { instructionsPath: null, allowedPaths: ['./**'] },
    custom: [{ name: 'auditor', instructionsPath: './auditor.md' }],
  },
  database: { type: 'sqlite' },
  storage: {
    dir: '.harness',
    tasks: { adapter: 'local' },
    sections: { toolsUsed: true, filesModified: true, result: true, blockers: true, nextSteps: false },
    markdownFallback: { enabled: true, path: '.harness/current.md' },
    scope: 'local',
    projectId: 'all-roles-project',
  },
  health: { scriptPath: './health.sh', required: false },
  tools: { mcp: { enabled: false, port: 3456 }, scripts: { enabled: false, outputDir: '.harness/scripts' } },
}`,
    )

    const { warnings, value } = await captureWarnings(() => loadConfig(dir))
    const config = value as Awaited<ReturnType<typeof loadConfig>>
    const raw = config as unknown as Record<string, unknown>

    // The whole container is gone, so every role entry goes with it — the old
    // per-field strip is subsumed.
    assert.ok(!('agents' in raw), 'the agents key must be dropped')

    // ONE aggregated warning, no matter how many roles and fields were
    // declared. Five roles x two path fields would otherwise be ten lines of
    // noise for a single, one-line fix.
    assert.equal(warnings.length, 1, 'a single aggregated warning, not one per role/field')

    // The warning enumerates the roles it found, so the user can see the scope
    // of what was ignored.
    assert.ok(
      warnings[0].includes('agents.lead') && warnings[0].includes('agents.custom'),
      `warning must enumerate the declared roles, got: ${warnings[0]}`,
    )

    // INVERTED vs. the previous suite: `model` no longer survives. It is not
    // relocated silently either — it is the setting the warning tells the user
    // to move into the agent file's frontmatter.
    assert.ok(!('agents' in raw), 'model overrides must not be carried over')

    // Untouched config keys still load normally.
    assert.equal(config.project.name, 'all-roles')
    assert.equal(config.storage.projectId, 'all-roles-project')
  })

  test('does not warn for a config that never declared the key', async () => {
    const dir = join(TMP, 'clean-agent-paths')
    writeRawConfig(
      dir,
      `{
  project: { name: 'clean-agents', description: 'current shape — no agents key', docsPath: './docs' },
  provider: 'claude-code',
  database: { type: 'sqlite' },
  storage: {
    dir: '.harness',
    tasks: { adapter: 'local' },
    sections: { toolsUsed: true, filesModified: true, result: true, blockers: true, nextSteps: false },
    markdownFallback: { enabled: true, path: '.harness/current.md' },
    scope: 'local',
    projectId: 'clean-agents-project',
  },
  health: { scriptPath: './health.sh', required: false },
  tools: { mcp: { enabled: false, port: 3456 }, scripts: { enabled: false, outputDir: '.harness/scripts' } },
}`,
    )

    const { warnings } = await captureWarnings(() => loadConfig(dir))
    assert.equal(warnings.length, 0, `expected no warnings, got: ${JSON.stringify(warnings)}`)
  })
})
