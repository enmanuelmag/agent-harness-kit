import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, test } from 'node:test'

import { applyConfigDefaults } from '@/commands/init-helpers'
import { getMaterializer } from '@/core/materializer/index'

import type { Provider } from '@/types'

// ─── Config-derived files are provenance-reconciled ──────────────────────────
//
// AGENTS.md (all three providers) and CLAUDE.md (claude-code only) are DERIVED
// FROM CONFIG. `ahk build` must keep propagating config changes into them AND
// never silently destroy a hand-edit. That is resolved with a trailing
// provenance marker holding the sha256 of the exact body bytes:
//
//   - untouched-since-we-wrote-it + config changed → PROPAGATE (auto-overwrite)
//   - hand-edited (marker hash mismatch) or markerless → PRESERVE (report it)
//   - --force → back up first, then regenerate
//
// These tests are the gap the explorer found: ZERO tests asserted these files
// survive a build or that config still reaches them.

const TMP = join(import.meta.dirname, '../../.tmp-derived-ownership')

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true })
})

function makeTmp(name: string): string {
  const dir = join(TMP, name)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  return dir
}

function configFor(provider: Provider, name = 'demo-app') {
  return applyConfigDefaults({
    name,
    description: 'demo',
    provider,
    docsPath: './docs',
    tasksAdapter: 'local',
  })
}

const MARKER_RE = /\n<!-- ahk:generated [0-9a-f]{64} -->\n$/

/** The config-derived files each provider owns. CLAUDE.md is claude-code only. */
const PROVIDERS: { provider: Provider; files: string[] }[] = [
  { provider: 'claude-code', files: ['AGENTS.md', 'CLAUDE.md'] },
  { provider: 'opencode', files: ['AGENTS.md'] },
  { provider: 'codex-cli', files: ['AGENTS.md'] },
]

for (const { provider, files } of PROVIDERS) {
  describe(`build — config-derived files are provenance-reconciled (${provider})`, () => {
    test('creates the derived files with a provenance marker', async () => {
      const cwd = makeTmp(`${provider}-create`)
      const report = await getMaterializer(provider).build(configFor(provider), cwd)

      for (const file of files) {
        const abs = join(cwd, file)
        assert.ok(existsSync(abs), `${file} should have been created`)
        assert.match(readFileSync(abs, 'utf8'), MARKER_RE, `${file} must carry a trailing marker`)
        assert.ok(report.derived.created.includes(file), `${file} should be reported created`)
      }
      assert.equal(report.derived.preserved.length, 0)
    })

    test('a second build over an unmodified generated file is a no-op (current)', async () => {
      const cwd = makeTmp(`${provider}-current`)
      const materializer = getMaterializer(provider)
      await materializer.build(configFor(provider), cwd)

      const before = files.map((f) => readFileSync(join(cwd, f), 'utf8'))
      const report = await materializer.build(configFor(provider), cwd)

      for (const [i, file] of files.entries()) {
        assert.equal(readFileSync(join(cwd, file), 'utf8'), before[i], `${file} must be byte-identical (idempotent)`)
        assert.ok(report.derived.current.includes(file), `${file} should be reported current`)
      }
      assert.equal(report.derived.created.length, 0)
      assert.equal(report.derived.propagated.length, 0)
      assert.equal(report.derived.preserved.length, 0)
    })

    test('a CONFIG CHANGE on an unmodified file propagates (does NOT freeze the file)', async () => {
      const cwd = makeTmp(`${provider}-propagate`)
      const materializer = getMaterializer(provider)
      await materializer.build(configFor(provider, 'demo-app'), cwd)

      const before = files.map((f) => readFileSync(join(cwd, f), 'utf8'))
      const report = await materializer.build(configFor(provider, 'renamed-app-xyz'), cwd)

      for (const [i, file] of files.entries()) {
        const after = readFileSync(join(cwd, file), 'utf8')
        assert.notEqual(after, before[i], `${file} must change when config changes`)
        assert.match(after, /renamed-app-xyz/, `${file} must contain the new config value`)
        assert.match(after, MARKER_RE, `${file} must be re-stamped with a fresh marker`)
        assert.ok(report.derived.propagated.includes(file), `${file} should be reported propagated`)
      }
      assert.equal(report.derived.preserved.length, 0, 'nothing may be preserved — the files were our own output')
    })

    test('a HAND-EDITED file is preserved untouched and reported', async () => {
      const cwd = makeTmp(`${provider}-preserve`)
      const materializer = getMaterializer(provider)
      await materializer.build(configFor(provider), cwd)

      // Human edits the file — even keeping our marker, the body no longer
      // matches the marker hash, so it must route to PRESERVE.
      const edited = 'MY HAND-WRITTEN NOTES — do not clobber\n'
      for (const file of files) writeFileSync(join(cwd, file), edited, 'utf8')

      const report = await materializer.build(configFor(provider), cwd)

      for (const file of files) {
        assert.equal(readFileSync(join(cwd, file), 'utf8'), edited, `${file} edit must survive the build`)
        assert.ok(report.derived.preserved.includes(file), `${file} should be reported preserved`)
      }
      assert.equal(report.derived.overwritten.length, 0, 'nothing may be overwritten without --force')
      assert.equal(report.derived.backupDir, undefined)
    })

    test('a MARKERLESS pre-existing file (first build after upgrade) is preserved', async () => {
      const cwd = makeTmp(`${provider}-markerless`)
      // Simulate a file written by an older version (this repo's own CLAUDE.md):
      // arbitrary content, no provenance marker.
      const legacy = '# Hand-authored before the marker existed\nkeep me\n'
      for (const file of files) writeFileSync(join(cwd, file), legacy, 'utf8')

      const report = await getMaterializer(provider).build(configFor(provider), cwd)

      for (const file of files) {
        assert.equal(readFileSync(join(cwd, file), 'utf8'), legacy, `${file} must be preserved on first upgrade build`)
        assert.ok(report.derived.preserved.includes(file), `${file} should be reported preserved`)
      }
      assert.equal(report.derived.overwritten.length, 0)
    })

    test('--force over a hand-edited file backs it up FIRST, then regenerates', async () => {
      const cwd = makeTmp(`${provider}-force`)
      const materializer = getMaterializer(provider)
      const config = configFor(provider)
      await materializer.build(config, cwd)

      const irreplaceable = 'IRREPLACEABLE HAND EDIT\n'
      for (const file of files) writeFileSync(join(cwd, file), irreplaceable, 'utf8')

      const report = await materializer.build(config, cwd, { force: true })

      assert.ok(report.derived.backupDir, '--force must report a backup directory')
      assert.ok(report.derived.backupDir!.includes('derived-'), 'backup dir must use the derived- prefix')
      for (const file of files) {
        const regenerated = readFileSync(join(cwd, file), 'utf8')
        assert.match(regenerated, MARKER_RE, `${file} must be re-stamped after --force`)
        assert.notEqual(regenerated, irreplaceable, `${file} must have been regenerated`)
        assert.ok(report.derived.overwritten.includes(file), `${file} should be reported overwritten`)

        const backedUp = join(report.derived.backupDir!, file)
        assert.ok(existsSync(backedUp), `${file} must exist in the backup`)
        assert.equal(readFileSync(backedUp, 'utf8'), irreplaceable, 'backup must hold the PREVIOUS content')
      }
    })

    test('a build without --force writes no derived backup', async () => {
      const cwd = makeTmp(`${provider}-nobackup`)
      const materializer = getMaterializer(provider)
      const config = configFor(provider)
      await materializer.build(config, cwd)
      writeFileSync(join(cwd, files[0]), 'EDIT\n', 'utf8')
      const report = await materializer.build(config, cwd)

      assert.equal(report.derived.backupDir, undefined)
    })

    test('build resolves under a non-interactive/no-TTY caller (never hangs)', async () => {
      // The design deliberately has NO prompt, so this is a smoke test: build()
      // must resolve deterministically with the same outcomes regardless of TTY.
      const cwd = makeTmp(`${provider}-noninteractive`)
      const report = await getMaterializer(provider).build(configFor(provider), cwd)
      assert.equal(report.derived.created.length, files.length)
    })
  })
}

