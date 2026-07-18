import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import type { GlobalStorageConfig, LocalStorageConfig, StorageConfig } from '@/types'

// ─── Compile-time narrowing checks (task #56) ───────────────────────────────
//
// These assertions exist purely for `tsc --noEmit` (run by `npm run build`,
// part of health.sh) — `npm run test` runs via tsx, which strips types
// without checking them, so nothing here executes meaningfully at runtime.
// A `@ts-expect-error` line that stops being an error (e.g. because the
// union was loosened back to a flat shape) makes `tsc` fail with "Unused
// '@ts-expect-error' directive", which is exactly the regression this file
// guards against.

const baseFields = {
  dir: '.harness',
  tasks: { adapter: 'local' as const },
  sections: { toolsUsed: true, filesModified: true, result: true, blockers: true, nextSteps: false },
  projectId: 'compile-time-check-project',
}

/** Illegal shapes — each MUST fail to compile under the new discriminated
 *  union, or `tsc --noEmit` reports "Unused '@ts-expect-error' directive". */
function illegalShapes(): void {
  // scope='global' must NOT accept a `sqlitePath` field.
  const globalWithSqlitePath: GlobalStorageConfig = {
    ...baseFields,
    scope: 'global',
    markdownFallback: { enabled: true },
    // @ts-expect-error — sqlitePath does not exist on GlobalStorageConfig
    sqlitePath: '.harness/harness.db',
  }

  // scope='global' must NOT accept `markdownFallback.path`.
  const globalWithMarkdownPath: GlobalStorageConfig = {
    ...baseFields,
    scope: 'global',
    // @ts-expect-error — markdownFallback.path does not exist on GlobalStorageConfig's markdownFallback
    markdownFallback: { enabled: true, path: '.harness/current.md' },
  }

  // scope='local' MUST require markdownFallback.path (omitting it is an error).
  const localMissingMarkdownPath: LocalStorageConfig = {
    ...baseFields,
    scope: 'local',
    // @ts-expect-error — markdownFallback.path is required on LocalStorageConfig
    markdownFallback: { enabled: true },
  }

  void globalWithSqlitePath
  void globalWithMarkdownPath
  void localMissingMarkdownPath
}
void illegalShapes

/** Legal shapes — must compile WITHOUT any `@ts-expect-error`. Returned so
 *  the runtime test below can assert on their shape too. */
function validShapes(): { local: LocalStorageConfig; localWithSqlitePath: LocalStorageConfig; global: GlobalStorageConfig } {
  const local: LocalStorageConfig = {
    ...baseFields,
    scope: 'local',
    markdownFallback: { enabled: true, path: '.harness/current.md' },
  }

  const localWithSqlitePath: LocalStorageConfig = {
    ...baseFields,
    scope: 'local',
    markdownFallback: { enabled: true, path: '.harness/current.md' },
    sqlitePath: '.harness/custom.db',
  }

  const global: GlobalStorageConfig = {
    ...baseFields,
    scope: 'global',
    markdownFallback: { enabled: true },
  }

  return { local, localWithSqlitePath, global }
}

/** A plain StorageConfig union narrows on `scope` before local-only fields
 *  (markdownFallback.path) become accessible — this is the actual
 *  runtime-shaped guarantee the discriminated union exists to provide. */
function markdownPathIfLocal(storage: StorageConfig): string | undefined {
  return storage.scope === 'local' ? storage.markdownFallback.path : undefined
}

describe('StorageConfig discriminated union — compile-time narrowing (task #56)', () => {
  test('valid local/global shapes construct correctly and narrow via scope', () => {
    const { local, localWithSqlitePath, global } = validShapes()

    assert.equal(markdownPathIfLocal(local), '.harness/current.md')
    assert.equal(markdownPathIfLocal(global), undefined)
    assert.equal(localWithSqlitePath.sqlitePath, '.harness/custom.db')
    assert.ok(!('path' in global.markdownFallback), 'GlobalStorageConfig.markdownFallback must never carry a path field')
  })
})
