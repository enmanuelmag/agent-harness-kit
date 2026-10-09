import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

import { pkg } from '@/core/package-data'

import { renderDelegationGuidance } from './delegation-guidance'
import { injectDelegationGuidance } from './templates'

import type { Provider } from '@/types'

export const CANONICAL_SKILLS = [
  'ahk-docs',
  'ahk-ask',
  'ahk-consultant',
  'ahk-triage',
  'ahk-review',
  'ahk-test',
  'ahk-use-case',
  'ahk-spec',
  'ahk-spec-tech',
  'ahk-feature',
  'ahk-fix',
] as const
const RETIRED_231 = ['ahk-use-cases', 'ahk-use-case-tech'] as const
const LEGACY_MANIFEST_SHA256: Record<string, string> = {
  'ahk-use-cases': 'ecf0c9c4cf8aee903c8a47dae3b1d8c643496494ed3ac9a9ced0f0b54e214148',
  'ahk-use-case-tech': '56633c36a95d2c56b9121204c7d24902a89dde4e4bd3a7016bf32ac1d05e9269',
}
const LEGACY_FILES: Record<string, Record<string, string>> = {
  'ahk-use-cases': {
    'resources/discovery-workflow.md':
      '# Discovery workflow\n\n1. Frame the actor, problem, current situation, and desired outcome.\n2. Define the main flow before alternatives, failures, rules, exclusions, risks, and dependencies.\n3. Separate confirmed decisions, assumptions, and open questions.\n4. Write observable acceptance criteria and review the summary with the user.\n5. Save only after approval.\n',
    'resources/use-case-template.md':
      '# Use-case template\n\n```md\n## Origin and initial request\n## Problem and value\n## Actors and project context evidence\n## Scope and exclusions\n## Current and desired flows\n## Main flow, alternatives, and failures\n## Rules, risks, and dependencies\n## Acceptance criteria\n## Confirmed decisions, assumptions, and open questions\n## Change log\n```\n',
  },
  'ahk-use-case-tech': {
    'resources/technical-workflow.md':
      '# Technical workflow\n\n1. Confirm the use-case, feature, or fix source is approved.\n2. Map current boundaries, contracts, data flow, and tests.\n3. Verify compatibility from installed versions and current primary documentation.\n4. Compare options, propose the design, and obtain approval before saving.\n',
    'resources/technical-template.md':
      '# Technical template\n\n```md\n## Source specification and scope\n## Origin and project context evidence\n## Current state and compatibility evidence\n## Options and recommended design\n## Boundaries, contracts, data, and failure handling\n## Dependencies, rollout, validation, risks, and phases\n## Confirmed decisions, assumptions, and open questions\n## Change log\n```\n',
  },
}
interface RootState {
  /** Version whose complete canonical inventory was materialized successfully. */
  version: string
  /** Latest migration checkpoint. It may be ahead of `version` after an interrupted refresh. */
  migrationVersion?: string
  provider?: string
  applied: string[]
  pendingPreservation: string[]
  /** Files written by an interrupted canonical refresh, before they join the durable inventory. */
  pendingInventory?: Record<string, string>
  inventory: Record<string, string>
}
interface SkillState {
  roots: Record<string, RootState>
}
export interface SkillMigrationResult {
  applied: string[]
  preserved: string[]
  backupDir?: string
  state?: SkillState
}
interface SkillMigration {
  id: string
  version: string
  run: (root: string, skillsDir: string, effective: RootState, result: SkillMigrationResult) => void
}
export interface TestSkillMigration {
  id: string
  version: string
  run: () => void
}
/** Pure registry runner used to prove future migrations remain ordered and resumable. */
export function __runSkillMigrationRegistryForTests(
  registry: TestSkillMigration[],
  applied: string[],
  target: string
): string[] {
  for (const migration of registry.sort((a, b) => compareVersion(a.version, b.version))) {
    if (compareVersion(migration.version, target) <= 0 && !applied.includes(migration.id)) {
      migration.run()
      applied.push(migration.id)
    }
  }
  return applied
}
const semver = (v: string) => v.split('.').map((x) => Number(x.replace(/[^0-9].*/, '')) || 0)
export function compareVersion(a: string, b: string) {
  const aa = semver(a),
    bb = semver(b)
  for (let i = 0; i < 3; i++)
    if ((aa[i] ?? 0) !== (bb[i] ?? 0)) return (aa[i] ?? 0) > (bb[i] ?? 0) ? 1 : -1
  return 0
}
function checkNoSymlink(path: string, label: string) {
  try {
    if (lstatSync(path).isSymbolicLink()) throw new Error(`refusing symlinked ${label}: ${path}`)
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('refusing symlinked')) throw error
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}
/** Check the project root and every existing component, including broken links. */
function assertNoSymlink(cwd: string, target: string, label = 'skills path') {
  const root = resolve(cwd)
  const absolute = resolve(target)
  const rel = relative(root, absolute)
  if (rel === '..' || rel.startsWith(`..${String.raw`/`}`))
    throw new Error(`refusing ${label} outside project root: ${absolute}`)
  let path = root
  checkNoSymlink(path, label)
  for (const segment of rel.split(/[\\/]/).filter(Boolean)) {
    path = join(path, segment)
    checkNoSymlink(path, label)
  }
}
function files(root: string, prefix = ''): string[] {
  assertNoSymlink(dirname(root), root)
  if (!existsSync(root)) return []
  return readdirSync(join(root, prefix), { withFileTypes: true }).flatMap((e) => {
    const p = join(prefix, e.name)
    const full = join(root, p)
    checkNoSymlink(full, 'skills path')
    return e.isDirectory() ? files(root, p) : [p]
  })
}
function statePath(cwd: string) {
  return join(cwd, '.harness', 'skills-state.json')
}
function load(cwd: string): SkillState | undefined {
  const p = statePath(cwd)
  assertNoSymlink(cwd, join(cwd, '.harness'), 'skills state directory')
  assertNoSymlink(cwd, p, 'skills state')
  if (!existsSync(p)) return
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8')) as SkillState | RootState
    return 'roots' in parsed ? parsed : { roots: { legacy: parsed as RootState } }
  } catch {
    throw new Error(`invalid skills migration state: ${p}`)
  }
}
function save(cwd: string, state: SkillState) {
  const p = statePath(cwd)
  const tmp = `${p}.${process.pid}.tmp`
  assertNoSymlink(cwd, join(cwd, '.harness'), 'skills state directory')
  assertNoSymlink(cwd, p, 'skills state')
  assertNoSymlink(cwd, tmp, 'skills state temporary file')
  mkdirSync(join(cwd, '.harness'), { recursive: true })
  writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', 'utf8')
  renameSync(tmp, p)
}
function removeKnownGuidance(manifest: string): string {
  const providers: Provider[] = ['claude-code', 'codex-cli', 'cursor', 'grok-cli', 'opencode']
  for (const provider of providers) {
    const guidance = renderDelegationGuidance(provider, 'coordination-skill')
    const block = `## Provider Delegation Guidance\n\n${guidance}\n\n`
    const candidate = manifest.replace(block, '')
    // Reconstruction makes this accept only the exact provider block emitted
    // by the materializer; arbitrary prose cannot be normalized away.
    if (candidate !== manifest && injectDelegationGuidance(candidate, guidance) === manifest)
      return candidate
  }
  return manifest
}
function legacyOwned(dir: string, name: keyof typeof LEGACY_FILES) {
  assertNoSymlink(dirname(dir), join(dir, name), 'legacy skill')
  const manifest = join(dir, name, 'SKILL.md')
  if (!existsSync(manifest)) return false
  const actual = files(join(dir, name)).sort()
  const expected = ['SKILL.md', ...Object.keys(LEGACY_FILES[name]).sort()]
  if (actual.join('\0') !== expected.join('\0')) return false
  const normalized = removeKnownGuidance(readFileSync(manifest, 'utf8'))
  return (
    Object.entries(LEGACY_FILES[name]).every(
      ([file, content]) => readFileSync(join(dir, name, file), 'utf8') === content
    ) &&
    createHash('sha256').update(normalized, 'utf8').digest('hex') ===
      LEGACY_MANIFEST_SHA256[name] &&
    new RegExp(`^name:\\s*${name}\\s*$`, 'm').test(readFileSync(manifest, 'utf8'))
  )
}
/** Read-only legacy ownership probe for diagnostics; never alters migration state. */
export function hasOwnedLegacySkills(cwd: string, skillsDir: string): boolean {
  const root = join(cwd, skillsDir)
  assertNoSymlink(cwd, root)
  return RETIRED_231.some((name) => legacyOwned(root, name))
}
/** Apply ordered, project-local skill migrations. No global package version is inspected. */
export function migrateSkills(
  cwd: string,
  skillsDir: string,
  provider?: string
): SkillMigrationResult {
  const target = pkg.version,
    root = join(cwd, skillsDir),
    state = load(cwd) ?? { roots: {} }
  assertNoSymlink(cwd, root)
  const key = skillsDir.replace(/[^a-z0-9]/gi, '_')
  const existing = state.roots[key]
  if (existing && compareVersion(existing.version, target) > 0)
    throw new Error(
      `skills were generated by newer ${existing.version}; refusing downgrade to ${target}`
    )
  const result: SkillMigrationResult = { applied: [], preserved: [] }
  const legacyRoot = RETIRED_231.some((n) => existsSync(join(root, n)))
  const effective = existing ?? {
    // A legacy directory proves this root predates the taxonomy even when its
    // contents are custom and therefore must be preserved rather than removed.
    // `version` is only advanced after canonical reconciliation completes.
    // A clean root still starts its migration checkpoint at the executable
    // version: it has no legacy bytes to migrate.
    version: legacyRoot ? '2.30.0' : '0.0.0',
    migrationVersion: legacyRoot ? '2.30.0' : target,
    provider,
    applied: [],
    pendingPreservation: [],
    inventory: {},
  }
  const registry: SkillMigration[] = [
    {
      id: '2.31.0-use-case-taxonomy',
      version: '2.31.0',
      run: (migrationRoot, migrationDir, migrationState, migrationResult) => {
        const owned = RETIRED_231.filter((n) => legacyOwned(migrationRoot, n))
        const custom = RETIRED_231.filter(
          (n) => existsSync(join(migrationRoot, n)) && !owned.includes(n)
        )
        if (owned.length) {
          const stamp = new Date().toISOString().replace(/[:.]/g, '-')
          const backup = join(cwd, '.harness', 'backups', `skills-${stamp}`)
          assertNoSymlink(cwd, join(cwd, '.harness', 'backups'), 'skills backup directory')
          assertNoSymlink(cwd, backup, 'skills backup')
          for (const name of owned) {
            assertNoSymlink(cwd, join(migrationRoot, name), 'legacy skill')
            for (const file of files(join(migrationRoot, name)))
              assertNoSymlink(
                cwd,
                join(migrationRoot, name, file),
                'legacy skill resource'
              )
            assertNoSymlink(cwd, join(backup, name), 'skills backup destination')
            cpSync(join(migrationRoot, name), join(backup, name), { recursive: true })
          }
          for (const name of owned) {
            assertNoSymlink(cwd, join(migrationRoot, name), 'legacy skill')
            rmSync(join(migrationRoot, name), { recursive: true, force: true })
          }
          migrationResult.backupDir = backup
        }
        migrationResult.preserved.push(...custom.map((n) => join(migrationDir, n)))
        migrationState.pendingPreservation = [
          ...new Set([
            ...migrationState.pendingPreservation,
            ...custom.map((n) => join(migrationDir, n)),
          ]),
        ]
      },
    },
  ]
  const eligible = [...registry]
    .sort((a, b) => compareVersion(a.version, b.version))
    .filter((migration) => compareVersion(migration.version, target) <= 0)
  for (const migration of eligible) {
    const checkpoint = effective.migrationVersion ?? effective.version
    if (compareVersion(checkpoint, migration.version) >= 0 || effective.applied.includes(migration.id))
      continue
    migration.run(root, skillsDir, effective, result)
    effective.applied.push(migration.id)
    effective.migrationVersion = migration.version
    effective.provider = provider ?? effective.provider
    state.roots[key] = effective
    // Each successful production migration is durable before the next one runs.
    // The materialized version and inventory remain untouched until the
    // canonical refresh has completed as one logical unit.
    save(cwd, state)
  }
  const checkpoint = effective.migrationVersion ?? effective.version
  if (compareVersion(checkpoint, target) < 0) {
    const latest = eligible.at(-1)?.version
    const sameMinor = latest && semver(latest).slice(0, 2).join('.') === semver(target).slice(0, 2).join('.')
    if (!sameMinor)
      throw new Error(`skills migration registry has no entry for executable version ${target}`)
  }
  effective.provider = provider ?? effective.provider
  state.roots[key] = effective
  result.state = state
  return result
}

