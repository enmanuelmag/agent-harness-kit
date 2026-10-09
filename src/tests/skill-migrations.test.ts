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

import { renderDelegationGuidance } from '@/core/materializer/delegation-guidance'
import { writeSkills } from '@/core/materializer/scaffold-utils'
import {
  __runSkillMigrationRegistryForTests,
  CANONICAL_SKILLS,
  migrateSkills,
  reconcileCanonicalSkills,
} from '@/core/materializer/skill-migrations'
import { injectDelegationGuidance } from '@/core/materializer/templates'
import { pkg } from '@/core/package-data'

import type { Provider } from '@/types'

const roots: string[] = []
// Original v2.30.0 manifest, before provider guidance was injected.
const historicalManifest = `---
name: ahk-use-cases
description: Define or refine a feature, change, refactor, or user journey as an approved non-technical use-case specification.
---

## Purpose

Guide a lightweight, iterative product-discovery conversation. Do not choose a stack, library, API, architecture, or implementation plan.

Read [the discovery workflow](resources/discovery-workflow.md) before the conversation and [the use-case template](resources/use-case-template.md) before saving.

## Discovery

Ask one follow-up question at a time. Establish the user and their goal, current and desired flow, trigger, happy path, variants and failures, business rules, boundaries, exclusions, assumptions, risks, dependencies, priority, success signal, and observable acceptance criteria. Separate confirmed decisions from open questions and do not invent either.

## Save and iterate

After the required questions and project evidence produce a complete first synthesis, create or update a \`use-case\` draft through structured specification MCP tools. Use \`specs.list\` and \`specs.search\` to find related documents, \`specs.get\` for the selected specification, and \`specs.validate\` after every write. Keep the draft reviewable and editable through MCP; it becomes \`approved\` only after the user explicitly approves it.

If the user changes an approved use-case, explain the affected technical specifications, update the use-case, and let the MCP transition linked technical specs to \`needs-reconciliation\`. Keep the conversation iterative; later messages refine the same specification unless the user clearly starts another initiative.

## Handoff

Offer \`ahk-use-case-tech\` only when the use case is approved and the user asks for technical design. The saved body follows the template and covers problem and value, actors, scope and exclusions, current and desired flows, cases and edge cases, rules, dependencies and risks, assumptions/open decisions, acceptance criteria, and change log.
`
afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})
for (const [provider, dir] of [
  ['claude-code', '.claude/skills'],
  ['codex-cli', '.agents/skills'],
  ['cursor', '.cursor/skills'],
  ['grok-cli', '.grok/skills'],
  ['opencode', '.opencode/skills'],
] as const) {
  test(`recovers historic injected skills and current applied checkpoints for ${provider}`, () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ahk-skill-migration-'))
    roots.push(cwd)
    const guidance = renderDelegationGuidance(provider as Provider, 'coordination-skill')
    const original = injectDelegationGuidance(historicalManifest, guidance) + '\n'
    const root = join(cwd, dir)
    mkdirSync(join(root, 'ahk-use-cases/resources'), { recursive: true })
    writeFileSync(join(root, 'ahk-use-cases/SKILL.md'), original)
    writeFileSync(join(root, 'ahk-use-cases/resources/custom.md'), 'whole tree backup')
    mkdirSync(join(root, 'ahk-use-case-tech'), { recursive: true })
    writeFileSync(join(root, 'ahk-use-case-tech/SKILL.md'), 'modified retired content')
    mkdirSync(join(root, 'ahk-ask'), { recursive: true })
    writeFileSync(join(root, 'ahk-ask/SKILL.md'), 'modified canonical content')
    writeFileSync(join(root, 'ahk-ask/extra.md'), 'extra file')
    mkdirSync(join(root, 'ahk-foo'), { recursive: true })
    writeFileSync(join(root, 'ahk-foo/SKILL.md'), 'unknown generated-looking content')
    mkdirSync(join(cwd, '.harness'), { recursive: true })
    const key = dir.replace(/[^a-z0-9]/gi, '_')
    writeFileSync(
      join(cwd, '.harness/skills-state.json'),
      JSON.stringify({
        roots: {
          [key]: {
            version: pkg.version,
            migrationVersion: pkg.version,
            applied: ['2.31.0-use-case-taxonomy'],
            pendingPreservation: [join(dir, 'ahk-use-cases'), join(dir, 'ahk-ask/SKILL.md')],
            inventory: { 'ahk-foo/SKILL.md': 'unknown generated-looking content' },
          },
        },
      })
    )
    const result = writeSkills(cwd, dir, guidance)
    assert.deepEqual(result.applied, [])
    assert.deepEqual(result.pendingPreservation, [])
    assert.equal(existsSync(join(root, 'ahk-use-cases')), false)
    assert.equal(existsSync(join(root, 'ahk-use-case-tech')), false)
    assert.ok(result.backupDir?.startsWith('.harness/backups/skills-'))
    assert.equal(
      readFileSync(join(cwd, result.backupDir!, 'ahk-use-cases/SKILL.md'), 'utf8'),
      original
    )
    assert.equal(
      readFileSync(join(cwd, result.backupDir!, 'ahk-use-cases/resources/custom.md'), 'utf8'),
      'whole tree backup'
    )
    assert.equal(
      readFileSync(join(cwd, result.backupDir!, 'ahk-ask/SKILL.md'), 'utf8'),
      'modified canonical content'
    )
    assert.equal(readFileSync(join(root, 'ahk-ask/extra.md'), 'utf8'), 'extra file')
    assert.equal(
      readFileSync(join(root, 'ahk-foo/SKILL.md'), 'utf8'),
      'unknown generated-looking content'
    )
    for (const name of CANONICAL_SKILLS) assert.ok(existsSync(join(root, name, 'SKILL.md')))
    const second = writeSkills(cwd, dir, guidance)
    assert.equal(second.backupDir, undefined)
    assert.deepEqual(second.applied, [])
  })
}

