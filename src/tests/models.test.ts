import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, test } from 'node:test'

import { CODEX_MODEL_CHOICES } from '@/commands/codex-model-prompt'
import { applyConfigDefaults } from '@/commands/init-helpers'
import { resolveModelsContext } from '@/commands/models'
import { claudeAgentFiles } from '@/core/materializer/claude-code'
import { getMaterializer } from '@/core/materializer/index'

import type { BuildMaterializerOptions } from '@/core/materializer/index'
import type { Provider } from '@/types'

// ─── `ahk models` (task #79) ──────────────────────────────────────────────
//
// No test in this repo mocks `@clack/prompts` — every existing test exercises
// the pure logic underneath the interactive layer directly (see
// agent-file-ownership.test.ts, templates.test.ts). This suite follows the
// same strategy:
//   - `claudeAgentFiles` (now exported so `ahk models` can call it directly)
//     is tested with an explicit models map, bypassing the prompt entirely.
//   - `build()`'s new `claudeAgentModels` option (used by `ahk build --force`)
//     is tested at the materializer level, both with and without the option.
//   - `runModels`'s no-op/error branches are tested via `resolveModelsContext`,
//     a pure function extracted specifically so these paths are checkable
//     without touching the interactive prompt — mirrors the
//     `getDoctorStatus`/`runDoctor` split in doctor.ts.

const TMP = join(import.meta.dirname, '../../.tmp-models-command')

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true })
})

function makeTmp(name: string): string {
  const dir = join(TMP, name)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  return dir
}

function configFor(provider: Provider) {
  return applyConfigDefaults({
    name: 'demo-app',
    description: 'demo',
    provider,
    docsPath: './docs',
    tasksAdapter: 'mcp',
  })
}

/** Writes a real `agent-harness-kit.config.ts` so `loadConfig`/`resolveModelsContext`
 *  (which read from disk, not from an in-memory config object) have something
 *  to find. */
function writeRealConfig(dir: string, provider: Provider): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'agent-harness-kit.config.ts'),
    `export default ${JSON.stringify({
      provider,
      project: { name: 'demo-app', description: 'demo' },
    })}\n`,
    'utf8'
  )
}

describe('Codex model picker', () => {
  test('offers gpt-6-astra without changing the existing catalog order', () => {
    assert.deepEqual(CODEX_MODEL_CHOICES, [
      'gpt-6-astra',
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
      'gpt-5.5',
      'gpt-5.4',
      'gpt-5.4-mini',
      'gpt-5.3-codex-spark',
    ])
  })
})

describe('claudeAgentFiles — direct export used by ahk models', () => {
  test('injects the given per-role model map into frontmatter, per role, no cross-contamination', () => {
    const config = configFor('claude-code')
    const entries = claudeAgentFiles(config, { explorer: 'opus', reviewer: 'haiku' })

    const byPath = Object.fromEntries(entries.map((e) => [e.relPath, e.content]))

    assert.match(byPath['.claude/agents/explorer.md'], /^model: opus$/m)
    assert.match(byPath['.claude/agents/reviewer.md'], /^model: haiku$/m)
    assert.doesNotMatch(
      byPath['.claude/agents/lead.md'],
      /^model:/m,
      'lead was left unset — no model line'
    )
    assert.doesNotMatch(
      byPath['.claude/agents/builder.md'],
      /^model:/m,
      'builder was left unset — no model line'
    )
    assert.doesNotMatch(
      byPath['.claude/agents/consultant.md'],
      /^model:/m,
      'consultant was left unset — no model line'
    )
  })

  test('no models arg → no model line for any role (same as before extraction)', () => {
    const config = configFor('claude-code')
    const entries = claudeAgentFiles(config)
    for (const entry of entries) {
      assert.doesNotMatch(entry.content, /^model:/m)
    }
  })
})

