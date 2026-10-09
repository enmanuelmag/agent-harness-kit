import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'

import { collectOperationalNotices } from '@/core/operational-notices'
import { pkg } from '@/core/package-data'
import { __configureUpdateCheckForTests, __resetUpdateCacheForTests, compareSemver, isNewer, lookupUpdate, printUpdateMessage } from '@/core/update-check'

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
    assert.ok(
      out.includes(`npm install -g ${TARGET}`),
      `expected "npm install -g ${TARGET}" in:\n${out}`
    )
    cleanTmp()
  })

  test('self-dev dir (no lockfile) → global command, npm fallback', () => {
    const dir = makeTmp('self-dev')
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: pkg.name }))

    const out = captureLog(() => printUpdateMessage(INFO, dir))
    assert.ok(
      out.includes(`npm install -g ${TARGET}`),
      `expected "npm install -g ${TARGET}" in:\n${out}`
    )
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

describe('shared update lookup', () => {
  test('uses strict SemVer and prerelease precedence', () => {
    assert.equal(isNewer('1.0.0', '1.0.0-beta.2'), true)
    assert.equal(isNewer('1.0.0-beta.11', '1.0.0-beta.2'), true)
    assert.equal(isNewer('1.0.0-beta.2', '1.0.0-beta.11'), false)
    assert.equal(isNewer('01.0.0', '1.0.0'), false)
    assert.equal(isNewer('1.0', '1.0.0'), false)
    assert.equal(isNewer('1.0.0-01', '1.0.0-1'), false)
    assert.equal(compareSemver('1.0.0', '1.0.0-beta.2'), 1)
    assert.equal(compareSemver('1.0.0-beta.2', '1.0.0'), -1)
  })
  test('coalesces concurrent callers and returns the caller current version', async () => {
    let calls = 0
    __configureUpdateCheckForTests({ fetch: async () => { calls++; return new Response(JSON.stringify({ version: '9.9.9' }), { status: 200 }) } })
    const [a, b] = await Promise.all([lookupUpdate('1.0.0'), lookupUpdate('2.0.0')])
    assert.equal(calls, 1)
    assert.equal(a.current, '1.0.0')
    assert.equal(b.current, '2.0.0')
    assert.equal(a.latest, '9.9.9')
    __resetUpdateCacheForTests()
  })

  test('malformed registry data becomes a short-lived unknown result', async () => {
    let calls = 0
    __configureUpdateCheckForTests({ fetch: async () => { calls++; return new Response(JSON.stringify({ version: 'not-semver' }), { status: 200 }) } })
    assert.equal((await lookupUpdate('1.0.0')).latest, null)
    assert.equal((await lookupUpdate('1.0.0')).latest, null)
    assert.equal(calls, 1)
    __resetUpdateCacheForTests()
  })

  test('times out a registry response whose JSON body never settles', async () => {
    __configureUpdateCheckForTests({
      fetch: async () => ({ ok: true, json: () => new Promise(() => {}) }) as Response,
      timeoutMs: 1,
    })
    assert.equal((await lookupUpdate('1.0.0')).latest, null)
    __resetUpdateCacheForTests()
  })

  test('uses separate positive and negative cache TTLs', async () => {
    let clock = 0
    let positiveCalls = 0
    __configureUpdateCheckForTests({
      now: () => clock,
      fetch: async () => {
        positiveCalls++
        return new Response(JSON.stringify({ version: '9.9.9' }), { status: 200 })
      },
    })
    await lookupUpdate('1.0.0')
    clock = 5 * 60 * 1000 - 1
    await lookupUpdate('1.0.0')
    assert.equal(positiveCalls, 1)
    clock++
    await lookupUpdate('1.0.0')
    assert.equal(positiveCalls, 2)

    __configureUpdateCheckForTests({
      now: () => clock,
      fetch: async () => new Response(JSON.stringify({ version: 'invalid' }), { status: 200 }),
    })
    await lookupUpdate('1.0.0')
    clock += 30 * 1000 - 1
    assert.equal((await lookupUpdate('1.0.0')).latest, null)
    clock++
    let negativeCalls = 0
    __configureUpdateCheckForTests({
      now: () => clock,
      fetch: async () => {
        negativeCalls++
        return new Response(JSON.stringify({ version: 'invalid' }), { status: 200 })
      },
    })
    await lookupUpdate('1.0.0')
    clock += 30 * 1000 - 1
    await lookupUpdate('1.0.0')
    assert.equal(negativeCalls, 1)
    clock++
    await lookupUpdate('1.0.0')
    assert.equal(negativeCalls, 2)
    __resetUpdateCacheForTests()
  })

  test('cold lifecycle collection never waits for a registry lookup', () => {
    __configureUpdateCheckForTests({ fetch: async () => new Promise(() => {}) })
    const notices = collectOperationalNotices(makeTmp('cold-lifecycle'), 'opencode')
    assert.ok(Array.isArray(notices))
    __resetUpdateCacheForTests()
    cleanTmp()
  })
})
