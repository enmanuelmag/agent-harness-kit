// src/core/update-check.ts
import pc from 'picocolors'

import { drawBox } from '@/commands/init-helpers'
import { hasRealLocalInstall } from '@/core/local-install-guard'
import {
  detectPackageManager,
  getInstallCommandParts,
} from '@/core/materializer/detect-package-manager'

import { pkg } from './package-data'

const REGISTRY_URL = `https://registry.npmjs.org/${pkg.name}/latest`
export const UPDATE_TIMEOUT_MS = 2500
const POSITIVE_TTL_MS = 5 * 60 * 1000
const NEGATIVE_TTL_MS = 30 * 1000

export interface UpdateInfo {
  current: string
  latest: string
}
export interface UpdateLookup {
  current: string
  latest: string | null
}

let cache: { latest: string | null; at: number } | undefined
let inflight: Promise<string | null> | undefined
let request: typeof fetch = (...args) => globalThis.fetch(...args)
let now = () => Date.now()
let timeoutMs = UPDATE_TIMEOUT_MS

const numericIdentifier = '(?:0|[1-9]\\d*)'
const nonNumericIdentifier = '(?=[0-9A-Za-z-]*[A-Za-z-])[0-9A-Za-z-]+'
const prereleaseIdentifier = `(?:${numericIdentifier}|${nonNumericIdentifier})`
const semverPattern = new RegExp(
  `^(${numericIdentifier})\\.(${numericIdentifier})\\.(${numericIdentifier})(?:-(${prereleaseIdentifier}(?:\\.${prereleaseIdentifier})*))?(?:\\+([0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?$`
)

export interface ParsedSemver {
  major: number
  minor: number
  patch: number
  prerelease: string[]
}

/** Strict SemVer 2.0.0 parsing shared by update and persisted-state checks. */
export function parseSemver(value: string): ParsedSemver | undefined {
  const match = value.match(semverPattern)
  if (!match) return undefined
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4]?.split('.') ?? [],
  }
}

export function isValidSemver(value: string): boolean {
  return parseSemver(value) !== undefined
}

/** Returns SemVer precedence, or undefined when either input is invalid. */
export function compareSemver(leftValue: string, rightValue: string): number | undefined {
  const left = parseSemver(leftValue),
    right = parseSemver(rightValue)
  if (!left || !right) return undefined
  for (const field of ['major', 'minor', 'patch'] as const) {
    if (left[field] !== right[field]) return left[field] > right[field] ? 1 : -1
  }
  const a = left.prerelease,
    b = right.prerelease
  if (!a.length || !b.length) return !a.length && b.length > 0 ? 1 : !a.length ? 0 : -1
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    if (a[index] === undefined) return -1
    if (b[index] === undefined) return 1
    if (a[index] === b[index]) continue
    const an = /^\d+$/.test(a[index]!),
      bn = /^\d+$/.test(b[index]!)
    if (an && bn) return Number(a[index]) > Number(b[index]) ? 1 : -1
    if (an !== bn) return an ? -1 : 1
    return a[index]! > b[index]! ? 1 : -1
  }
  return 0
}

export function isNewer(latest: string, current: string): boolean {
  return compareSemver(latest, current) === 1
}

async function fetchLatest(): Promise<string | null> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort()
        reject(new Error('update lookup timed out'))
      }, timeoutMs)
    })
    const response = await Promise.race([
      request(REGISTRY_URL, { signal: controller.signal }),
      timeout,
    ])
    if (!response.ok) return null
    const data: unknown = await Promise.race([response.json(), timeout])
    const version = (data as { version?: unknown })?.version
    return typeof version === 'string' && isValidSemver(version) ? version : null
  } catch {
    return null
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** Bounded shared lookup: success is cached for five minutes, failures for thirty seconds. */
export async function lookupUpdate(current = pkg.version, at = now()): Promise<UpdateLookup> {
  const ttl = cache?.latest ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS
  if (cache && at - cache.at < ttl) return { current, latest: cache.latest }
  if (!inflight)
    inflight = fetchLatest()
      .then((latest) => {
        cache = { latest, at: now() }
        return latest
      })
      .finally(() => {
        inflight = undefined
      })
  return { current, latest: await inflight }
}

/** Refresh in the background so MCP lifecycle calls never wait on the registry. */
export function warmUpdateCache(current = pkg.version): void {
  void lookupUpdate(current).catch(() => undefined)
}
export function cachedUpdate(current = pkg.version): UpdateLookup | undefined {
  if (!cache) return undefined
  const ttl = cache.latest ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS
  return now() - cache.at < ttl ? { current, latest: cache.latest } : undefined
}
export function __resetUpdateCacheForTests(): void {
  cache = undefined
  inflight = undefined
  request = (...args) => globalThis.fetch(...args)
  now = () => Date.now()
  timeoutMs = UPDATE_TIMEOUT_MS
}
export function __configureUpdateCheckForTests(options: {
  fetch?: typeof fetch
  now?: () => number
  timeoutMs?: number
}): void {
  __resetUpdateCacheForTests()
  request = options.fetch ?? fetch
  now = options.now ?? (() => Date.now())
  timeoutMs = options.timeoutMs ?? UPDATE_TIMEOUT_MS
}

export async function checkForUpdate(currentVersion: string): Promise<UpdateInfo | null> {
  const result = await lookupUpdate(currentVersion)
  return result.latest && isNewer(result.latest, currentVersion)
    ? { current: currentVersion, latest: result.latest }
    : null
}

export function resolveUpdateCommand(latest: string, cwd: string): string {
  return getInstallCommandParts(detectPackageManager(cwd), `${pkg.name}@${latest}`, {
    global: !hasRealLocalInstall(cwd),
    dev: true,
  }).join(' ')
}

export function printUpdateMessage({ current, latest }: UpdateInfo, cwd: string): void {
  drawBox([
    `  Update available ${pc.dim(current)} → ${pc.green(latest)}  `,
    `  Run: ${pc.cyan(resolveUpdateCommand(latest, cwd))}  `,
  ])
}
