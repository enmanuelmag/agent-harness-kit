import { createHash } from 'node:crypto'
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

/* ─── Config-derived files (AGENTS.md / CLAUDE.md) ────────────────────────────
 *
 * These differ from the user-owned agent files above: they are DERIVED FROM
 * CONFIG, so a config change legitimately SHOULD flow into them — a plain
 * create-if-missing policy would freeze them at their first-generated version.
 * But `ahk build` must never silently destroy a hand-edit either. Both cannot
 * be satisfied by content alone, so each generated file carries an out-of-body
 * provenance fingerprint: a trailing HTML comment holding the sha256 of the
 * EXACT body bytes we wrote. On the next build we recompute the hash of the
 * on-disk body and route:
 *
 *   - file missing                                  -> CREATE  (stamp a marker)
 *   - on-disk body == freshly generated body        -> CURRENT (no-op)
 *   - marker present AND its hash matches the on-disk
 *     body, but the body differs from generated      -> PROPAGATE (our own prior
 *       output, made stale only by a config change — overwrite, no backup)
 *   - marker absent OR hash mismatch                 -> PRESERVE (a human edited
 *       the body after we wrote it, or it predates the fingerprint) + report
 *   - --force over a PRESERVE file                    -> back up FIRST (fail-safe,
 *       exactly like writeAgentFiles), then regenerate with a fresh marker.
 *
 * The linchpin safety property: the hash is over the EXACT bytes with NO
 * normalization. Any human change — even one space or a CRLF rewrite — makes
 * the hash mismatch and routes to PRESERVE. Misclassification can therefore
 * only ever OVER-preserve (harmless, self-announcing), never silently overwrite
 * a human edit. Do NOT trim or normalize the body before hashing.
 */

const GENERATED_MARKER_RE = /^([\s\S]*)\n<!-- ahk:generated ([0-9a-f]{64}) -->\n?$/

function bodyFingerprint(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('hex')
}

/**
 * Wraps a freshly generated body with its provenance marker. The hash is over
 * the EXACT body bytes and is computed BEFORE the marker is appended, so a
 * round-trip of our own output re-hashes equal. Exported so `scaffold()` (which
 * writes unconditionally on a fresh project) stamps the SAME marker — without
 * it, the very first build would see a markerless file, classify it as
 * human-edited, and freeze config propagation from day one.
 */
export function stampGenerated(body: string): string {
  return `${body}\n<!-- ahk:generated ${bodyFingerprint(body)} -->\n`
}

/** Parses a stamped file back into its body and recorded hash. Returns null when
 *  the file has no recognizable trailing marker (markerless, or a human appended
 *  content after the marker). The split is byte-exact: `body` is precisely the
 *  bytes that precede the `\n<marker>\n` we wrote. */
function readStamp(fileContent: string): { body: string; hash: string } | null {
  const m = GENERATED_MARKER_RE.exec(fileContent)
  if (!m) return null
  return { body: m[1], hash: m[2] }
}

/** What happened to a single config-derived file during a build. */
export type DerivedFileOutcome = 'created' | 'current' | 'propagated' | 'preserved' | 'overwritten'

export interface ReconcileResult {
  /** Files that did not exist and were written with a fresh marker. */
  created: string[]
  /** Files already byte-identical to the generated body — left untouched. */
  current: string[]
  /** Files that were provably our own prior output, made stale by a config
   *  change, and overwritten to propagate that change (no backup — our bytes). */
  propagated: string[]
  /** Files a human edited (or that predate the marker), left untouched. */
  preserved: string[]
  /** Files overwritten by `--force` despite being human-edited (backed up first). */
  overwritten: string[]
  /** Absolute path of the backup directory, when one was written. */
  backupDir?: string
}

interface ReconcileOptions {
  /** Regenerate PRESERVE files (human-edited), destroying their edits. The
   *  previous content is backed up FIRST; a backup failure aborts everything. */
  force?: boolean
  /** Absolute directory under which the pre-overwrite backup is written.
   *  Required when `force` overwrites at least one human-edited file. */
  backupRoot?: string
}