/** Canonical inventory reconciliation used by both build and doctor. */
export function reconcileCanonicalSkills(
  cwd: string,
  skillsDir: string,
  sourceRoot: string,
  delegationGuidance?: string,
  stateOverride?: SkillState
) {
  const root = join(cwd, skillsDir)
  assertNoSymlink(cwd, root)
  mkdirSync(root, { recursive: true })
  const state = stateOverride ?? load(cwd) ?? { roots: {} }
  const key = skillsDir.replace(/[^a-z0-9]/gi, '_')
  const rootState = state.roots[key] ?? {
    // This value must not claim a fully materialized current tree until the
    // final save below succeeds.
    version: '0.0.0',
    migrationVersion: pkg.version,
    applied: [],
    pendingPreservation: [],
    inventory: {},
  }
  const inventory: Record<string, string> = {}
  const preservedInventory: Record<string, string> = {}
  const conflicts: string[] = []
  const hasVerifiedInventory = Object.keys(rootState.inventory).length > 0
  for (const name of CANONICAL_SKILLS) {
    const src = join(sourceRoot, name)
    if (!existsSync(src)) throw new Error(`canonical skill '${name}' is missing`)
    for (const rel of files(src)) {
      const dest = join(root, name, rel),
        source = readFileSync(join(src, rel), 'utf8')
      assertNoSymlink(cwd, dest)
      const content =
        rel === 'SKILL.md' && delegationGuidance
          ? injectDelegationGuidance(source, delegationGuidance)
          : source
      const keyPath = join(name, rel)
      const legacyHandoffContent =
        (name === 'ahk-feature' || name === 'ahk-fix') && rel === 'SKILL.md'
          ? delegationGuidance
            ? injectDelegationGuidance(
                source.replace('ahk-spec-tech', 'ahk-use-case-tech'),
                delegationGuidance
              )
            : source.replace('ahk-spec-tech', 'ahk-use-case-tech')
          : undefined
      // Older installations predate skills-state.json. Adopt only bytes that
      // exactly reconstruct from a known canonical source (including the
      // previous feature/fix handoff and known injected guidance); hand edits
      // stay unowned.
      if (
        !hasVerifiedInventory &&
        existsSync(dest) &&
        [content, legacyHandoffContent].includes(readFileSync(dest, 'utf8'))
      ) {
        rootState.inventory[keyPath] = readFileSync(dest, 'utf8')
      }
      // A file is generator-owned only when the last durable inventory proves
      // its current bytes are ours. Markerless/external content is preserved.
      const actual = existsSync(dest) ? readFileSync(dest, 'utf8') : undefined
      const ownedByPendingRefresh = rootState.pendingInventory?.[keyPath] === actual
      if (existsSync(dest) && rootState.inventory[keyPath] !== actual && !ownedByPendingRefresh) {
        conflicts.push(join(skillsDir, keyPath))
        continue
      }
      mkdirSync(join(dest, '..'), { recursive: true })
      // Checkpoint intent before the write. If a later source is missing (or
      // the process stops), a fresh invocation recognizes these exact bytes
      // as our interrupted work rather than classifying them as user edits.
      rootState.pendingInventory = { ...rootState.pendingInventory, [keyPath]: content }
      state.roots[key] = rootState
      save(cwd, state)
      writeFileSync(dest, content, 'utf8')
      inventory[keyPath] = content
    }
  }
  // Remove only stale files whose bytes still equal the durable generated
  // inventory; a user modification turns it into a preserved conflict.
  for (const [keyPath, expected] of Object.entries(rootState.inventory)) {
    if (keyPath in inventory) continue
    const stale = join(root, keyPath)
    assertNoSymlink(cwd, stale, 'stale skill destination')
    if (existsSync(stale) && readFileSync(stale, 'utf8') === expected) {
      rmSync(stale)
      for (let parent = dirname(stale); parent !== root; parent = dirname(parent)) {
        assertNoSymlink(cwd, parent, 'skills parent')
        if (existsSync(parent) && readdirSync(parent).length === 0) rmdirSync(parent)
        else break
      }
    } else if (existsSync(stale)) {
      conflicts.push(join(skillsDir, keyPath))
      // Keep the previous verified inventory so a later restoration to the
      // generated bytes can be recognized and removed safely.
      preservedInventory[keyPath] = expected
    }
  }
  rootState.inventory = { ...preservedInventory, ...inventory }
  rootState.pendingInventory = undefined
  rootState.version = pkg.version
  rootState.migrationVersion = pkg.version
  rootState.pendingPreservation = [...new Set([...rootState.pendingPreservation, ...conflicts])]
  state.roots[key] = rootState
  save(cwd, state)
  return { pendingPreservation: rootState.pendingPreservation }
}
