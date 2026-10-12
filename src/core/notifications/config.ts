import { createHash } from 'node:crypto'
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { NotificationKind, NotificationSettings } from './types.js'

export const NOTIFICATION_KINDS: NotificationKind[] = [
  'task.completed',
  'health.blocked',
  'provider.completed',
  'attention.requested',
]
const DEFAULT_SOUNDS = {
  'task.completed': 'task-completed.wav',
  'health.blocked': 'health-blocked.wav',
  'provider.completed': 'turn-completed.wav',
  'attention.requested': 'attention.wav',
}
export function normalizeNotifications(raw: unknown, global?: unknown): NotificationSettings {
  const object = (v: unknown): Record<string, unknown> =>
    v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  const config = { ...object(global), ...object(raw) }
  const categories = { ...object(object(global).categories), ...object(object(raw).categories) }
  const sounds = { ...object(object(global).sounds), ...object(object(raw).sounds) }
  const bounded = (key: string, fallback: number, min: number, max: number) =>
    typeof config[key] === 'number' && Number.isFinite(config[key])
      ? Math.floor(Math.min(max, Math.max(min, config[key] as number)))
      : fallback
  return {
    enabled: config.enabled === true,
    categories: Object.fromEntries(
      NOTIFICATION_KINDS.map((k) => [k, categories[k] !== false])
    ) as NotificationSettings['categories'],
    sounds: Object.fromEntries(
      NOTIFICATION_KINDS.map((k) => [
        k,
        typeof sounds[k] === 'string' && Object.values(DEFAULT_SOUNDS).includes(sounds[k] as string)
          ? sounds[k]
          : DEFAULT_SOUNDS[k],
      ])
    ) as NotificationSettings['sounds'],
    maxRecords:
      typeof object(global).maxRecords === 'number' && Number.isFinite(object(global).maxRecords)
        ? Math.floor(Math.max(10, Math.min(1000, object(global).maxRecords as number)))
        : 1000,
    maxAgeMs:
      typeof object(global).maxAgeMs === 'number' && Number.isFinite(object(global).maxAgeMs)
        ? Math.floor(Math.max(1000, Math.min(86400000, object(global).maxAgeMs as number)))
        : 86400000,
    leaseMs: bounded('leaseMs', 5000, 5000, 5000),
    playerTimeoutMs: bounded('playerTimeoutMs', 3000, 100, 3000),
    pendingWaitMs: bounded('pendingWaitMs', 1500, 0, 1500),
  }
}
export function readGlobalNotifications(home = homedir()): unknown {
  try {
    const path = join(home, '.config/agent-harness-kit/notifications.json')
    if (statSync(path).size > 16384) return undefined
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}
export function notificationLedgerPath(home = homedir()): string {
  return join(home, '.config/agent-harness-kit/notifications.db')
}
export function projectIdentity(cwd: string, projectId = ''): string {
  return createHash('sha256')
    .update(`${projectId}\0${realpathSync(cwd)}`)
    .digest('hex')
}