describe('build() — claudeAgentModels option (backs `ahk build --force`)', () => {
  test('build() with claudeAgentModels injects a model line only for the roles given', async () => {
    const cwd = makeTmp('build-with-models')
    const materializer = getMaterializer('claude-code')
    const config = configFor('claude-code')

    await materializer.build(config, cwd)
    const report = await materializer.build(config, cwd, {
      force: true,
      claudeAgentModels: { builder: 'sonnet' },
    })

    assert.equal(report.agents.overwritten.length, 5)
    assert.match(readFileSync(join(cwd, '.claude/agents/builder.md'), 'utf8'), /^model: sonnet$/m)
    assert.doesNotMatch(
      readFileSync(join(cwd, '.claude/agents/lead.md'), 'utf8'),
      /^model:/m,
      'lead was left unset — no model line'
    )
  })

  test('build() without claudeAgentModels behaves exactly as before — no model line on any role', async () => {
    const cwd = makeTmp('build-without-models')
    const materializer = getMaterializer('claude-code')
    const config = configFor('claude-code')

    await materializer.build(config, cwd)
    const report = await materializer.build(config, cwd, { force: true })

    assert.equal(report.agents.overwritten.length, 5)
    for (const file of ['lead', 'explorer', 'consultant', 'builder', 'reviewer']) {
      assert.doesNotMatch(readFileSync(join(cwd, `.claude/agents/${file}.md`), 'utf8'), /^model:/m)
    }
  })

  test('a plain build (no --force) never reads claudeAgentModels even if one is passed', async () => {
    const cwd = makeTmp('build-no-force-with-models')
    const materializer = getMaterializer('claude-code')
    const config = configFor('claude-code')

    await materializer.build(config, cwd)
    // Simulate a caller accidentally passing claudeAgentModels without force —
    // existing agent files must stay untouched (force is what gates rewriting).
    const report = await materializer.build(config, cwd, { claudeAgentModels: { lead: 'opus' } })

    assert.equal(report.agents.overwritten.length, 0)
    assert.equal(report.agents.preserved.length, 5)
    assert.doesNotMatch(readFileSync(join(cwd, '.claude/agents/lead.md'), 'utf8'), /^model:/m)
  })

  test('other providers ignore the claudeAgentModels field entirely (purely additive option)', async () => {
    const cwd = makeTmp('opencode-with-models-field')
    const materializer = getMaterializer('opencode')
    const config = configFor('opencode')

    await materializer.build(config, cwd)
    const opts: BuildMaterializerOptions = { force: true, claudeAgentModels: { lead: 'opus' } }
    const report = await materializer.build(config, cwd, opts)

    assert.equal(report.agents.overwritten.length, 5)
    assert.doesNotMatch(readFileSync(join(cwd, '.opencode/agents/lead.md'), 'utf8'), /^model:/m)
  })
})

describe('ahk models — resolveModelsContext (no-op / error paths, no prompt involved)', () => {
  test('no config file found → ok:false, reason "no-config"', async () => {
    const cwd = makeTmp('models-no-config')
    const ctx = await resolveModelsContext(cwd)
    assert.deepEqual(ctx, { ok: false, reason: 'no-config' })
  })

  test('non-claude-code provider → ok:false, reason "not-claude-code", provider reported', async () => {
    const cwd = makeTmp('models-not-claude-code')
    writeRealConfig(cwd, 'opencode')

    const ctx = await resolveModelsContext(cwd)
    assert.equal(ctx.ok, false)
    assert.deepEqual(ctx, { ok: false, reason: 'not-claude-code', provider: 'opencode' })
  })

  test('claude-code provider → ok:true, config returned', async () => {
    const cwd = makeTmp('models-claude-code')
    writeRealConfig(cwd, 'claude-code')

    const ctx = await resolveModelsContext(cwd)
    assert.equal(ctx.ok, true)
    if (ctx.ok) {
      assert.equal(ctx.config.provider, 'claude-code')
    }
  })
})
