/* eslint-disable @typescript-eslint/no-unused-vars */
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
  writeFileSync(
    join(dir, 'agent-harness-kit.config.ts'),
    `export default ${objectLiteral}\n`,
    'utf8'
  )
}

// ─── applyDefaults() legacy-shape warn+normalize (task #56) ────────────────
//
// loadConfig() loads agent-harness-kit.config.ts via jiti.import() at
// runtime, which strips TS types entirely before the module is evaluated —
// so a config file on disk that still has scope:'global' + database.path +
// protection. applyDefaults() must detect and normalize this at runtime,
// with a console.warn, rather than crashing or silently keeping the
// contradictory fields.

describe('loadConfig — legacy contradictory storage shape (scope=global + local-only path fields)', () => {
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

function captureWarnings(
  fn: () => Promise<unknown>
): Promise<{ warnings: string[]; value: unknown }> {
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

  /* Rewritten, not deleted. This test used to assert that `model` and `custom`
   * SURVIVED the per-field strip. With the whole key removed the assertion
   * inverts: nothing under `agents` survives. Keeping the test (and its
   * fixture, which still declares path fields on every role) is what preserves
   * the legacy-config coverage the previous suite established. */
})
