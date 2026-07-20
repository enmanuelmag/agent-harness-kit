import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { isLocalInstallSatisfied } from '@/core/local-install-guard'

export type PackageManager = 'npm' | 'pnpm' | 'yarn-classic' | 'yarn-berry' | 'bun'

/**
 * Detects the package manager used by the project at `cwd`.
 *
 * Priority:
 * 1. The `packageManager` field in `package.json` (e.g. `"yarn@3.6.0"`,
 *    `"pnpm@8.15.0"`) — the most reliable signal when present, since it's an
 *    explicit declaration (Corepack-compatible) rather than a guess.
 * 2. Lockfile heuristics — `pnpm-lock.yaml` → pnpm, `bun.lockb`/`bun.lock` →
 *    bun, `yarn.lock` → yarn (distinguishing classic vs berry via the
 *    presence of `.yarnrc.yml`, which only exists in Yarn Berry projects),
 *    `package-lock.json` → npm.
 * 3. Fallback: `npm`.
 */
export function detectPackageManager(cwd: string): PackageManager {
  const fromField = detectFromPackageManagerField(cwd)
  if (fromField) return fromField

  if (existsSync(join(cwd, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(join(cwd, 'bun.lockb')) || existsSync(join(cwd, 'bun.lock'))) return 'bun'
  if (existsSync(join(cwd, 'yarn.lock'))) {
    return existsSync(join(cwd, '.yarnrc.yml')) ? 'yarn-berry' : 'yarn-classic'
  }
  if (existsSync(join(cwd, 'package-lock.json'))) return 'npm'

  return 'npm'
}

function detectFromPackageManagerField(cwd: string): PackageManager | null {
  const pkgPath = join(cwd, 'package.json')
  if (!existsSync(pkgPath)) return null

  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    const field = pkg?.packageManager
    if (typeof field !== 'string' || !field.trim()) return null

    // Format: "<name>@<version>[+hash]" (Corepack convention)
    const match = field.match(/^([a-z]+)@(\d+)/i)
    if (!match) return null

    const [, rawName, majorStr] = match
    const name = rawName.toLowerCase()
    const major = Number(majorStr)

    switch (name) {
      case 'npm':
        return 'npm'
      case 'pnpm':
        return 'pnpm'
      case 'bun':
        return 'bun'
      case 'yarn':
        return major >= 2 ? 'yarn-berry' : 'yarn-classic'
      default:
        return null
    }
  } catch {
    return null
  }
}

/**
 * Returns the full command-line tokens for spawning the MCP server.
 *
 * When the package is installed locally in the project at `cwd` (or `cwd` IS
 * the package itself — the self-dev case), the command is mediated by the
 * project's package manager so the pinned local version is the one that runs:
 *
 * | Manager      | Tokens                                              |
 * | ------------ | ---------------------------------------------------- |
 * | npm          | `npx --no ahk serve --port <port>`                    |
 * | pnpm         | `pnpm exec ahk serve --port <port>`                   |
 * | yarn classic | `yarn run ahk serve --port <port>`                    |
 * | yarn berry   | `yarn run ahk serve --port <port>`                    |
 * | bun          | `bunx --no-install ahk serve --port <port>`           |
 *
 * When there is no local install, the package manager has nothing to resolve
 * and every one of those commands would fail. In that case the binary from
 * the global install is invoked directly, regardless of `pm`:
 *
 * | (no local install) | `ahk serve --port <port>`                       |
 *
 * `cwd` is required on purpose: it must be the project root being configured,
 * never a process-wide default. Defaulting it to `process.cwd()` would make
 * the result depend on where the process happens to be running from.
 *
 * Callers split this into `command`/`args` (Claude Code, Codex CLI) or use
 * the array as-is (OpenCode, whose `mcp.<name>.command` field is a single
 * array rather than a separate command/args pair).
 */
export function getMcpCommandParts(pm: PackageManager, port: number, cwd: string): string[] {
  const portStr = String(port)

  // No local install → the package manager cannot resolve `ahk`; call the
  // globally installed binary directly.
  if (!isLocalInstallSatisfied(cwd)) {
    return ['ahk', 'serve', '--port', portStr]
  }

  switch (pm) {
    case 'pnpm':
      return ['pnpm', 'exec', 'ahk', 'serve', '--port', portStr]
    case 'yarn-classic':
    case 'yarn-berry':
      return ['yarn', 'run', 'ahk', 'serve', '--port', portStr]
    case 'bun':
      return ['bunx', '--no-install', 'ahk', 'serve', '--port', portStr]
    case 'npm':
    default:
      return ['npx', '--no', 'ahk', 'serve', '--port', portStr]
  }
}
