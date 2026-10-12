import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { BASE_NOTIFICATIONS } from '../config'
import { loadManagedConfig, mergeManagedConfig } from '../maintenance/config'
import { type BoundaryFailure, err, ok, type Result } from '../result'
import {
  normalizeNotifications,
  notificationLedgerPath,
  projectIdentity,
  readGlobalNotifications,
} from './config'
import { NotificationLedger } from './ledger'
import { readNotificationMarkers, recordNotificationEvent } from './marker'

import type { HarnessConfig, TaskRow } from '../../types'
import type { NotificationEvent, NotificationKind, NotificationSettings } from './types'

const digest = (value: string) => createHash('sha256').update(value).digest('hex')
export function notificationCliPath(): string {
  const base = typeof __dirname === 'string' ? __dirname : dirname(fileURLToPath(import.meta.url))
  const compiled = join(base, 'cli.js')
  return existsSync(compiled) ? compiled : join(base, '../../cli.ts')
}
export interface NotificationRuntimeOptions {
  homeDir?: string
  ledgerPath?: string
  dispatch?: (event: NotificationEvent, settings: NotificationSettings, path: string) => void
  now?: () => number
}
export class NotificationService {
  get settings(): NotificationSettings {
    const managed = loadManagedConfig(this.cwd)
    const base =
      BASE_NOTIFICATIONS in this.config
        ? (this.config as unknown as Record<symbol, unknown>)[BASE_NOTIFICATIONS]
        : this.config.notifications
    const config = managed.ok
      ? mergeManagedConfig({ notifications: base }, managed.value)
      : { notifications: base }
    return normalizeNotifications(
      config.notifications,
      readGlobalNotifications(this.options.homeDir ?? homedir())
    )
  }
  readonly projectKey: string
  readonly ledgerPath: string
  private now: () => number
  constructor(
    private config: Pick<HarnessConfig, 'notifications'> & {
      storage: Pick<HarnessConfig['storage'], 'projectId'>
    },
    private cwd: string,
    private options: NotificationRuntimeOptions = {}
  ) {
    const home = options.homeDir ?? homedir()
    this.projectKey = projectIdentity(cwd, config.storage.projectId)
    this.ledgerPath = options.ledgerPath ?? notificationLedgerPath(home)
    this.now = options.now ?? Date.now
  }
  private store<T>(
    operation: (ledger: NotificationLedger) => Result<T, BoundaryFailure>
  ): Result<T, BoundaryFailure> {
    let ledger: NotificationLedger | undefined
    try {
      ledger = new NotificationLedger(this.ledgerPath, this.settings, this.now)
      return operation(ledger)
    } catch (cause) {
      return err({
        context: 'notifications',
        cause,
        message: cause instanceof Error ? cause.message : String(cause),
      })
    } finally {
      try {
        ledger?.close()
      } catch {
        /* advisory cleanup */
      }
    }
  }
  publish(
    kind: NotificationKind,
    key: string,
    taskKey?: string
  ): Result<NotificationEvent | undefined, BoundaryFailure> {
    if (!this.settings.enabled || !this.settings.categories[kind]) return ok(undefined)
    const result = this.store((ledger) =>
      ledger.reserveEvent({
        kind,
        projectKey: this.projectKey,
        eventKey: digest(`${this.projectKey}\0${kind}\0${key}`),
        taskKey,
      })
    )
    if (!result.ok) return result
    const event = result.value
    if (event.isNew) {
      try {
        recordNotificationEvent(event)
        if (this.options.dispatch) this.options.dispatch(event, this.settings, this.ledgerPath)
        else this.launch(event)
      } catch {
        this.launchFailed(event) /* delivery cannot change committed state */
      }
    }
    return result
  }
  private launch(event: NotificationEvent): void {
    const cli = notificationCliPath()
    const loader = cli.endsWith('.ts') ? ['--import', 'tsx/esm'] : []
    const child = spawn(
      process.execPath,
      [
        ...loader,
        cli,
        'notifications',
        'deliver',
        '--event-id',
        event.id,
        '--ledger-path',
        this.ledgerPath,
        '--settings',
        JSON.stringify(this.settings),
      ],
      { detached: true, stdio: 'ignore', windowsHide: true, shell: false }
    )
    child.once('error', () => this.launchFailed(event))
    child.unref()
  }
  private launchFailed(event: NotificationEvent): void {
    const owner = randomUUID()
    this.store((ledger) => {
      const claimed = ledger.claimEvent(event.id, owner)
      if (!claimed.ok || !claimed.value) return claimed
      return ledger.finishEvent(event.id, owner, 'failed')
    })
  }
  taskCompleted(task: TaskRow): void {
    this.publish(
      'task.completed',
      `${task.id}:${task.claim_generation}:${task.completed_at}`,
      `${task.id}:${task.claim_generation}`
    )
    this.recovered(task)
  }
  healthBlocked(task: TaskRow): void {
    if (!this.settings.enabled || !this.settings.categories['health.blocked']) return
    const episode = this.store((ledger) =>
      ledger.episode(this.projectKey, task.id, task.claim_generation, false)
    )
    if (episode.ok && episode.value)
      this.publish('health.blocked', episode.value, `${task.id}:${task.claim_generation}`)
  }
  recovered(task: TaskRow): void {
    if (!this.settings.enabled) return
    this.store((ledger) => ledger.episode(this.projectKey, task.id, task.claim_generation, true))
  }
  bindResponse(response: unknown, provider: string, session: string, turn: string): void {
    if (!this.settings.enabled || !session || !turn) return
    for (const marker of readNotificationMarkers(response)) {
      if (
        marker.projectKey !== this.projectKey ||
        !['task.completed', 'health.blocked'].includes(marker.kind)
      )
        continue
      this.store((ledger) => {
        const event = ledger.getEvent(marker.eventId)
        if (!event.ok) return event
        if (
          !event.value ||
          event.value.projectKey !== this.projectKey ||
          event.value.kind !== marker.kind ||
          this.now() - event.value.createdAt > this.settings.maxAgeMs
        )
          return ok(false)
        return ledger.bind(event.value.id, this.projectKey, provider, digest(session), digest(turn))
      })
    }
  }
  async completeTurn(
    provider: string,
    session: string | undefined,
    turn: string | undefined,
    requestId: string
  ): Promise<void> {
    if (!this.settings.enabled) return
    let suppress = false
    if (session && turn) {
      const deadline = performance.now() + this.settings.pendingWaitMs
      do {
        const result = this.store((ledger) => {
          const bindings = ledger.bindings(this.projectKey, provider, digest(session), digest(turn))
          if (!bindings.ok) return bindings
          let terminal = false,
            played = false,
            pending = false
          for (const binding of bindings.value) {
            const event = ledger.getEvent(binding.eventId)
            if (
              !event.ok ||
              !event.value ||
              event.value.projectKey !== this.projectKey ||
              !['task.completed', 'health.blocked'].includes(event.value.kind) ||
              !['task.completed', 'health.blocked'].includes(event.value.kind) ||
              this.now() - event.value.createdAt > this.settings.maxAgeMs
            )
              continue
            terminal ||= Boolean(binding.terminal) && event.value.status === 'played'
            terminal ||= Boolean(binding.terminal) && event.value.status === 'played'
            played ||= event.value.status === 'played'
            pending ||=
              (event.value.status === 'pending' || event.value.status === 'playing') &&
              this.now() < (event.value.leaseUntil ?? event.value.createdAt + this.settings.leaseMs)
          }
          return ok({ terminal, played, pending })
        })
        if (!result.ok) break
        if (result.value.terminal) return
        suppress = result.value.played
        if (suppress || !result.value.pending || performance.now() >= deadline) break
        await new Promise((resolve) => setTimeout(resolve, 25))
      } while (performance.now() <= deadline)
      this.store((ledger) =>
        ledger.markTurnTerminal(this.projectKey, provider, digest(session), digest(turn))
      )
    }
    if (!suppress)
      this.publish('provider.completed', `${provider}:${session ?? ''}:${turn ?? requestId}`)
  }
  attention(provider: string, requestId: string, session?: string, turn?: string): void {
    this.publish('attention.requested', `${provider}:${session ?? ''}:${turn ?? ''}:${requestId}`)
  }
}
