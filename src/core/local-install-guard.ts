import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import pc from 'picocolors'

import { pkg } from '@/core/package-data'

/**
 * Determines whether `@cardor/agent-harness-kit` is available as a local
 * dependency of the project at `cwd`, or whether `cwd` IS the package
 * itself (self-dev case, e.g. working inside this repo).
 *
 * Commands that call `loadConfig(cwd)` rely on jiti resolving modules
 * relative to the package's own location (`import.meta.url`). When the
 * package is only installed globally, jiti resolves relative to the
 * global install path instead of the project's local `node_modules`,
 * breaking config/dependency resolution. This check lets the CLI warn
 * and exit before running any command logic in that case.
 */
export function isLocalInstallSatisfied(cwd: string): boolean {
  // Self-dev case: cwd is the agent-harness-kit repo itself, so there is
  // no (and should be no) node_modules/@cardor/agent-harness-kit entry.
  const selfPkgPath = join(cwd, 'package.json')
  let projectPkg: Record<string, unknown> | null = null
  if (existsSync(selfPkgPath)) {
    try {
      const selfPkg = JSON.parse(readFileSync(selfPkgPath, 'utf8'))
      if (selfPkg?.name === pkg.name) return true
      projectPkg = selfPkg
    } catch {
      // Malformed package.json — ignore and fall through to the node_modules check.
    }
  }

  const [scope, name] = pkg.name.split('/')
  const localPath = pkg.name.startsWith('@') ? join(cwd, 'node_modules', scope, name) : join(cwd, 'node_modules', pkg.name)

  if (existsSync(localPath)) return true

  // Yarn Berry with Plug'n'Play (PnP) never creates a node_modules directory
  // at all, so the check above always fails there even when the package IS
  // correctly declared and resolvable via the PnP loader. Detect PnP via its
  // generated loader files and fall back to checking that the package is
  // declared as a dependency in package.json — the only signal available
  // without depending on a node_modules layout PnP intentionally omits.
  const isPnp = existsSync(join(cwd, '.pnp.cjs')) || existsSync(join(cwd, '.pnp.loader.mjs'))
  if (isPnp && projectPkg) {
    const deps = {
      ...((projectPkg.dependencies as Record<string, unknown>) ?? {}),
      ...((projectPkg.devDependencies as Record<string, unknown>) ?? {}),
    }
    if (Object.prototype.hasOwnProperty.call(deps, pkg.name)) return true
  }

  return false
}

/**
 * Prints a warning explaining that the package must be installed locally,
 * with the exact command to fix it. Styled to match the rest of the CLI.
 */
export function printLocalInstallWarning(): void {
  console.error(pc.red(`✗ ${pkg.name} must be installed locally in this project.`))
  console.error(pc.dim(`  Run: npm install --save-dev ${pkg.name}`))
  console.error(pc.dim('  (or the equivalent for your package manager: pnpm add -D, yarn add --dev, bun add -d)'))
}
