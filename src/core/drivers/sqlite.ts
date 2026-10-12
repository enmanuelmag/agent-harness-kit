import { AsyncLocalStorage } from 'node:async_hooks'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

import { lastInsertId, openSQLite, type SQLiteDB } from '../sqlite-adapter'
import { assertSQLiteOwner, registerSQLiteOwner, releaseSQLiteOwner, type SQLiteMaintenanceToken } from '../sqlite-ownership'
import { migrateActionsToIntegerIds } from './migrate-actions'
import { removeTraceabilityTables } from './remove-traceability'

import type { DBDriver } from './types'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tasks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  slug         TEXT    NOT NULL UNIQUE,
  title        TEXT    NOT NULL,
  description  TEXT,
  status       TEXT    NOT NULL DEFAULT 'pending'
               CHECK(status IN ('pending','in_progress','done','blocked')),
  assigned_to  TEXT,
  created_at   TEXT    NOT NULL,
  started_at   TEXT,
  completed_at TEXT,
  archived_at  TEXT,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
  ,health_run_id TEXT
  ,health_status TEXT
  ,health_started_at TEXT
  ,health_completed_at TEXT
  ,health_log_path TEXT
  ,health_script_path TEXT
  ,execution_mode TEXT NOT NULL DEFAULT 'normal'
  ,claim_generation INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS task_health_runs (
  id TEXT PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  claim_generation INTEGER NOT NULL,
  execution_mode TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('running','passed','failed','superseded')),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  log_path TEXT,
  script_path TEXT
);

CREATE TABLE IF NOT EXISTS task_repairs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  claim_generation INTEGER NOT NULL,
  failed_health_run_id TEXT NOT NULL REFERENCES task_health_runs(id),
  reason TEXT NOT NULL,
  scope TEXT NOT NULL,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL,
  closed_at TEXT,
  final_health_run_id TEXT
);

CREATE TABLE IF NOT EXISTS task_acceptance (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id   INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  criterion TEXT    NOT NULL,
  met       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS actions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id      INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  agent        TEXT    NOT NULL
               CHECK(agent IN ('lead','explorer','consultant','builder','reviewer') OR agent LIKE 'custom:%'),
  status       TEXT    NOT NULL DEFAULT 'in_progress'
               CHECK(status IN ('in_progress','completed','blocked')),
  created_at   TEXT    NOT NULL,
  completed_at TEXT,
  summary      TEXT
);

