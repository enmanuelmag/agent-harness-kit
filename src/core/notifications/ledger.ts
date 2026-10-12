import { randomUUID } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

import { err, ok } from '../result.js'
import { openSQLite, type SQLiteDB } from '../sqlite-adapter.js'

import type {
  NotificationEvent,
  NotificationResult,
  NotificationSettings,
  NotificationStatus,
} from './types.js'

export class NotificationLedger {
  private db: SQLiteDB
  constructor(
    path: string,
    private settings: NotificationSettings,
    private clock: () => number = Date.now
  ) {
    const parent = dirname(path)
    const parentExisted = existsSync(parent)
    mkdirSync(parent, { recursive: true, mode: 0o700 })
    // An explicit ledger path may have a shared parent; preserve existing permissions.
    if (!parentExisted) chmodSync(parent, 0o700)
    this.db = openSQLite(path)
    try {
      chmodSync(path, 0o600)
      this.db.exec('PRAGMA busy_timeout=50;')
      const version = Number(this.db.prepare('PRAGMA user_version').get()?.user_version ?? 0)
      if (version > 1) throw new Error('Unsupported notification ledger schema')
      this.db.exec('PRAGMA journal_mode=WAL;')
      this.db
        .exec(`CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,eventKey TEXT UNIQUE NOT NULL,kind TEXT NOT NULL,projectKey TEXT NOT NULL,taskKey TEXT,status TEXT NOT NULL,createdAt INTEGER NOT NULL,leaseUntil INTEGER,owner TEXT);
        CREATE TABLE IF NOT EXISTS bindings(id TEXT PRIMARY KEY,eventId TEXT NOT NULL,projectKey TEXT NOT NULL,provider TEXT NOT NULL,session TEXT NOT NULL,turn TEXT NOT NULL,terminal INTEGER NOT NULL DEFAULT 0,createdAt INTEGER NOT NULL,UNIQUE(projectKey,provider,session,turn,eventId));
        CREATE TABLE IF NOT EXISTS episodes(id TEXT PRIMARY KEY,projectKey TEXT NOT NULL,taskId TEXT NOT NULL,generation TEXT NOT NULL,recovered INTEGER NOT NULL DEFAULT 0,createdAt INTEGER NOT NULL,UNIQUE(projectKey,taskId,generation));
        CREATE INDEX IF NOT EXISTS events_age ON events(createdAt); CREATE INDEX IF NOT EXISTS bindings_age ON bindings(createdAt); CREATE INDEX IF NOT EXISTS episodes_age ON episodes(createdAt); PRAGMA user_version=1;`)
    } catch (cause) {
      this.db.close()
      throw cause
    }
  }
  close(): void {
    this.db.close()
  }
  private attempt<T>(operation: () => T): NotificationResult<T> {
    try {
      return ok(operation())
    } catch (cause) {
      return err({
        context: 'notification ledger',
        cause,
        message: cause instanceof Error ? cause.message : String(cause),
      })
    }
  }
  private atomic<T>(operation: () => T): NotificationResult<T> {
    return this.attempt(() => {
      this.db.exec('BEGIN IMMEDIATE')
      try {
        this.prune()
        const result = operation()
        this.prune()
        this.db.exec('COMMIT')
        return result
      } catch (cause) {
        try {
          this.db.exec('ROLLBACK')
        } catch {
          /* retain original failure */
        }
        throw cause
      }
    })
  }
  private prune(): void {
    const cutoff = this.clock() - this.settings.maxAgeMs
    for (const table of ['events', 'bindings', 'episodes'])
      this.db.prepare(`DELETE FROM ${table} WHERE createdAt < ?`).run(cutoff)
    const total = Number(
      this.db
        .prepare(
          'SELECT (SELECT count(*) FROM events)+(SELECT count(*) FROM bindings)+(SELECT count(*) FROM episodes) AS total'
        )
        .get()?.total
    )
    let excess = Math.max(0, total - this.settings.maxRecords)
    while (excess > 0) {
      // Freeze exact table/id victims before deleting; memory stays bounded at 128 rows.
      const victims = this.db
        .prepare(
          "SELECT 'events' AS tab,id,createdAt FROM events UNION ALL SELECT 'bindings',id,createdAt FROM bindings UNION ALL SELECT 'episodes',id,createdAt FROM episodes ORDER BY createdAt ASC,id ASC,tab ASC LIMIT ?"
        )
        .all(Math.min(128, excess))
      for (const victim of victims) {
        const table = String(victim.tab)
        if (!['events', 'bindings', 'episodes'].includes(table))
          throw new Error('Invalid notification retention table')
        this.db.prepare(`DELETE FROM ${table} WHERE id=?`).run(victim.id)
      }
      if (!victims.length) throw new Error('Notification retention made no progress')
      excess -= victims.length
    }
  }
  reserveEvent(
    input: Pick<NotificationEvent, 'eventKey' | 'kind' | 'projectKey' | 'taskKey'>
  ): NotificationResult<NotificationEvent> {
    return this.atomic(() => {
      const id = randomUUID()
      this.db
        .prepare(
          'INSERT OR IGNORE INTO events(id,eventKey,kind,projectKey,taskKey,status,createdAt) VALUES(?,?,?,?,?,?,?)'
        )
        .run(
          id,
          input.eventKey,
          input.kind,
          input.projectKey,
          input.taskKey ?? null,
          'pending',
          this.clock()
        )
      const event = this.db
        .prepare('SELECT * FROM events WHERE eventKey=?')
        .get(input.eventKey) as unknown as NotificationEvent
      return { ...event, isNew: event.id === id }
    })
  }
  getEvent(id: string): NotificationResult<NotificationEvent | undefined> {
    return this.attempt(
      () =>
        this.db.prepare('SELECT * FROM events WHERE id=?').get(id) as unknown as
          NotificationEvent | undefined
    )
  }
  claimEvent(id: string, owner: string): NotificationResult<boolean> {
    return this.atomic(() => {
      this.db
        .prepare(
          "UPDATE events SET status='skipped' WHERE id=? AND status='pending' AND createdAt<=?"
        )
        .run(id, this.clock() - this.settings.leaseMs)
      // Expired owners are terminalized, never replayed: a previous player may have emitted sound.
      this.db
        .prepare(
          "UPDATE events SET status='skipped',owner=NULL,leaseUntil=NULL WHERE id=? AND status='playing' AND leaseUntil<=?"
        )
        .run(id, this.clock())
      this.db
        .prepare(
          "UPDATE events SET status='playing',owner=?,leaseUntil=? WHERE id=? AND status='pending'"
        )
        .run(owner, this.clock() + this.settings.leaseMs, id)
      return Number(this.db.prepare('SELECT changes() AS changed').get()?.changed) === 1
    })
  }
  finishEvent(
    id: string,
    owner: string,
    status: Extract<NotificationStatus, 'played' | 'failed' | 'skipped'>
  ): NotificationResult<boolean> {
    return this.atomic(() => {
      this.db
        .prepare(
          "UPDATE events SET status=?,leaseUntil=NULL WHERE id=? AND status='playing' AND owner=?"
        )
        .run(status, id, owner)
      return (
        this.db.prepare('SELECT status,owner FROM events WHERE id=?').get(id)?.status === status &&
        this.db.prepare('SELECT owner FROM events WHERE id=?').get(id)?.owner === owner
      )
    })
  }
  bind(
    eventId: string,
    projectKey: string,
    provider: string,
    session: string,
    turn: string
  ): NotificationResult<boolean> {
    return this.atomic(() => {
      this.db
        .prepare(
          'INSERT OR IGNORE INTO bindings(id,eventId,projectKey,provider,session,turn,createdAt) VALUES(?,?,?,?,?,?,?)'
        )
        .run(randomUUID(), eventId, projectKey, provider, session, turn, this.clock())
      return true
    })
  }
  bindings(
    projectKey: string,
    provider: string,
    session: string,
    turn: string
  ): NotificationResult<{ eventId: string; terminal: number }[]> {
    return this.attempt(
      () =>
        this.db
          .prepare(
            'SELECT eventId,terminal FROM bindings WHERE projectKey=? AND provider=? AND session=? AND turn=? AND createdAt>=?'
          )
          .all(
            projectKey,
            provider,
            session,
            turn,
            this.clock() - this.settings.maxAgeMs
          ) as unknown as {
          eventId: string
          terminal: number
        }[]
    )
  }
  markTurnTerminal(
    projectKey: string,
    provider: string,
    session: string,
    turn: string
  ): NotificationResult<boolean> {
    return this.atomic(() => {
      this.db
        .prepare(
          'UPDATE bindings SET terminal=1 WHERE projectKey=? AND provider=? AND session=? AND turn=?'
        )
        .run(projectKey, provider, session, turn)
      return true
    })
  }
  episode(
    projectKey: string,
    taskId: string | number,
    generation: string | number,
    recovered: boolean
  ): NotificationResult<string | undefined> {
    return this.atomic(() => {
      const args = [projectKey, String(taskId), String(generation)]
      if (recovered) {
        this.db
          .prepare(
            'UPDATE episodes SET recovered=1 WHERE projectKey=? AND taskId=? AND generation=?'
          )
          .run(...args)
        return undefined
      }
      const existing = this.db
        .prepare('SELECT * FROM episodes WHERE projectKey=? AND taskId=? AND generation=?')
        .get(...args)
      if (existing && existing.recovered === 0) return String(existing.id)
      const id = randomUUID()
      this.db
        .prepare(
          'INSERT INTO episodes(id,projectKey,taskId,generation,recovered,createdAt) VALUES(?,?,?,?,0,?) ON CONFLICT(projectKey,taskId,generation) DO UPDATE SET id=excluded.id,recovered=0,createdAt=excluded.createdAt'
        )
        .run(id, ...args, this.clock())
      return id
    })
  }
}
