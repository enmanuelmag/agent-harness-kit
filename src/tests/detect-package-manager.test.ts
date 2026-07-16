import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'

import { detectPackageManager, getMcpCommandParts } from '@/core/materializer/detect-package-manager'

const TMP_BASE = join(import.meta.dirname, '../../.tmp-detect-package-manager')

function makeTmp(suffix: string): string {
  const dir = join(TMP_BASE, suffix)
  mkdirSync(dir, { recursive: true })
  return dir
}

function cleanTmp(): void {
  rmSync(TMP_BASE, { recursive: true, force: true })
}

describe('detectPackageManager', () => {
  test('detects npm via packageManager field', () => {
    const dir = makeTmp('field-npm')
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ packageManager: 'npm@10.2.0' }))
    assert.equal(detectPackageManager(dir), 'npm')
    cleanTmp()
  })

  test('detects pnpm via packageManager field', () => {
    const dir = makeTmp('field-pnpm')
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ packageManager: 'pnpm@8.15.0' }))
    assert.equal(detectPackageManager(dir), 'pnpm')
    cleanTmp()
  })

  test('detects yarn-classic via packageManager field (major 1)', () => {
    const dir = makeTmp('field-yarn-classic')
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ packageManager: 'yarn@1.22.19' }))
    assert.equal(detectPackageManager(dir), 'yarn-classic')
    cleanTmp()
  })

  test('detects yarn-berry via packageManager field (major >= 2)', () => {
    const dir = makeTmp('field-yarn-berry')
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ packageManager: 'yarn@3.6.0' }))
    assert.equal(detectPackageManager(dir), 'yarn-berry')
    cleanTmp()
  })

  test('detects bun via packageManager field', () => {
    const dir = makeTmp('field-bun')
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ packageManager: 'bun@1.1.0' }))
    assert.equal(detectPackageManager(dir), 'bun')
    cleanTmp()
  })

  test('falls back to pnpm-lock.yaml when packageManager field absent', () => {
    const dir = makeTmp('lockfile-pnpm')
    writeFileSync(join(dir, 'pnpm-lock.yaml'), '')
    assert.equal(detectPackageManager(dir), 'pnpm')
    cleanTmp()
  })

  test('falls back to bun.lockb when packageManager field absent', () => {
    const dir = makeTmp('lockfile-bun')
    writeFileSync(join(dir, 'bun.lockb'), '')
    assert.equal(detectPackageManager(dir), 'bun')
    cleanTmp()
  })

  test('falls back to bun.lock (text lockfile) when packageManager field absent', () => {
    const dir = makeTmp('lockfile-bun-text')
    writeFileSync(join(dir, 'bun.lock'), '')
    assert.equal(detectPackageManager(dir), 'bun')
    cleanTmp()
  })

  test('falls back to yarn-berry when yarn.lock + .yarnrc.yml present', () => {
    const dir = makeTmp('lockfile-yarn-berry')
    writeFileSync(join(dir, 'yarn.lock'), '')
    writeFileSync(join(dir, '.yarnrc.yml'), '')
    assert.equal(detectPackageManager(dir), 'yarn-berry')
    cleanTmp()
  })

  test('falls back to yarn-classic when yarn.lock present without .yarnrc.yml', () => {
    const dir = makeTmp('lockfile-yarn-classic')
    writeFileSync(join(dir, 'yarn.lock'), '')
    assert.equal(detectPackageManager(dir), 'yarn-classic')
    cleanTmp()
  })

  test('falls back to npm when package-lock.json present', () => {
    const dir = makeTmp('lockfile-npm')
    writeFileSync(join(dir, 'package-lock.json'), '')
    assert.equal(detectPackageManager(dir), 'npm')
    cleanTmp()
  })

  test('falls back to npm when nothing is detected', () => {
    const dir = makeTmp('no-signal')
    assert.equal(detectPackageManager(dir), 'npm')
    cleanTmp()
  })

  test('malformed package.json falls back to lockfile heuristics', () => {
    const dir = makeTmp('malformed-pkg')
    writeFileSync(join(dir, 'package.json'), '{ not valid json')
    writeFileSync(join(dir, 'pnpm-lock.yaml'), '')
    assert.equal(detectPackageManager(dir), 'pnpm')
    cleanTmp()
  })

  test('packageManager field takes priority over lockfiles', () => {
    const dir = makeTmp('field-priority')
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ packageManager: 'pnpm@9.0.0' }))
    writeFileSync(join(dir, 'yarn.lock'), '')
    assert.equal(detectPackageManager(dir), 'pnpm')
    cleanTmp()
  })
})

describe('getMcpCommandParts', () => {
  test('npm → npx --no ahk serve --port <port>', () => {
    assert.deepEqual(getMcpCommandParts('npm', 3456), ['npx', '--no', 'ahk', 'serve', '--port', '3456'])
  })

  test('pnpm → pnpm exec ahk serve --port <port>', () => {
    assert.deepEqual(getMcpCommandParts('pnpm', 3456), ['pnpm', 'exec', 'ahk', 'serve', '--port', '3456'])
  })

  test('yarn-classic → yarn run ahk serve --port <port>', () => {
    assert.deepEqual(getMcpCommandParts('yarn-classic', 3456), ['yarn', 'run', 'ahk', 'serve', '--port', '3456'])
  })

  test('yarn-berry → yarn run ahk serve --port <port>', () => {
    assert.deepEqual(getMcpCommandParts('yarn-berry', 3456), ['yarn', 'run', 'ahk', 'serve', '--port', '3456'])
  })

  test('bun → bunx --no-install ahk serve --port <port>', () => {
    assert.deepEqual(getMcpCommandParts('bun', 3456), ['bunx', '--no-install', 'ahk', 'serve', '--port', '3456'])
  })
})
