import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { err, ok } from '../result.js'

import type { NotificationKind, NotificationResult, NotificationSettings } from './types.js'

export function resolveSoundAsset(name: string): string {
  if (
    !['task-completed.wav', 'health-blocked.wav', 'turn-completed.wav', 'attention.wav'].includes(
      name
    )
  )
    throw new Error('Unknown packaged notification sound')
  const base = typeof __dirname === 'string' ? __dirname : dirname(fileURLToPath(import.meta.url))
  const candidates = [join(base, 'assets/sounds', name), join(base, '../../assets/sounds', name)]
  const path = candidates.find(existsSync)
  if (!path) throw new Error('Packaged notification sound unavailable')
  return path
}
export interface PlayerOptions {
  platform?: NodeJS.Platform
  command?: string
  run?: (command: string, args: string[], timeoutMs: number) => Promise<void>
  delay?: (ms: number) => Promise<void>
  now?: () => number
}
function quietRun(command: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'ignore', shell: false, windowsHide: true })
    let settled = false
    const finish = (cause?: unknown) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (cause) reject(cause)
      else resolve()
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish(new Error('Notification player timed out'))
    }, timeoutMs)
    child.once('error', finish)
    child.once('close', (code, signal) =>
      finish(code === 0 ? undefined : new Error(`Notification player failed (${code ?? signal})`))
    )
  })
}
export async function playNotification(
  kind: NotificationKind,
  settings: NotificationSettings,
  options: PlayerOptions = {}
): Promise<NotificationResult<'played' | 'skipped'>> {
  if (!settings.enabled || !settings.categories[kind]) return ok('skipped')
  try {
    const platform = options.platform ?? process.platform
    const path = resolveSoundAsset(settings.sounds[kind])
    const command =
      options.command ??
      (platform === 'darwin'
        ? '/usr/bin/afplay'
        : platform === 'linux'
          ? ['/usr/bin/paplay', '/usr/bin/aplay'].find(existsSync)
          : undefined)
    // Unsupported platforms/capabilities are quiet skips, including Windows without a safe player.
    if (!command) return ok('skipped')
    const now = options.now ?? Date.now
    const deadline = now() + settings.playerTimeoutMs
    const run = options.run ?? quietRun
    // health-blocked.wav is already composed as a two-pulse sound.
    const remaining = deadline - now()
    if (remaining <= 0) throw new Error('Notification event timed out')
    await run(command, [path], remaining)
    return ok('played')
  } catch (cause) {
    return err({
      context: 'notification player',
      cause,
      message: cause instanceof Error ? cause.message : String(cause),
    })
  }
}
