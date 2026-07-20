import { accessSync, constants, readdirSync } from 'node:fs'
import { join } from 'node:path'
import pc from 'picocolors'

import { pkg } from '@/core/package-data'

/**
 * Fallback Windows executable extensions, used when `PATHEXT` is not set.
 * Mirrors the platform default (`.COM;.EXE;.BAT;.CMD`) — npm global installs
 * create an `ahk.cmd` shim (plus `ahk.ps1` and a bare shell script), never a
 * bare `ahk.exe`, so `.CMD` in particular must be covered.
 */
const DEFAULT_PATHEXT = ['.COM', '.EXE', '.BAT', '.CMD']

export interface ResolveOnPathOptions {
  /** PATH string to search. Defaults to `process.env.PATH`. */
  pathValue?: string
  /** PATHEXT string (Windows only). Defaults to `process.env.PATHEXT`. */
  pathext?: string
  /** Platform to resolve for. Defaults to `process.platform`. */
  platform?: NodeJS.Platform
  /**
   * POSIX executability probe for a candidate absolute path. Defaults to an
   * `fs.accessSync(p, X_OK)` check. Injectable for deterministic testing.
   */
  isExecutable?: (filePath: string) => boolean
}

/** Default POSIX executability check: file exists AND has an execute bit. */
function defaultIsExecutable(filePath: string): boolean {
  try {
    accessSync(filePath, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Normalizes a `PATHEXT` value into a list of lowercased extensions each
 * beginning with a dot (e.g. `['.com', '.exe', '.bat', '.cmd']`). Falls back
 * to {@link DEFAULT_PATHEXT} when `pathext` is missing or blank.
 */
function normalizeExts(pathext: string | undefined): string[] {
  const raw = pathext && pathext.trim().length > 0 ? pathext : DEFAULT_PATHEXT.join(';')
  return raw
    .split(';')
    .map((ext) => ext.trim().toLowerCase())
    .filter((ext) => ext.length > 0)
    .map((ext) => (ext.startsWith('.') ? ext : `.${ext}`))
}

/**
 * Pure, cross-platform "is `name` resolvable as an executable on PATH?" check.
 *
 * All environment inputs (PATH, PATHEXT, platform) are injectable so BOTH the
 * win32 and POSIX code paths are testable on any CI regardless of the host OS
 * (`process.platform` cannot be reassigned in a test).
 *
 * Behavior:
 *  - Splits `pathValue` on the platform-appropriate delimiter (`;` on win32,
 *    `:` elsewhere) and skips empty segments.
 *  - win32: a candidate matches (case-insensitively) if a directory entry
 *    equals the bare `name` or `name` + any `PATHEXT` extension. This is why
 *    an `ahk.cmd` shim resolves for the bare name `ahk`.
 *  - POSIX: a candidate matches if `join(dir, name)` exists AND is executable.
 *  - An undefined/empty `pathValue` returns `false` and never throws; a
 *    malformed or inaccessible directory is skipped rather than thrown.
 */
export function resolveOnPath(name: string, options: ResolveOnPathOptions = {}): boolean {
  const {
    pathValue = process.env.PATH,
    pathext = process.env.PATHEXT,
    platform = process.platform,
    isExecutable = defaultIsExecutable,
  } = options

  if (!pathValue) return false

  const isWindows = platform === 'win32'
  const sep = isWindows ? ';' : ':'
  const dirs = pathValue.split(sep).filter((dir) => dir.length > 0)
  if (dirs.length === 0) return false

  if (isWindows) {
    const lowerName = name.toLowerCase()
    // Candidate filenames (lowercased): the bare name (in case the caller
    // passed one that already includes an extension) plus name + each ext.
    const candidates = new Set<string>([lowerName, ...normalizeExts(pathext).map((ext) => `${lowerName}${ext}`)])
    for (const dir of dirs) {
      let entries: string[]
      try {
        entries = readdirSync(dir)
      } catch {
        // Missing/inaccessible directory on PATH — skip it, never throw.
        continue
      }
      for (const entry of entries) {
        if (candidates.has(entry.toLowerCase())) return true
      }
    }
    return false
  }

  for (const dir of dirs) {
    try {
      if (isExecutable(join(dir, name))) return true
    } catch {
      // Inaccessible entry — skip it, never throw.
      continue
    }
  }
  return false
}

/**
 * Thin wrapper over {@link resolveOnPath} that reads the real
 * `process.env.PATH`/`PATHEXT` and `process.platform`. Returns whether `name`
 * is resolvable as an executable on the current machine's PATH.
 */
export function isExecutableOnPath(name: string): boolean {
  return resolveOnPath(name)
}

/**
 * Non-blocking warning emitted at config-generation time when the project has
 * no local install AND the bare `ahk` binary is not resolvable on PATH. On the
 * global-install path the generated MCP config launches `ahk serve` directly,
 * so without `ahk` on PATH that config would fail later at spawn time. This
 * moves the failure earlier and makes it actionable. Modeled on
 * `printLocalInstallWarning()`: yellow ⚠ header + dim guidance + exact install
 * commands, all to stderr. Never calls `process.exit`; never changes the exit
 * code.
 */
export function printMissingGlobalBinaryWarning(): void {
  console.error(pc.yellow('⚠ `ahk` was not found on your PATH.'))
  console.error(pc.dim('  Your project has no local install, so the generated MCP config launches'))
  console.error(pc.dim('  `ahk serve` directly. Without `ahk` on your PATH, starting the MCP server'))
  console.error(pc.dim('  from that config will fail. This is only a warning — the command continues.'))
  console.error(pc.dim(`  Run: npm i -g ${pkg.name}   (install globally)`))
  console.error(pc.dim(`  or:  npm install --save-dev ${pkg.name}   (install locally in this project)`))
}
