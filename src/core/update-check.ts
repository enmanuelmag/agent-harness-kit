// src/core/update-check.ts
import pc from 'picocolors'

import { drawBox } from '@/commands/init-helpers'

import { pkg } from './package-data'

const REGISTRY_URL = `https://registry.npmjs.org/${pkg.name}/latest`
const TIMEOUT_MS = 2500

interface UpdateInfo {
  current: string
  latest: string
}

export function checkForUpdate(currentVersion: string): Promise<UpdateInfo | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), TIMEOUT_MS)

    fetch(REGISTRY_URL)
      .then((res) => res.json())
      .then((data) => {
        clearTimeout(timer)
        const latest = (data as { version: string }).version
        resolve(isNewer(latest, currentVersion) ? { current: currentVersion, latest } : null)
      })
      .catch(() => {
        clearTimeout(timer)
        resolve(null)
      })
  })
}

export function printUpdateMessage({ current, latest }: UpdateInfo): void {
  const lines = [
    `  Update available ${pc.dim(current)} → ${pc.green(latest)}  `,
    `  Run: ${pc.cyan(`pnpm i ${pkg.name}@${latest}`)}          `,
  ]

  drawBox(lines)
}

function isNewer(latest: string, current: string): boolean {
  const toNum = (v: string) => v.split('.').map(Number)
  const [lMaj, lMin, lPat] = toNum(latest)
  const [cMaj, cMin, cPat] = toNum(current)

  if (lMaj !== cMaj) return lMaj > cMaj
  if (lMin !== cMin) return lMin > cMin

  return lPat > cPat
}
