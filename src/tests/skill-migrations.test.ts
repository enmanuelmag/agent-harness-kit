import assert from 'node:assert/strict'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'

import {
  __runSkillMigrationRegistryForTests,
  CANONICAL_SKILLS,
  migrateSkills,
  reconcileCanonicalSkills,
} from '@/core/materializer/skill-migrations'
import { pkg } from '@/core/package-data'

const roots: string[] = []
afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})
test('migrates each provider root independently and preserves unknown legacy skills', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'ahk-skill-migration-'))
  roots.push(cwd)
  const claude = join(cwd, '.claude/skills/ahk-use-cases')
  mkdirSync(claude, { recursive: true })
  writeFileSync(join(claude, 'SKILL.md'), '---\nname: ahk-use-cases\n---\n')
  const first = migrateSkills(cwd, '.claude/skills', 'claude-code')
  assert.deepEqual(first.preserved, ['.claude/skills/ahk-use-cases'])
  assert.ok(existsSync(claude))
  const cursor = join(cwd, '.cursor/skills/ahk-use-case-tech')
  mkdirSync(cursor, { recursive: true })
  writeFileSync(join(cursor, 'SKILL.md'), 'custom skill')
  const second = migrateSkills(cwd, '.cursor/skills', 'cursor')
  assert.deepEqual(second.preserved, ['.cursor/skills/ahk-use-case-tech'])
  assert.ok(existsSync(cursor))
  const state = readFileSync(join(cwd, '.harness/skills-state.json'), 'utf8')
  assert.match(state, /_claude_skills/)
  assert.match(state, /_cursor_skills/)
})

test('runs versioned migrations in order and resumes after a later failure', () => {
  const applied: string[] = []
  const calls: string[] = []
  const registry = [
    {
      id: '2.32',
      version: '2.32.0',
      run: () => {
        calls.push('2.32')
        throw new Error('interrupted')
      },
    },
    { id: '2.31', version: '2.31.0', run: () => calls.push('2.31') },
  ]
  assert.throws(
    () => __runSkillMigrationRegistryForTests(registry, applied, '2.32.0'),
    /interrupted/
  )
  assert.deepEqual(applied, ['2.31'])
  registry.find((migration) => migration.id === '2.32')!.run = () => calls.push('2.32-resumed')
  assert.deepEqual(__runSkillMigrationRegistryForTests(registry, applied, '2.32.0'), [
    '2.31',
    '2.32',
  ])
  assert.deepEqual(calls, ['2.31', '2.32', '2.32-resumed'])
})

test('refuses a symlinked skills root and never follows it', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'ahk-skill-migration-'))
  roots.push(cwd)
  mkdirSync(join(cwd, 'outside'))
  mkdirSync(join(cwd, '.agents'))
  symlinkSync(join(cwd, 'outside'), join(cwd, '.agents/skills'))
  assert.throws(() => migrateSkills(cwd, '.agents/skills', 'codex-cli'), /symlinked skills path/)
})

test('removes only stale files covered by the prior generated inventory', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'ahk-skill-migration-'))
  roots.push(cwd)
  const root = join(cwd, '.agents/skills')
  mkdirSync(join(root, 'retired/resources'), { recursive: true })
  writeFileSync(join(root, 'retired/resources/owned.md'), 'generated')
  writeFileSync(join(root, 'retired/resources/custom.md'), 'custom')
  const result = reconcileCanonicalSkills(
    cwd,
    '.agents/skills',
    join(process.cwd(), 'src/core/materializer/skills'),
    undefined,
    {
      roots: {
        _agents_skills: {
          version: '2.31.0',
          applied: [],
          pendingPreservation: [],
          inventory: {
            'retired/resources/owned.md': 'generated',
          },
        },
      },
    }
  )
  assert.equal(existsSync(join(root, 'retired/resources/owned.md')), false)
  assert.equal(readFileSync(join(root, 'retired/resources/custom.md'), 'utf8'), 'custom')
  assert.equal(result.pendingPreservation.includes('.agents/skills/retired/resources/custom.md'), false)
})

test('removes an empty stale generated resource directory', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'ahk-skill-migration-'))
  roots.push(cwd)
  const root = join(cwd, '.agents/skills')
  mkdirSync(join(root, 'retired/resources'), { recursive: true })
  writeFileSync(join(root, 'retired/resources/owned.md'), 'generated')
  reconcileCanonicalSkills(
    cwd,
    '.agents/skills',
    join(process.cwd(), 'src/core/materializer/skills'),
    undefined,
    {
      roots: {
        _agents_skills: {
          version: '2.31.0',
          applied: [],
          pendingPreservation: [],
          inventory: { 'retired/resources/owned.md': 'generated' },
        },
      },
    }
  )
  assert.equal(existsSync(join(root, 'retired')), false)
})

