import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { hasRealLocalInstall } from '@/core/local-install-guard'

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
 * When the package is genuinely installed locally in the project at `cwd`
 * (see {@link hasRealLocalInstall}), the command is mediated by the
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
 * When there is no real local install, the package manager has nothing to
 * resolve and every one of those commands would fail. In that case the
 * binary from the global install is invoked directly, regardless of `pm`:
 *
 * | (no real local install) | `ahk serve --port <port>`                  |
 *
 * This deliberately uses {@link hasRealLocalInstall} rather than
 * {@link isLocalInstallSatisfied}: self-dev repos (where `cwd` IS this
 * package's own root) are treated as "no local install" here, even though
 * `isLocalInstallSatisfied` — used elsewhere for the config file format
 * decision and the global-install path check in `cli.ts` — still reports
 * self-dev as satisfied. There is no real
 * node_modules entry for a package manager to mediate through in self-dev,
 * so self-dev gets the same bare global command form as any other project
 * with no local install.
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

  // No real local install → the package manager cannot resolve `ahk`; call
  // the globally installed binary directly. This intentionally excludes the
  // self-dev shortcut (see JSDoc above).
  if (!hasRealLocalInstall(cwd)) {
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

/**
 * Returns the install command tokens for `target` (e.g.
 * `@cardor/agent-harness-kit@2.11.3`) under the given package manager.
 *
 * | Manager      | Local (dev)                        | Global                        |
 * | ------------ | ---------------------------------- | ----------------------------- |
 * | npm          | `npm install --save-dev <target>`  | `npm install -g <target>`     |
 * | pnpm         | `pnpm add -D <target>`             | `pnpm add -g <target>`        |
 * | yarn classic | `yarn add --dev <target>`         | `yarn global add <target>`    |
 * | yarn berry   | `yarn add --dev <target>`         | `yarn global add <target>`    |
 * | bun          | `bun add -d <target>`              | `bun add -g <target>`         |
 *
 * `dev` only applies to local installs: global installs are never
 * dev-scoped, so `dev` is ignored when `global` is true. With neither flag
 * set, the plain install form is returned (e.g. `npm install <target>`).
 */
export function getInstallCommandParts(
  pm: PackageManager,
  target: string,
  opts: { global?: boolean; dev?: boolean } = {}
): string[] {
  const { global, dev } = opts

  if (global) {
    switch (pm) {
      case 'pnpm':
        return ['pnpm', 'add', '-g', target]
      case 'yarn-classic':
      case 'yarn-berry':
        return ['yarn', 'global', 'add', target]
      case 'bun':
        return ['bun', 'add', '-g', target]
      case 'npm':
      default:
        return ['npm', 'install', '-g', target]
    }
  }

  switch (pm) {
    case 'pnpm':
      return dev ? ['pnpm', 'add', '-D', target] : ['pnpm', 'add', target]
    case 'yarn-classic':
    case 'yarn-berry':
      return dev ? ['yarn', 'add', '--dev', target] : ['yarn', 'add', target]
    case 'bun':
      return dev ? ['bun', 'add', '-d', target] : ['bun', 'add', target]
    case 'npm':
    default:
      return dev ? ['npm', 'install', '--save-dev', target] : ['npm', 'install', target]
  }
}

/**
 * Returns the "run a package without installing it" command tokens for
 * `pkgName` under the given package manager:
 *
 * | Manager      | Tokens                   |
 * | ------------ | ------------------------ |
 * | npm          | `npx <pkgName>`          |
 * | pnpm         | `pnpx <pkgName>`        |
 * | yarn classic | `yarn dlx <pkgName>`    |
 * | yarn berry   | `yarn dlx <pkgName>`    |
 * | bun          | `bunx <pkgName>`        |
 */
export function getRunOnceCommandParts(pm: PackageManager, pkgName: string): string[] {
  switch (pm) {
    case 'pnpm':
      return ['pnpx', pkgName]
    case 'yarn-classic':
    case 'yarn-berry':
      return ['yarn', 'dlx', pkgName]
    case 'bun':
      return ['bunx', pkgName]
    case 'npm':
    default:
      return ['npx', pkgName]
  }
}
