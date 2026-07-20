import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, test } from 'node:test'

import { applyConfigDefaults } from '@/commands/init-helpers'
import { getMaterializer } from '@/core/materializer/index'
import { writeAgentFiles } from '@/core/materializer/scaffold-utils'

import type { Provider } from '@/types'

// ─── Agent files are user-owned ──────────────────────────────────────────────
//
// The contract: `ahk build` CREATES agent files that are missing and NEVER
// modifies ones that exist. `--force` is the only way to regenerate them, and
// it backs up what it is about to destroy first.
//
// This used to be true of `scaffold()` in all three providers but of `build()`
// in only two: claude-code's `build()` carried its own unconditional write, so
// every `ahk build` silently reverted a user's edits. The duplication between
// scaffold and build (six sites) is what let that survive, which is why the
// write policy now lives in one helper and both paths call it.

const TMP = join(import.meta.dirname, '../../.tmp-agent-ownership')

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
    tasksAdapter: 'local',
  })
}

/** Every provider, with the agent files it owns. `default.toml` is included for
 *  codex-cli deliberately: it is a generated shim for Codex's built-in agent,
 *  but it is still an agent file the user may edit, so it follows the same
 *  ownership rule as the five roles. */
const PROVIDERS: { provider: Provider; dir: string; files: string[] }[] = [
  {
    provider: 'claude-code',
    dir: '.claude/agents',
    files: ['lead.md', 'explorer.md', 'consultant.md', 'builder.md', 'reviewer.md'],
  },
  {
    provider: 'opencode',
    dir: '.opencode/agents',
    files: ['lead.md', 'explorer.md', 'consultant.md', 'builder.md', 'reviewer.md'],
  },
  {
    provider: 'codex-cli',
    dir: '.codex/agents',
    files: ['lead.toml', 'explorer.toml', 'consultant.toml', 'builder.toml', 'reviewer.toml', 'default.toml'],
  },
]

for (const { provider, dir, files } of PROVIDERS) {
  describe(`build — agent files are user-owned (${provider})`, () => {
    test('creates agent files that are missing', async () => {
      const cwd = makeTmp(`${provider}-create`)
      const report = await getMaterializer(provider).build(configFor(provider), cwd)

      for (const file of files) {
        assert.ok(existsSync(join(cwd, dir, file)), `${file} should have been created`)
      }
      assert.equal(report.agents.created.length, files.length)
      assert.equal(report.agents.overwritten.length, 0)
    })

    test('a second build does NOT overwrite a hand-edited agent file', async () => {
      const cwd = makeTmp(`${provider}-preserve`)
      const materializer = getMaterializer(provider)
      await materializer.build(configFor(provider), cwd)

      // Simulate the user customizing their agent, the whole point of the task.
      const target = join(cwd, dir, files[0])
      const customized = 'MY OWN AGENT — hands off\n'
      writeFileSync(target, customized, 'utf8')

      const report = await materializer.build(configFor(provider), cwd)

      assert.equal(readFileSync(target, 'utf8'), customized, 'the edit must survive rebuild')
      assert.equal(report.agents.overwritten.length, 0, 'nothing may be overwritten without --force')
      assert.equal(report.agents.preserved.length, files.length)
    })

    test('build still creates a DELETED agent file while preserving the others', async () => {
      const cwd = makeTmp(`${provider}-partial`)
      const materializer = getMaterializer(provider)
      await materializer.build(configFor(provider), cwd)

      const kept = join(cwd, dir, files[0])
      writeFileSync(kept, 'CUSTOM\n', 'utf8')
      rmSync(join(cwd, dir, files[1]))

      const report = await materializer.build(configFor(provider), cwd)

      assert.deepEqual(report.agents.created, [`${dir}/${files[1]}`])
      assert.equal(readFileSync(kept, 'utf8'), 'CUSTOM\n')
    })

    test('--force regenerates a hand-edited agent file', async () => {
      const cwd = makeTmp(`${provider}-force`)
      const materializer = getMaterializer(provider)
      await materializer.build(configFor(provider), cwd)

      const target = join(cwd, dir, files[0])
      const pristine = readFileSync(target, 'utf8')
      writeFileSync(target, 'CUSTOM\n', 'utf8')

      const report = await materializer.build(configFor(provider), cwd, { force: true })

      assert.equal(readFileSync(target, 'utf8'), pristine, '--force must restore the template')
      assert.equal(report.agents.overwritten.length, files.length)
      assert.equal(report.agents.preserved.length, 0)
    })

    test('--force backs up the previous content BEFORE overwriting', async () => {
      const cwd = makeTmp(`${provider}-backup`)
      const materializer = getMaterializer(provider)
      const config = configFor(provider)
      await materializer.build(config, cwd)

      const target = join(cwd, dir, files[0])
      writeFileSync(target, 'IRREPLACEABLE\n', 'utf8')

      const report = await materializer.build(config, cwd, { force: true })

      assert.ok(report.agents.backupDir, '--force must report a backup directory')
      const backedUp = join(report.agents.backupDir!, dir, files[0])
      assert.ok(existsSync(backedUp), 'the overwritten file must exist in the backup')
      assert.equal(
        readFileSync(backedUp, 'utf8'),
        'IRREPLACEABLE\n',
        'the backup must hold the PREVIOUS content, not the regenerated one',
      )
    })

    test('a build without --force writes no backup', async () => {
      const cwd = makeTmp(`${provider}-nobackup`)
      const materializer = getMaterializer(provider)
      const config = configFor(provider)
      await materializer.build(config, cwd)
      const report = await materializer.build(config, cwd)

      assert.equal(report.agents.backupDir, undefined)
      assert.ok(
        !existsSync(join(cwd, config.storage.dir, 'backups')),
        'a non-destructive build must not create a backups directory',
      )
    })
  })
}

