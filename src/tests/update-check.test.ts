import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'

import { pkg } from '@/core/package-data'
import { printUpdateMessage } from '@/core/update-check'

const TMP_BASE = join(import.meta.dirname, '../../.tmp-update-check')

function makeTmp(suffix: string): string {
  const dir = join(TMP_BASE, suffix)
  mkdirSync(dir, { recursive: true })
  return dir
}

function cleanTmp(): void {
  rmSync(TMP_BASE, { recursive: true, force: true })
}

// printUpdateMessage renders through drawBox → console.log, so capture
// console.log to assert on the rendered command.
function captureLog(fn: () => void): string {
  const original = console.log
  const chunks: string[] = []
  console.log = (...args: unknown[]) => {
    chunks.push(args.map(String).join(' '))
  }
  try {
    fn()
  } finally {
    console.log = original
  }
  return chunks.join('\n')
}

const LATEST = '99.0.0'
const TARGET = `${pkg.name}@${LATEST}`
const INFO = { current: '1.0.0', latest: LATEST }

describe('printUpdateMessage', () => {
  test('local pnpm project → pnpm add -D', () => {
    const dir = makeTmp('local-pnpm')
    writeFileSync(join(dir, 'pnpm-lock.yaml'), '')
    const [scope, name] = pkg.name.split('/')
    mkdirSync(join(dir, 'node_modules', scope, name), { recursive: true })

    const out = captureLog(() => printUpdateMessage(INFO, dir))
    assert.match(out, /Update available/)
    assert.ok(out.includes(`pnpm add -D ${TARGET}`), `expected "pnpm add -D ${TARGET}" in:\n${out}`)
    cleanTmp()
  })

  test('global-only dir (no local install, no lockfile) → npm install -g', () => {
    const dir = makeTmp('global-only')

    const out = captureLog(() => printUpdateMessage(INFO, dir))
    assert.ok(out.includes(`npm install -g ${TARGET}`), `expected "npm install -g ${TARGET}" in:\n${out}`)
    cleanTmp()
  })

  test('self-dev dir (no lockfile) → global command, npm fallback', () => {
    const dir = makeTmp('self-dev')
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: pkg.name }))

    const out = captureLog(() => printUpdateMessage(INFO, dir))
    assert.ok(out.includes(`npm install -g ${TARGET}`), `expected "npm install -g ${TARGET}" in:\n${out}`)
    cleanTmp()
  })

  test('self-dev dir with pnpm lockfile → pnpm add -g', () => {
    const dir = makeTmp('self-dev-pnpm')
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: pkg.name }))
    writeFileSync(join(dir, 'pnpm-lock.yaml'), '')

    const out = captureLog(() => printUpdateMessage(INFO, dir))
    assert.ok(out.includes(`pnpm add -g ${TARGET}`), `expected "pnpm add -g ${TARGET}" in:\n${out}`)
    cleanTmp()
  })

  test('pnpm global-only dir (lockfile, no local install) → pnpm add -g', () => {
    const dir = makeTmp('pnpm-global-only')
    writeFileSync(join(dir, 'pnpm-lock.yaml'), '')

    const out = captureLog(() => printUpdateMessage(INFO, dir))
    assert.ok(out.includes(`pnpm add -g ${TARGET}`), `expected "pnpm add -g ${TARGET}" in:\n${out}`)
    cleanTmp()
  })
})
