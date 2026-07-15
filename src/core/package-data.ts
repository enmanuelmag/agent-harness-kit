import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)

// Resolved at runtime relative to the compiled file location:
// - local dev (compiled): dist/core/package-data.js → ../../package.json (repo root)
// - installed:  node_modules/@cardor/agent-harness-kit/dist/core/package-data.js → ../../package.json (package root)
// - local dev (running .ts directly via tsx, e.g. tests): src/core/package-data.ts → ../../package.json (repo root)
const here = dirname(fileURLToPath(import.meta.url))
const candidates = [join(here, '..', '..', 'package.json'), join(here, '..', 'package.json')]
const pkgPath = candidates.find((p) => existsSync(p)) ?? candidates[0]

export const pkg = require(pkgPath) as { version: string; name: string }