/**
 * Reconciles a batch of config-derived files against what is on disk using the
 * provenance-fingerprint policy documented above. Mirrors `writeAgentFiles`'
 * fail-safe backup: everything a `--force` run would overwrite is copied to a
 * timestamped backup directory BEFORE a single byte is written, and a backup
 * failure aborts the whole batch without touching anything.
 */
export function reconcileGeneratedFiles(
  cwd: string,
  entries: AgentFileEntry[],
  opts: ReconcileOptions = {},
): ReconcileResult {
  const result: ReconcileResult = {
    created: [],
    current: [],
    propagated: [],
    preserved: [],
    overwritten: [],
  }

  type Action = 'create' | 'current' | 'propagate' | 'preserve' | 'overwrite'
  const plans: { entry: AgentFileEntry; action: Action }[] = []
  const toBackup: AgentFileEntry[] = []

  for (const entry of entries) {
    const abs = join(cwd, entry.relPath)

    if (!existsSync(abs)) {
      plans.push({ entry, action: 'create' })
      continue
    }

    const onDisk = readFileSync(abs, 'utf8')
    const stamp = readStamp(onDisk)
    const onDiskBody = stamp ? stamp.body : onDisk

    if (onDiskBody === entry.content) {
      // Idempotent: byte-identical to the generated body. No-op, and do not even
      // rewrite the marker (holds true whether or not one is present).
      plans.push({ entry, action: 'current' })
      continue
    }

    // Body differs from generated. Is it provably our own prior output?
    if (stamp && stamp.hash === bodyFingerprint(stamp.body)) {
      // Marker matches the on-disk body byte-for-byte → the ONLY reason it
      // differs from `generated` is a config change. Safe to propagate.
      plans.push({ entry, action: 'propagate' })
      continue
    }

    // Markerless, or the marker's hash no longer matches the body → a human
    // touched it. Preserve unless the user explicitly asked to regenerate.
    if (opts.force) {
      plans.push({ entry, action: 'overwrite' })
      toBackup.push(entry)
    } else {
      plans.push({ entry, action: 'preserve' })
    }
  }

  // Fail-safe backup BEFORE any write. If this throws, nothing has been touched.
  if (toBackup.length > 0) {
    if (!opts.backupRoot) {
      throw new Error(
        'reconcileGeneratedFiles: force is set and hand-edited generated files would be ' +
          'overwritten, but no backupRoot was provided. Refusing to overwrite without a backup.',
      )
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupDir = join(opts.backupRoot, `derived-${stamp}`)
    try {
      for (const entry of toBackup) {
        const dest = join(backupDir, entry.relPath)
        mkdirSync(resolve(dest, '..'), { recursive: true })
        writeFileSync(dest, readFileSync(join(cwd, entry.relPath), 'utf8'), 'utf8')
      }
    } catch (err) {
      throw new Error(
        `Could not back up existing generated files to ${backupDir} ` +
          `(${err instanceof Error ? err.message : String(err)}). ` +
          `Aborting WITHOUT overwriting anything — no file was modified.`,
      )
    }
    result.backupDir = backupDir
  }

  for (const { entry, action } of plans) {
    const abs = join(cwd, entry.relPath)
    switch (action) {
      case 'current':
        result.current.push(entry.relPath)
        break
      case 'preserve':
        result.preserved.push(entry.relPath)
        break
      case 'create':
        mkdirSync(resolve(abs, '..'), { recursive: true })
        writeFileSync(abs, stampGenerated(entry.content), 'utf8')
        result.created.push(entry.relPath)
        break
      case 'propagate':
        mkdirSync(resolve(abs, '..'), { recursive: true })
        writeFileSync(abs, stampGenerated(entry.content), 'utf8')
        result.propagated.push(entry.relPath)
        break
      case 'overwrite':
        mkdirSync(resolve(abs, '..'), { recursive: true })
        writeFileSync(abs, stampGenerated(entry.content), 'utf8')
        result.overwritten.push(entry.relPath)
        break
    }
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