describe('build — no generated agent file carries a model line', () => {
  // The `agents.*.model` config was removed; the model is set by editing the
  // generated file. If the generator emitted a model line, --force would
  // silently revert that edit on every regeneration.
  for (const { provider, dir, files } of PROVIDERS) {
    test(provider, async () => {
      const cwd = makeTmp(`${provider}-nomodel`)
      await getMaterializer(provider).build(configFor(provider), cwd)

      for (const file of files) {
        const content = readFileSync(join(cwd, dir, file), 'utf8')
        assert.doesNotMatch(content, /^model:/m, `${file} must not declare a model: line`)
        assert.doesNotMatch(content, /^model\s*=/m, `${file} must not declare a model = line`)
      }
    })
  }
})

describe('writeAgentFiles — backup is fail-safe', () => {
  test('a backup failure aborts without modifying a single file', () => {
    const cwd = makeTmp('backup-failure')
    const relPath = '.claude/agents/lead.md'
    const original = 'ORIGINAL\n'
    mkdirSync(join(cwd, '.claude/agents'), { recursive: true })
    writeFileSync(join(cwd, relPath), original, 'utf8')

    // Make the backup root unwritable so the copy step fails.
    const backupRoot = join(cwd, 'readonly-backups')
    mkdirSync(backupRoot, { recursive: true })
    chmodSync(backupRoot, 0o500)

    try {
      assert.throws(
        () => writeAgentFiles(cwd, [{ relPath, content: 'REGENERATED\n' }], { force: true, backupRoot }),
        /Aborting WITHOUT overwriting anything/,
      )
      // The fail-safe guarantee: the destructive write never ran.
      assert.equal(readFileSync(join(cwd, relPath), 'utf8'), original)
    } finally {
      chmodSync(backupRoot, 0o700)
    }
  })

  test('force without a backupRoot refuses to overwrite', () => {
    const cwd = makeTmp('no-backup-root')
    const relPath = '.claude/agents/lead.md'
    mkdirSync(join(cwd, '.claude/agents'), { recursive: true })
    writeFileSync(join(cwd, relPath), 'ORIGINAL\n', 'utf8')

    assert.throws(
      () => writeAgentFiles(cwd, [{ relPath, content: 'REGENERATED\n' }], { force: true }),
      /Refusing to overwrite without a backup/,
    )
    assert.equal(readFileSync(join(cwd, relPath), 'utf8'), 'ORIGINAL\n')
  })

  test('force with no pre-existing files needs no backup and writes none', () => {
    const cwd = makeTmp('force-fresh')
    const result = writeAgentFiles(cwd, [{ relPath: '.claude/agents/lead.md', content: 'NEW\n' }], {
      force: true,
    })

    assert.deepEqual(result.created, ['.claude/agents/lead.md'])
    assert.equal(result.backupDir, undefined)
  })

  test('each --force run writes a distinct backup directory', async () => {
    const cwd = makeTmp('distinct-backups')
    const materializer = getMaterializer('claude-code')
    const config = configFor('claude-code')
    await materializer.build(config, cwd)

    const target = join(cwd, '.claude/agents/lead.md')
    writeFileSync(target, 'EDIT ONE\n', 'utf8')
    const first = await materializer.build(config, cwd, { force: true })

    writeFileSync(target, 'EDIT TWO\n', 'utf8')
    const second = await materializer.build(config, cwd, { force: true })

    assert.notEqual(first.agents.backupDir, second.agents.backupDir, 'a second --force must not clobber the first backup')
    const backupsRoot = join(cwd, config.storage.dir, 'backups')
    assert.equal(readdirSync(backupsRoot).length, 2)
  })
})
