import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { GITIGNORE_ENTRIES } from './templates'

const __dirname = dirname(fileURLToPath(import.meta.url))

/* NOTE: the single-file `writeAgentFile()` was folded into `writeAgentFiles()`
 * below. Keeping both would have left two competing write policies in the same
 * module — and two policies is how this bug happened in the first place: the
 * batch call sites in `scaffold()` and `build()` drifted apart until
 * claude-code's `build()` was writing unconditionally while every other site
 * preserved. One helper, one policy. */

export interface AgentFileEntry {
  relPath: string
  content: string
}

export interface WriteAgentFilesOptions {
  /** Overwrite files that already exist, destroying any customization.
   *  Existing files are backed up to `backupRoot` FIRST. */
  force?: boolean
  /** Absolute directory under which the pre-overwrite backup is written.
   *  Required when `force` is set and any file would actually be overwritten. */
  backupRoot?: string
}

export interface WriteAgentFilesResult {
  /** Files that did not exist and were written. */
  created: string[]
  /** Files that existed and were overwritten (only possible with `force`). */
  overwritten: string[]
  /** Files that existed and were left untouched (no `force`). */
  preserved: string[]
  /** Absolute path of the backup directory, when one was written. */
  backupDir?: string
}

/**
 * Writes a batch of agent files under a single, explicit ownership policy.
 *
 * Agent files are USER-OWNED: the generator creates them when missing and
 * never touches them again. That is the whole point — a dev may edit the role
 * prompt, the model line, or the restriction fields, and a later `ahk build`
 * must not silently revert that work.
 *
 * `force` is the only escape hatch, and it is destructive: it regenerates every
 * file from the packaged template, discarding customizations. Because it is the
 * ONLY way to pick up template improvements, it must not destroy without a net
 * — so, following the `migrate storage --force` precedent, every file about to
 * be overwritten is copied to a timestamped backup directory BEFORE anything is
 * written, and a backup failure aborts the whole batch without touching a
 * single file.
 *
 * This helper exists because the same write policy was previously duplicated
 * across `scaffold()` and `build()` in all three materializers (six sites).
 * That duplication is exactly why `claude-code.ts` kept an unconditional write
 * in `build()` long after the other two providers had been fixed.
 */
export function writeAgentFiles(
  cwd: string,
  entries: AgentFileEntry[],
  opts: WriteAgentFilesOptions = {},
): WriteAgentFilesResult {
  const result: WriteAgentFilesResult = { created: [], overwritten: [], preserved: [] }

  const existing = entries.filter((e) => existsSync(join(cwd, e.relPath)))

  // Back up BEFORE any write. If this throws, nothing has been touched yet.
  if (opts.force && existing.length > 0) {
    if (!opts.backupRoot) {
      throw new Error(
        'writeAgentFiles: force is set and existing agent files would be overwritten, ' +
          'but no backupRoot was provided. Refusing to overwrite without a backup.',
      )
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupDir = join(opts.backupRoot, `agents-${stamp}`)
    try {
      for (const entry of existing) {
        const dest = join(backupDir, entry.relPath)
        mkdirSync(resolve(dest, '..'), { recursive: true })
        writeFileSync(dest, readFileSync(join(cwd, entry.relPath), 'utf8'), 'utf8')
      }
    } catch (err) {
      throw new Error(
        `Could not back up existing agent files to ${backupDir} ` +
          `(${err instanceof Error ? err.message : String(err)}). ` +
          `Aborting WITHOUT overwriting anything — no agent file was modified.`,
      )
    }
    result.backupDir = backupDir
  }

  for (const entry of entries) {
    const abs = join(cwd, entry.relPath)
    const exists = existsSync(abs)

    if (exists && !opts.force) {
      result.preserved.push(entry.relPath)
      continue
    }

    mkdirSync(resolve(abs, '..'), { recursive: true })
    writeFileSync(abs, entry.content, 'utf8')
    if (exists) result.overwritten.push(entry.relPath)
    else result.created.push(entry.relPath)
  }

  return result
}

export function appendGitignore(cwd: string): void {
  const giPath = join(cwd, '.gitignore')
  const existing = existsSync(giPath) ? readFileSync(giPath, 'utf8') : ''

  const toAdd = GITIGNORE_ENTRIES.split('\n')
    .filter((line) => line && !existing.includes(line))
    .join('\n')

  if (toAdd.trim()) {
    writeFileSync(giPath, existing + (existing.endsWith('\n') ? '' : '\n') + toAdd + '\n', 'utf8')
  }
}

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

export function writeSkills(cwd: string, skillsDir: string): void {
  const skillNames = ['ahk-ask', 'ahk-consultant', 'ahk-triage', 'ahk-review']
  for (const skillName of skillNames) {
    const src = join(__dirname, 'skills', skillName, 'SKILL.md')
    const destDir = join(cwd, skillsDir, skillName)
    const dest = join(destDir, 'SKILL.md')
    mkdirSync(destDir, { recursive: true })
    writeFileSync(dest, readFileSync(src, 'utf8'), 'utf8')
  }
}
