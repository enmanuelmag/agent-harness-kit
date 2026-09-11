import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { pkg } from '@/core/package-data'

/**
 * Determines whether `@cardor/agent-harness-kit` is available as a local
 * dependency of the project at `cwd` (see {@link hasRealLocalInstall}), OR
 * whether `cwd` IS the package itself (self-dev case, e.g. working inside
 * this repo) — either is treated as "satisfied" here.
 *
 * This is the self-dev-inclusive, general-purpose check. It powers the
 * global-install path check in `cli.ts`'s `preAction` hook (which only
 * warns when the global `ahk` binary is missing on PATH) and the config
 * file format decision (`detectConfigExtension` in `init-helpers.ts`),
 * where self-dev genuinely behaves like a satisfied local install for
 * those purposes. Callers that need to distinguish a *real* local install
 * from the self-dev shortcut (e.g. `getMcpCommandParts`, which must not
 * mediate through a package manager that has nothing to resolve in
 * self-dev) should call {@link hasRealLocalInstall} directly instead.
 *
 * The generated config no longer needs the package resolvable at runtime
 * (`import type` is erased at compile time, and the .mjs/.cjs templates
 * don't import the package at all), so this check is no longer required
 * for `loadConfig(cwd)` to succeed. It is kept so the CLI can still tell
 * a global-only install apart from a local one — a local install remains
 * optional but recommended for pinning a reproducible version of the CLI
 * across your team and CI.
 */
export function isLocalInstallSatisfied(cwd: string): boolean {
  // Self-dev case: cwd is the agent-harness-kit repo itself, so there is
  // no (and should be no) node_modules/@cardor/agent-harness-kit entry.
  const selfPkgPath = join(cwd, 'package.json')
  if (existsSync(selfPkgPath)) {
    try {
      const selfPkg = JSON.parse(readFileSync(selfPkgPath, 'utf8'))
      if (selfPkg?.name === pkg.name) return true
    } catch {
      // Malformed package.json — ignore and fall through to the real-install check.
    }
  }

  return hasRealLocalInstall(cwd)
}

/**
 * Determines whether `@cardor/agent-harness-kit` is available as a *real*
 * local dependency of the project at `cwd` — a node_modules entry, or (for
 * Yarn Berry PnP, which never creates node_modules) a declared dependency
 * detected via the PnP loader files. Deliberately excludes the self-dev
 * shortcut (`cwd` being the package's own repo): in self-dev there is no
 * actual local install for a package manager to mediate through, so this
 * returns `false` there even though {@link isLocalInstallSatisfied} returns
 * `true`.
 *
 * Use this when the caller's decision hinges on there being something a
 * package manager can genuinely resolve — e.g. `getMcpCommandParts`, which
 * picks between a package-manager-mediated command and the bare global
 * binary. Use {@link isLocalInstallSatisfied} for general-purpose
 * "is this project set up with the package available" checks that should
 * treat self-dev the same as a real local install.
 */
export function hasRealLocalInstall(cwd: string): boolean {
  const [scope, name] = pkg.name.split('/')
  const localPath = pkg.name.startsWith('@')
    ? join(cwd, 'node_modules', scope, name)
    : join(cwd, 'node_modules', pkg.name)

  if (existsSync(localPath)) return true

  // Yarn Berry with Plug'n'Play (PnP) never creates a node_modules directory
  // at all, so the check above always fails there even when the package IS
  // correctly declared and resolvable via the PnP loader. Detect PnP via its
  // generated loader files and fall back to checking that the package is
  // declared as a dependency in package.json — the only signal available
  // without depending on a node_modules layout PnP intentionally omits.
  const isPnp = existsSync(join(cwd, '.pnp.cjs')) || existsSync(join(cwd, '.pnp.loader.mjs'))
  if (isPnp) {
    const pkgPath = join(cwd, 'package.json')
    if (existsSync(pkgPath)) {
      try {
        const projectPkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
        const deps = {
          ...((projectPkg?.dependencies as Record<string, unknown>) ?? {}),
          ...((projectPkg?.devDependencies as Record<string, unknown>) ?? {}),
        }
        if (Object.prototype.hasOwnProperty.call(deps, pkg.name)) return true
      } catch {
        // Malformed package.json — ignore and fall through to false.
      }
    }
  }

  return false
}