CREATE TABLE IF NOT EXISTS action_sections (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  action_id    INTEGER NOT NULL REFERENCES actions(id) ON DELETE CASCADE,
  section_type TEXT    NOT NULL,
  content      TEXT    NOT NULL,
  created_at   TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_status      ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_actions_task_id   ON actions(task_id);
CREATE INDEX IF NOT EXISTS idx_actions_agent     ON actions(agent);
CREATE INDEX IF NOT EXISTS idx_actions_status    ON actions(status);
`

export class SQLiteDriver implements DBDriver {
  private db: SQLiteDB
  private dbPath: string
  private owner?: ReturnType<typeof registerSQLiteOwner>
  private transactionDepth = 0
  private readonly transactionContext = new AsyncLocalStorage<boolean>()
  private closed = false

  constructor(dbPath: string, private readonly diagnosticsOnly = false, maintenance?: SQLiteMaintenanceToken) {
    this.dbPath = dbPath
    if (diagnosticsOnly) {
      this.db = openSQLite(dbPath, true)
      return
    }
    mkdirSync(dirname(dbPath), { recursive: true })
    this.owner = registerSQLiteOwner(dbPath, maintenance)
    try {
    this.db = openSQLite(dbPath)
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('PRAGMA foreign_keys = ON')
    if (maintenance) this.db.exec('PRAGMA busy_timeout = 50')
    } catch (error) { releaseSQLiteOwner(this.owner); throw error }
  }

  async ensureSchema(): Promise<void> {
    this.assertOwner()
    this.db.exec(SCHEMA)
    // Migration: add archived_at column (safe to run multiple times)
    try {
      this.db.exec('ALTER TABLE tasks ADD COLUMN archived_at TEXT')
    } catch {
      // Column already exists — ignore
    }
    for (const column of [
      'health_run_id TEXT',
      'health_status TEXT',
      'health_started_at TEXT',
      'health_completed_at TEXT',
      'health_log_path TEXT',
      'health_script_path TEXT',
    ]) {
      try {
        this.db.exec(`ALTER TABLE tasks ADD COLUMN ${column}`)
      } catch (error) {
        if (!/duplicate column|already exists/i.test(String(error))) throw error
      }
    }
    for (const column of [
      "execution_mode TEXT NOT NULL DEFAULT 'normal'",
      'claim_generation INTEGER NOT NULL DEFAULT 0',
    ]) {
      try {
        this.db.exec(`ALTER TABLE tasks ADD COLUMN ${column}`)
      } catch (error) {
        if (!/duplicate column|already exists/i.test(String(error))) throw error
      }
    }
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS task_health_runs (id TEXT PRIMARY KEY, task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, claim_generation INTEGER NOT NULL, execution_mode TEXT NOT NULL, status TEXT NOT NULL, started_at TEXT NOT NULL, completed_at TEXT, log_path TEXT, script_path TEXT)`
    )
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS task_repairs (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, claim_generation INTEGER NOT NULL, failed_health_run_id TEXT NOT NULL, reason TEXT NOT NULL, scope TEXT NOT NULL, actor TEXT NOT NULL, created_at TEXT NOT NULL, closed_at TEXT, final_health_run_id TEXT)`
    )
    // Migration: add updated_at column (safe to run multiple times)
    try {
      this.db.exec(`ALTER TABLE tasks ADD COLUMN updated_at TEXT`)
      this.db.exec(
        `UPDATE tasks SET updated_at = COALESCE(completed_at, started_at, created_at) WHERE updated_at IS NULL OR updated_at = ''`
      )
    } catch {
      // Column already exists — ignore
    }
    // Migration (task #73): actions.id TEXT/UUID -> INTEGER autoincrement,
    // preserving all existing rows. Idempotent — no-op once already migrated.
    await migrateActionsToIntegerIds(this, 'sqlite', SCHEMA)
    await removeTraceabilityTables(this, 'sqlite')
  }

  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    this.assertOwner()
    return this.db.prepare(sql).all(...params) as unknown as T[]
  }

  async queryOne<T>(sql: string, params: unknown[] = []): Promise<T | null> {
    this.assertOwner()
    return (this.db.prepare(sql).get(...params) as unknown as T) ?? null
  }

  async insert(sql: string, params: unknown[] = []): Promise<number> {
    this.assertOwner()
    this.db.prepare(sql).run(...params)
    return lastInsertId(this.db)
  }

  async exec(sql: string, params: unknown[] = []): Promise<number> {
    this.assertOwner()
    const result = this.db.prepare(sql).run(...params)
    return (result as { changes?: number }).changes ?? 0
  }

  async execRaw(sql: string): Promise<void> {
    this.assertOwner()
    this.db.exec(sql)
  }

  async reconnect(): Promise<void> {
    this.assertOwner()
    this.db.close()
    this.db = openSQLite(this.dbPath, this.diagnosticsOnly)
    if (this.diagnosticsOnly) return
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('PRAGMA foreign_keys = ON')
  }

  private assertOwner(): void { if (this.closed) throw new Error('restart_required: This SQLite handle is closed. Reopen using current project configuration.'); if (this.owner) assertSQLiteOwner(this.owner) }

  /** Nested callers reuse the existing transaction; export and import remain one snapshot. */
  async transaction<T>(fn: (tx: DBDriver) => Promise<T>): Promise<T> {
    this.assertOwner()
    if (this.transactionDepth) {
      if (this.transactionContext.getStore()) return fn(this)
      throw new Error('database_busy: Another transaction is active on this SQLite handle. Retry after it finishes.')
    }
    this.db.exec(this.diagnosticsOnly ? 'BEGIN' : 'BEGIN IMMEDIATE')
    this.transactionDepth++
    try {
      const result = await this.transactionContext.run(true, () => fn(this))
      this.db.exec('COMMIT')
      return result
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    } finally { this.transactionDepth-- }
  }

  async close(): Promise<void> {
    if (this.closed) return
    try { this.db.close() } finally { this.closed = true; if (this.owner) { releaseSQLiteOwner(this.owner); this.owner = undefined } }
  }
}
