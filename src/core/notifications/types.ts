import type { BoundaryFailure, Result } from '../result.js'

export type NotificationKind =
  'task.completed' | 'health.blocked' | 'provider.completed' | 'attention.requested'
export type NotificationStatus = 'pending' | 'playing' | 'played' | 'failed' | 'skipped'
export interface NotificationSettings {
  enabled: boolean
  categories: Record<NotificationKind, boolean>
  sounds: Record<NotificationKind, string>
  maxRecords: number
  maxAgeMs: number
  leaseMs: number
  playerTimeoutMs: number
  pendingWaitMs: number
}
export type Settings = NotificationSettings
export type NotificationConfig = Partial<Omit<NotificationSettings, 'categories' | 'sounds'>> & {
  categories?: Partial<NotificationSettings['categories']>
  sounds?: Partial<NotificationSettings['sounds']>
}
export interface NotificationEvent {
  isNew?: boolean
  id: string
  eventKey: string
  kind: NotificationKind
  projectKey: string
  taskKey?: string
  status: NotificationStatus
  createdAt: number
  leaseUntil?: number
  owner?: string
}
export type NotificationResult<T> = Result<T, BoundaryFailure>