for (const invalidPath of [
  '../../outside.md',
  '..\\..\\outside.md',
  'ahk-ask/../extra.md',
  'C:\\outside.md',
])
  test(`rejects traversal inventory before touching reserved files: ${invalidPath}`, () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ahk-skill-migration-'))
    roots.push(cwd)
    const root = join(cwd, '.agents/skills')
    mkdirSync(join(root, 'ahk-ask'), { recursive: true })
    writeFileSync(join(root, 'ahk-ask/SKILL.md'), 'custom')
    assert.throws(
      () =>
        reconcileCanonicalSkills(
          cwd,
          '.agents/skills',
          join(process.cwd(), 'src/core/materializer/skills'),
          undefined,
          {
            roots: {
              _agents_skills: {
                version: pkg.version,
                applied: [],
                pendingPreservation: [],
                inventory: { [invalidPath]: 'x' },
              },
            },
          }
        ),
      /invalid skills inventory path/
    )
    assert.equal(readFileSync(join(root, 'ahk-ask/SKILL.md'), 'utf8'), 'custom')
  })

test('accepts legacy Windows inventory separators while preserving unknown names', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'ahk-skill-migration-'))
  roots.push(cwd)
  const root = join(cwd, '.agents/skills')
  mkdirSync(join(root, 'ahk-ask/obsolete'), { recursive: true })
  mkdirSync(join(root, 'ahk-foo'), { recursive: true })
  writeFileSync(join(root, 'ahk-ask/obsolete/old.md'), 'generated')
  writeFileSync(join(root, 'ahk-foo/SKILL.md'), 'unknown')
  reconcileCanonicalSkills(
    cwd,
    '.agents/skills',
    join(process.cwd(), 'src/core/materializer/skills'),
    undefined,
    {
      roots: {
        _agents_skills: {
          version: pkg.version,
          applied: [],
          pendingPreservation: [],
          inventory: { 'ahk-ask\\obsolete\\old.md': 'generated', 'ahk-foo\\SKILL.md': 'unknown' },
        },
      },
    }
  )
  assert.equal(existsSync(join(root, 'ahk-ask/obsolete/old.md')), false)
  assert.equal(readFileSync(join(root, 'ahk-foo/SKILL.md'), 'utf8'), 'unknown')
})

test('canonical symlink refuses retirement before any reserved tree is removed', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'ahk-skill-migration-'))
  roots.push(cwd)
  const root = join(cwd, '.agents/skills')
  mkdirSync(join(root, 'ahk-use-cases'), { recursive: true })
  mkdirSync(join(root, 'ahk-ask'), { recursive: true })
  writeFileSync(join(root, 'ahk-use-cases/SKILL.md'), 'old')
  symlinkSync(join(cwd, 'missing'), join(root, 'ahk-ask/extra.md'))
  assert.throws(() => writeSkills(cwd, '.agents/skills'), /symlinked/)
  assert.equal(readFileSync(join(root, 'ahk-use-cases/SKILL.md'), 'utf8'), 'old')
})

