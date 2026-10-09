import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

import { pkg } from '@/core/package-data'
import { compareSemver, parseSemver } from '@/core/update-check'

import { injectDelegationGuidance } from './templates'

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
interface RootState {
  version: string
  migrationVersion?: string
  provider?: string
  applied: string[]
  pendingPreservation: string[]
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
export interface SkillMigration {
  id: string
  version: string
  run: () => void
}
export interface SkillMigrationOptions {
  target?: string
  registry?: SkillMigration[]
}
function assertVersion(version: string) {
  if (typeof version !== 'string' || !parseSemver(version))
    throw new Error(`invalid skills migration version: ${String(version)}`)
}
function checkNoSymlink(path: string, label: string) {
  try {
    if (lstatSync(path).isSymbolicLink()) throw new Error(`refusing symlinked ${label}: ${path}`)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}
function assertNoSymlink(cwd: string, target: string, label = 'skills path') {
  const root = resolve(cwd),
    absolute = resolve(target),
    rel = relative(root, absolute)
  if (rel === '..' || /^\.\.[\\/]/.test(rel))
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
  return readdirSync(join(root, prefix), { withFileTypes: true }).flatMap((entry) => {
    const p = join(prefix, entry.name),
      full = join(root, p)
    checkNoSymlink(full, 'skills path')
    if (entry.isDirectory()) return files(root, p)
    if (!entry.isFile()) throw new Error(`refusing non-file skills path: ${full}`)
    return [p]
  })
}
function statePath(cwd: string) {
  return join(cwd, '.harness', 'skills-state.json')
}
function validateInventory(inventory: Record<string, string>) {
  for (const [path, content] of Object.entries(inventory)) {
    const normalized = path.replace(/\\/g, '/')
    if (
      !normalized ||
      normalized.startsWith('/') ||
      /^[a-z]:/i.test(normalized) ||
      normalized.split('/').some((part) => !part || part === '.' || part === '..') ||
      typeof content !== 'string'
    )
      throw new Error(`invalid skills inventory path: ${path}`)
    if (normalized !== path) {
      if (normalized in inventory && inventory[normalized] !== content)
        throw new Error(`conflicting skills inventory path: ${path}`)
      inventory[normalized] = content
      delete inventory[path]
    }
  }
}
function load(cwd: string): SkillState | undefined {
  const p = statePath(cwd)
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
  const p = statePath(cwd),
    tmp = `${p}.${process.pid}.tmp`
  assertNoSymlink(cwd, p, 'skills state')
  assertNoSymlink(cwd, tmp, 'skills state temporary file')
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', 'utf8')
  renameSync(tmp, p)
}
/** Preflight and copy every source before callers mutate any reserved content. */
function backup(
  cwd: string,
  root: string,
  paths: string[],
  existingBackup?: string
): string | undefined {
  if (!paths.length) return
  const parent = join(cwd, '.harness', 'backups')
  assertNoSymlink(cwd, parent, 'skills backup directory')
  for (const path of paths) {
    assertNoSymlink(cwd, join(root, path))
    if (lstatSync(join(root, path)).isDirectory()) files(join(root, path))
  }
  mkdirSync(parent, { recursive: true })
  const destination = existingBackup
    ? join(cwd, existingBackup)
    : mkdtempSync(join(parent, 'skills-'))
  assertNoSymlink(cwd, destination, 'skills backup destination')
  for (const path of paths) {
    const dest = join(destination, path)
    assertNoSymlink(cwd, dest, 'skills backup destination')
    if (existsSync(dest)) throw new Error(`skills backup destination already exists: ${dest}`)
  }
  for (const path of paths) {
    const dest = join(destination, path)
    assertNoSymlink(cwd, dest, 'skills backup destination')
    mkdirSync(dirname(dest), { recursive: true })
    cpSync(join(root, path), dest, { recursive: true, errorOnExist: true, force: false })
  }
  return relative(cwd, destination).replace(/\\/g, '/')
}
/** Reserved-name probe, including partial trees; diagnostics never write state. */
export function hasOwnedLegacySkills(cwd: string, skillsDir: string): boolean {
  const root = join(cwd, skillsDir)
  assertNoSymlink(cwd, root)
  let found = false
  for (const name of RETIRED_231) {
    assertNoSymlink(cwd, join(root, name))
    if (existsSync(join(root, name))) {
      files(join(root, name))
      found = true
    }
  }
  return found
}
export function migrateSkills(
  cwd: string,
  skillsDir: string,
  provider?: string,
  options: SkillMigrationOptions = {}
): SkillMigrationResult {
  const target = options.target ?? pkg.version,
    root = join(cwd, skillsDir),
    state = load(cwd) ?? { roots: {} }
  assertNoSymlink(cwd, root)
  for (const name of CANONICAL_SKILLS) {
    const path = join(root, name)
    assertNoSymlink(cwd, path)
    if (existsSync(path)) files(path)
  }
  assertNoSymlink(cwd, `${statePath(cwd)}.${process.pid}.tmp`, 'skills state temporary file')
  const key = skillsDir.replace(/[^a-z0-9]/gi, '_'),
    existing = state.roots[key]
  assertVersion(target)
  if (existing) {
    assertVersion(existing.version)
    assertVersion(existing.migrationVersion ?? existing.version)
  }
  if (
    existing &&
    (compareSemver(existing.version, target)! > 0 ||
      compareSemver(existing.migrationVersion ?? existing.version, target)! > 0)
  )
    throw new Error(
      `skills were generated by newer ${existing.version}; refusing downgrade to ${target}`
    )
  const legacyRoot = hasOwnedLegacySkills(cwd, skillsDir)
  const effective = existing ?? {
    version: legacyRoot ? '2.30.0' : '0.0.0',
    migrationVersion: legacyRoot ? '2.30.0' : target,
    provider,
    applied: [],
    pendingPreservation: [],
    inventory: {},
  }
  validateInventory(effective.inventory)
  validateInventory(effective.pendingInventory ?? {})
  const result: SkillMigrationResult = { applied: [], preserved: [] }
  const retire = () => {
    const names = RETIRED_231.filter((name) => existsSync(join(root, name)))
    result.backupDir = backup(cwd, root, names)
    for (const name of names) rmSync(join(root, name), { recursive: true })
    effective.pendingPreservation = effective.pendingPreservation.filter(
      (path) =>
        !RETIRED_231.some(
          (name) => path === join(skillsDir, name) || path.startsWith(join(skillsDir, name) + '/')
        )
    )
  }
  const registry = options.registry ?? [
    { id: '2.31.0-use-case-taxonomy', version: '2.31.0', run: retire },
  ]
  // Validate the entire registry before any entry can mutate files or checkpoints.
  for (const migration of registry) assertVersion(migration.version)
  const eligible = registry
    .filter((migration) => compareSemver(migration.version, target)! <= 0)
    .sort((a, b) => compareSemver(a.version, b.version)!)
  for (const migration of eligible) {
    if (
      compareSemver(effective.migrationVersion ?? effective.version, migration.version)! > 0 ||
      effective.applied.includes(migration.id)
    )
      continue
    migration.run()
    effective.applied.push(migration.id)
    effective.migrationVersion = migration.version
    state.roots[key] = effective
    save(cwd, state)
    result.applied.push(migration.id)
  }
  // Reconciliation recovery is independent of the historical migration ledger.
  // Previously preserved or reintroduced retired names must still be removed.
  if (legacyRoot && !result.backupDir && compareSemver(target, '2.31.0')! >= 0) {
    retire()
    state.roots[key] = effective
    save(cwd, state)
  }
  // Releases without migrations need no synthetic ledger entry. Materialization
  // advances the generated version only after canonical refresh completes.
  effective.provider = provider ?? effective.provider
  state.roots[key] = effective
  result.state = state
  return result
}
export function reconcileCanonicalSkills(
  cwd: string,
  skillsDir: string,
  sourceRoot: string,
  delegationGuidance?: string,
  stateOverride?: SkillState,
  existingBackup?: string
) {
  const root = join(cwd, skillsDir)
  assertNoSymlink(cwd, root)
  const state = stateOverride ?? load(cwd) ?? { roots: {} },
    key = skillsDir.replace(/[^a-z0-9]/gi, '_')
  const rootState = state.roots[key] ?? {
    version: '0.0.0',
    migrationVersion: pkg.version,
    applied: [],
    pendingPreservation: [],
    inventory: {},
  }
  validateInventory(rootState.inventory)
  validateInventory(rootState.pendingInventory ?? {})
  assertNoSymlink(cwd, statePath(cwd), 'skills state')
  assertNoSymlink(cwd, `${statePath(cwd)}.${process.pid}.tmp`, 'skills state temporary file')
  const inventory: Record<string, string> = {},
    changed: string[] = []
  // Preflight all reserved trees (including extra files) and packaged sources
  // before writing. Unknown skill names never confer ownership via inventory.
  for (const name of CANONICAL_SKILLS) {
    const src = join(sourceRoot, name),
      destRoot = join(root, name)
    assertNoSymlink(cwd, destRoot)
    if (existsSync(destRoot)) files(destRoot)
    assertNoSymlink(sourceRoot, src)
    if (!existsSync(src)) throw new Error(`canonical skill '${name}' is missing`)
    for (const rel of files(src)) {
      const keyPath = `${name}/${rel.replace(/\\/g, '/')}`,
        dest = join(root, keyPath),
        source = readFileSync(join(src, rel), 'utf8')
      assertNoSymlink(cwd, dest)
      const content =
        rel === 'SKILL.md' && delegationGuidance
          ? injectDelegationGuidance(source, delegationGuidance)
          : source
      inventory[keyPath] = content
      if (existsSync(dest) && readFileSync(dest, 'utf8') !== content) changed.push(keyPath)
    }
  }
  const staleFiles: string[] = [],
    conflicts: string[] = [],
    preservedInventory: Record<string, string> = {}
  for (const [keyPath, expected] of Object.entries(rootState.inventory)) {
    if (keyPath in inventory || !CANONICAL_SKILLS.some((name) => keyPath.startsWith(name + '/')))
      continue
    const stale = join(root, keyPath)
    assertNoSymlink(cwd, stale, 'stale skill destination')
    if (!existsSync(stale)) continue
    if (readFileSync(stale, 'utf8') === expected) staleFiles.push(keyPath)
    else {
      conflicts.push(join(skillsDir, keyPath))
      preservedInventory[keyPath] = expected
    }
  }
  const backupDir = backup(cwd, root, changed, existingBackup)
  mkdirSync(root, { recursive: true })
  for (const [keyPath, content] of Object.entries(inventory)) {
    const dest = join(root, keyPath)
    if (existsSync(dest) && readFileSync(dest, 'utf8') === content) continue
    mkdirSync(dirname(dest), { recursive: true })
    rootState.pendingInventory = { ...rootState.pendingInventory, [keyPath]: content }
    state.roots[key] = rootState
    save(cwd, state)
    writeFileSync(dest, content, 'utf8')
  }
  for (const keyPath of staleFiles) {
    const stale = join(root, keyPath)
    rmSync(stale)
    for (let parent = dirname(stale); parent !== root; parent = dirname(parent)) {
      if (existsSync(parent) && readdirSync(parent).length === 0) rmdirSync(parent)
      else break
    }
  }
  rootState.inventory = { ...preservedInventory, ...inventory }
  rootState.pendingInventory = undefined
  rootState.version = pkg.version
  rootState.migrationVersion = pkg.version
  rootState.pendingPreservation = conflicts
  state.roots[key] = rootState
  save(cwd, state)
  return { pendingPreservation: conflicts, backupDir }
}
