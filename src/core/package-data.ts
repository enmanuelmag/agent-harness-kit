import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)

// Resolved at runtime relative to the compiled file location:
// - local dev: dist/cli.js → ../package.json (root)
// - installed:  node_modules/@cardor/agent-harness-kit/dist/cli.js → ../package.json (package root)
const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json')

export const pkg = require(pkgPath) as { version: string; name: string }
