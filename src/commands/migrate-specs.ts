import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

import { loadConfig } from '@/core/config'

export interface MigrateSpecsOptions {
  apply?: boolean
  dryRun?: boolean
}

function migrateFrontmatter(raw: string): string {
  const header = raw.match(/^(---\r?\n)([\s\S]*?)(\r?\n---(?:\r?\n|$))/)
  if (!header) return raw
  const migrated = header[2]
    .replace(/^(spec_kind:[ \t]*)use-case([ \t]*)$/m, '$1spec$2')
    .replace(/^(spec_kind:[ \t]*)technical([ \t]*)$/m, '$1spec-tech$2')
  return migrated === header[2]
    ? raw
    : `${header[1]}${migrated}${header[3]}${raw.slice(header[0].length)}`
}

function assertSafePath(cwd: string, target: string, label: string) {
  const root = resolve(cwd)
  const absolute = resolve(target)
  const rel = relative(root, absolute)
  if (rel === '..' || rel.startsWith(`..${String.raw`/`}`))
    throw new Error(`refusing ${label} outside project root: ${absolute}`)
  let current = root
  checkNoSymlink(current, label)
  for (const segment of rel.split(/[\\/]/).filter(Boolean)) {
    current = join(current, segment)
    checkNoSymlink(current, label)
  }
}
function checkNoSymlink(path: string, label: string) {
  try {
    if (lstatSync(path).isSymbolicLink()) throw new Error(`refusing symlinked ${label}: ${path}`)
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('refusing symlinked')) throw error
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}
function markdownFiles(cwd: string, root: string, prefix = ''): string[] {
  assertSafePath(cwd, root, 'docs/specs directory')
  if (!existsSync(root)) return []
  return readdirSync(join(root, prefix), { withFileTypes: true }).flatMap((entry) => {
    const rel = join(prefix, entry.name)
    const path = join(root, rel)
    assertSafePath(cwd, path, 'specification document')
    return entry.isDirectory() ? markdownFiles(cwd, root, rel) : entry.name.endsWith('.md') ? [rel] : []
  })
}

/** Deliberate document migration: build/sync never mutate human specifications. */
export async function runMigrateSpecs(cwd: string, opts: MigrateSpecsOptions = {}): Promise<void> {
  if (opts.apply && opts.dryRun) throw new Error('--apply and --dry-run cannot be combined.')
  const config = await loadConfig(cwd)
  const root = resolve(cwd, config.project.docsPath, 'specs')
  assertSafePath(cwd, root, 'docs/specs directory')
  const changes = markdownFiles(cwd, root)
    .sort()
    .flatMap((file) => {
      const path = join(root, file)
      assertSafePath(cwd, path, 'specification document')
      const before = readFileSync(path, 'utf8')
      const after = migrateFrontmatter(before)
      return after === before ? [] : [{ file, path, before, after }]
    })
  if (!opts.apply) {
    console.log(`Dry run: ${changes.length} docs/specs file(s) would be migrated.`)
    for (const change of changes) console.log(`  ${change.file}`)
    console.log('Run `ahk migrate specs --apply` to apply these frontmatter-only changes.')
    return
  }
  if (changes.length) {
    const harness = join(cwd, '.harness')
    if (existsSync(harness) && lstatSync(harness).isSymbolicLink())
      throw new Error('refusing symlinked .harness directory')
    const backup = join(
      cwd,
      '.harness',
      'backups',
      `specs-${new Date().toISOString().replace(/[:.]/g, '-')}`
    )
    assertSafePath(cwd, join(cwd, '.harness'), 'harness directory')
    assertSafePath(cwd, join(cwd, '.harness', 'backups'), 'spec backup directory')
    assertSafePath(cwd, backup, 'spec backup')
    mkdirSync(backup, { recursive: true })
    for (const change of changes) {
      const destination = join(backup, change.file)
      assertSafePath(cwd, destination, 'spec backup destination')
      mkdirSync(dirname(destination), { recursive: true })
      writeFileSync(destination, change.before, 'utf8')
    }
  }
  for (const change of changes) {
    const temporary = `${change.path}.${process.pid}.tmp`
    assertSafePath(cwd, temporary, 'specification temporary file')
    writeFileSync(temporary, change.after, 'utf8')
    renameSync(temporary, change.path)
  }
  console.log(
    `Migrated ${changes.length} docs/specs file(s); document bodies, slugs, statuses, timestamps, and links were preserved.`
  )
}