describe('scaffold — freshly scaffolded derived files carry a marker', () => {
  for (const { provider, files } of PROVIDERS) {
    test(provider, async () => {
      const cwd = makeTmp(`${provider}-scaffold`)
      await getMaterializer(provider).scaffold(configFor(provider), { cwd })

      for (const file of files) {
        const content = readFileSync(join(cwd, file), 'utf8')
        assert.match(content, MARKER_RE, `${file} must be stamped by scaffold so the first build does not freeze it`)
      }

      // The very first build after scaffold must recognize the file as our own
      // output and no-op it — NOT preserve it as if it were human-edited.
      const report = await getMaterializer(provider).build(configFor(provider), cwd)
      for (const file of files) {
        assert.ok(report.derived.current.includes(file), `${file} must be 'current' on the first post-scaffold build`)
      }
      assert.equal(report.derived.preserved.length, 0, 'a scaffolded file must never look human-edited on first build')
    })
  }
})

describe('reconcile — derived backup is fail-safe', () => {
  test('--force aborts without touching the file when the backup cannot be written', async () => {
    const cwd = makeTmp('derived-backup-failure')
    const materializer = getMaterializer('claude-code')
    const config = configFor('claude-code')
    await materializer.build(config, cwd)

    const irreplaceable = 'IRREPLACEABLE\n'
    writeFileSync(join(cwd, 'AGENTS.md'), irreplaceable, 'utf8')
    writeFileSync(join(cwd, 'CLAUDE.md'), irreplaceable, 'utf8')

    // Make the backups root unwritable so the copy step fails.
    const backupsRoot = join(cwd, config.storage.dir, 'backups')
    mkdirSync(backupsRoot, { recursive: true })
    chmodSync(backupsRoot, 0o500)

    try {
      await assert.rejects(
        () => materializer.build(config, cwd, { force: true }),
        /Aborting WITHOUT overwriting anything/,
      )
      // The fail-safe guarantee: the destructive write never ran.
      assert.equal(readFileSync(join(cwd, 'AGENTS.md'), 'utf8'), irreplaceable)
      assert.equal(readFileSync(join(cwd, 'CLAUDE.md'), 'utf8'), irreplaceable)
    } finally {
      chmodSync(backupsRoot, 0o700)
    }
  })

  test('each --force run writes a DISTINCT derived backup directory', async () => {
    const cwd = makeTmp('derived-distinct-backups')
    const materializer = getMaterializer('claude-code')
    const config = configFor('claude-code')
    await materializer.build(config, cwd)

    writeFileSync(join(cwd, 'AGENTS.md'), 'EDIT ONE\n', 'utf8')
    const first = await materializer.build(config, cwd, { force: true })

    writeFileSync(join(cwd, 'AGENTS.md'), 'EDIT TWO\n', 'utf8')
    const second = await materializer.build(config, cwd, { force: true })

    assert.notEqual(first.derived.backupDir, second.derived.backupDir, 'a second --force must not clobber the first backup')
    const backupsRoot = join(cwd, config.storage.dir, 'backups')
    const derivedBackups = readdirSync(backupsRoot).filter((d) => d.startsWith('derived-'))
    assert.equal(derivedBackups.length, 2)
  })
})