for (const path of ['ahk-use-cases/resources/broken.md', 'ahk-ask/extra.md']) {
  test(`refuses broken reserved symlinks without writing canonical content: ${path}`, () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ahk-skill-migration-'))
    roots.push(cwd)
    const root = join(cwd, '.agents/skills')
    mkdirSync(join(root, path, '..'), { recursive: true })
    symlinkSync(join(cwd, 'missing'), join(root, path))
    assert.throws(() => writeSkills(cwd, '.agents/skills'), /symlinked/)
    assert.equal(existsSync(join(root, 'ahk-docs')), false)
  })
}

test('backup failure leaves changed canonical files untouched', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'ahk-skill-migration-'))
  roots.push(cwd)
  mkdirSync(join(cwd, '.agents/skills/ahk-ask'), { recursive: true })
  writeFileSync(join(cwd, '.agents/skills/ahk-ask/SKILL.md'), 'custom')
  mkdirSync(join(cwd, '.harness'))
  writeFileSync(join(cwd, '.harness/backups'), 'blocked directory')
  assert.throws(() => writeSkills(cwd, '.agents/skills'))
  assert.equal(readFileSync(join(cwd, '.agents/skills/ahk-ask/SKILL.md'), 'utf8'), 'custom')
})
test('migrates each provider root independently and backs up retired reserved names', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'ahk-skill-migration-'))
  roots.push(cwd)
  const claude = join(cwd, '.claude/skills/ahk-use-cases')
  mkdirSync(claude, { recursive: true })
  writeFileSync(join(claude, 'SKILL.md'), '---\nname: ahk-use-cases\n---\n')
  const first = migrateSkills(cwd, '.claude/skills', 'claude-code')
  assert.deepEqual(first.preserved, [])
  assert.equal(existsSync(claude), false)
  assert.equal(
    readFileSync(join(cwd, first.backupDir!, 'ahk-use-cases/SKILL.md'), 'utf8'),
    '---\nname: ahk-use-cases\n---\n'
  )
  const cursor = join(cwd, '.cursor/skills/ahk-use-case-tech')
  mkdirSync(cursor, { recursive: true })
  writeFileSync(join(cursor, 'SKILL.md'), 'custom skill')
  const second = migrateSkills(cwd, '.cursor/skills', 'cursor')
  assert.deepEqual(second.preserved, [])
  assert.equal(existsSync(cursor), false)
  assert.equal(
    readFileSync(join(cwd, second.backupDir!, 'ahk-use-case-tech/SKILL.md'), 'utf8'),
    'custom skill'
  )
  assert.notEqual(first.backupDir, second.backupDir)
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
  mkdirSync(join(root, 'ahk-ask/resources'), { recursive: true })
  writeFileSync(join(root, 'ahk-ask/resources/owned.md'), 'generated')
  writeFileSync(join(root, 'ahk-ask/resources/custom.md'), 'custom')
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
            'ahk-ask/resources/owned.md': 'generated',
          },
        },
      },
    }
  )
  assert.equal(existsSync(join(root, 'ahk-ask/resources/owned.md')), false)
  assert.equal(readFileSync(join(root, 'ahk-ask/resources/custom.md'), 'utf8'), 'custom')
  assert.equal(
    result.pendingPreservation.includes('.agents/skills/ahk-ask/resources/custom.md'),
    false
  )
})

test('removes an empty stale generated resource directory', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'ahk-skill-migration-'))
  roots.push(cwd)
  const root = join(cwd, '.agents/skills')
  mkdirSync(join(root, 'ahk-ask/obsolete'), { recursive: true })
  writeFileSync(join(root, 'ahk-ask/obsolete/owned.md'), 'generated')
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
          inventory: { 'ahk-ask/obsolete/owned.md': 'generated' },
        },
      },
    }
  )
  assert.equal(existsSync(join(root, 'ahk-ask/obsolete')), false)
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

test('upgrades old feature and fix handoffs and backs up edited manifests', () => {
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
  const result = reconcileCanonicalSkills(cwd, '.agents/skills', source)
  assert.match(readFileSync(join(root, 'ahk-feature/SKILL.md'), 'utf8'), /ahk-spec-tech/)
  assert.doesNotMatch(readFileSync(join(root, 'ahk-fix/SKILL.md'), 'utf8'), /custom/)
  assert.match(readFileSync(join(cwd, result.backupDir!, 'ahk-fix/SKILL.md'), 'utf8'), /custom/)
})

test('preflights missing canonical sources before touching installed content and retries', () => {
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
  assert.equal(existsSync(join(root, first, 'SKILL.md')), false)
  assert.equal(existsSync(join(cwd, '.harness/skills-state.json')), false)

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
