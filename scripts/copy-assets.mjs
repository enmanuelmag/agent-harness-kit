#!/usr/bin/env node
// copy-assets.mjs — copies non-TS assets from src/ to dist/ after tsc build
import { readdirSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, existsSync, cpSync } from 'node:fs'
import { join } from 'node:path'

// ─── Agent templates ──────────────────────────────────────────────────────────
const SRC = 'src/core/materializer/agent-templates'
const DEST = 'dist/core/materializer/agent-templates'

mkdirSync(DEST, { recursive: true })

for (const file of readdirSync(SRC)) {
  const dest = join(DEST, file)
  const content = readFileSync(join(SRC, file))

  // Try to remove first (handles locked/0-byte files from stale builds)
  try { unlinkSync(dest) } catch { /* file didn't exist or can't unlink — try write anyway */ }

  try {
    writeFileSync(dest, content)
    console.log(`copied: ${file}`)
  } catch (err) {
    console.warn(`warning: could not copy ${file} — ${err.message}`)
    console.warn('  → run "npm run build" from your local terminal to complete asset copy')
  }
}

// ─── Dashboard SPA ────────────────────────────────────────────────────────────
const DASHBOARD_SRC = 'src/dashboard-dist'
const DASHBOARD_DEST = 'dist/dashboard-dist'

if (existsSync(DASHBOARD_SRC)) {
  mkdirSync(DASHBOARD_DEST, { recursive: true })
  cpSync(DASHBOARD_SRC, DASHBOARD_DEST, { recursive: true })
  console.log('copied: dashboard-dist/')
} else {
  console.warn('warning: src/dashboard-dist not found — run "npm run build:ui" to build the dashboard SPA')
}