test('restores a missing ahk-docs resource from the canonical offline guide', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'ahk-skill-migration-'))
  roots.push(cwd)
  const source = join(process.cwd(), 'src/core/materializer/skills')
  const root = join(cwd, '.agents/skills')

  reconcileCanonicalSkills(cwd, '.agents/skills', source)
  const resource = join(root, 'ahk-docs/resources/mcp-and-lifecycle.md')
  const expected = readFileSync(join(source, 'ahk-docs/resources/mcp-and-lifecycle.md'), 'utf8')
  rmSync(resource)

  reconcileCanonicalSkills(cwd, '.agents/skills', source)
  assert.equal(readFileSync(resource, 'utf8'), expected)
})

test('upgrades known old feature and fix handoffs but preserves edited manifests', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'ahk-skill-migration-'))
  roots.push(cwd)
  const root = join(cwd, '.agents/skills')
  const source = join(process.cwd(), 'src/core/materializer/skills')
  for (const name of ['ahk-feature', 'ahk-fix']) {
    const destination = join(root, name, 'SKILL.md')
    mkdirSync(join(root, name), { recursive: true })
    const old = readFileSync(join(source, name, 'SKILL.md'), 'utf8').replace(
      'ahk-spec-tech',
      'ahk-use-case-tech'
    )
    writeFileSync(destination, name === 'ahk-fix' ? `${old}\n<!-- custom -->\n` : old)
  }
  reconcileCanonicalSkills(cwd, '.agents/skills', source)
  assert.match(readFileSync(join(root, 'ahk-feature/SKILL.md'), 'utf8'), /ahk-spec-tech/)
  assert.match(readFileSync(join(root, 'ahk-fix/SKILL.md'), 'utf8'), /custom/)
})

test('retries an interrupted canonical refresh without treating its first write as custom', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'ahk-skill-migration-'))
  roots.push(cwd)
  const root = join(cwd, '.agents/skills')
  const source = join(cwd, 'canonical-source')
  const installed = join(process.cwd(), 'src/core/materializer/skills')
  const first = CANONICAL_SKILLS[0]
  mkdirSync(join(source, first), { recursive: true })
  cpSync(join(installed, first, 'SKILL.md'), join(source, first, 'SKILL.md'))
  const state = {
    roots: {
      _agents_skills: {
        version: '2.30.0',
        migrationVersion: '2.31.0',
        applied: ['2.31.0-use-case-taxonomy'],
        pendingPreservation: [],
        // A nonempty inventory ensures this is not merely the markerless
        // legacy-adoption path: the pending checkpoint owns the partial write.
        inventory: { 'retired/SKILL.md': 'prior generated content' },
      },
    },
  }
  assert.throws(
    () => reconcileCanonicalSkills(cwd, '.agents/skills', source, undefined, state),
    new RegExp(`canonical skill '${CANONICAL_SKILLS[1]}' is missing`)
  )
  assert.equal(readFileSync(join(root, first, 'SKILL.md'), 'utf8'), readFileSync(join(installed, first, 'SKILL.md'), 'utf8'))
  const interrupted = JSON.parse(readFileSync(join(cwd, '.harness/skills-state.json'), 'utf8'))
  assert.equal(interrupted.roots._agents_skills.version, '2.30.0')
  assert.equal(
    interrupted.roots._agents_skills.pendingInventory[`${first}/SKILL.md`],
    readFileSync(join(installed, first, 'SKILL.md'), 'utf8')
  )

  cpSync(installed, source, { recursive: true })
  const retried = reconcileCanonicalSkills(cwd, '.agents/skills', source)
  assert.deepEqual(retried.pendingPreservation, [])
  const complete = JSON.parse(readFileSync(join(cwd, '.harness/skills-state.json'), 'utf8'))
  assert.equal(complete.roots._agents_skills.version, pkg.version)
  assert.equal(complete.roots._agents_skills.pendingInventory, undefined)
  assert.equal(
    readFileSync(join(root, first, 'SKILL.md'), 'utf8'),
    readFileSync(join(installed, first, 'SKILL.md'), 'utf8')
  )
})
