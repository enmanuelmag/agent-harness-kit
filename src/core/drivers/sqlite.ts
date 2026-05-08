import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { dirname } from 'node:path'

import { lastInsertId, openSQLite, type SQLiteDB } from '../sqlite-adapter'

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
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS task_acceptance (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id   INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  criterion TEXT    NOT NULL,
  met       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS actions (
  id           TEXT    PRIMARY KEY,
  task_id      INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  agent        TEXT    NOT NULL
               CHECK(agent IN ('lead','explorer','builder','reviewer') OR agent LIKE 'custom:%'),
  status       TEXT    NOT NULL DEFAULT 'in_progress'
               CHECK(status IN ('in_progress','completed','blocked')),
  created_at   TEXT    NOT NULL,
  completed_at TEXT,
  summary      TEXT
);

CREATE TABLE IF NOT EXISTS action_sections (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  action_id    TEXT    NOT NULL REFERENCES actions(id) ON DELETE CASCADE,
  section_type TEXT    NOT NULL,
  content      TEXT    NOT NULL,
  created_at   TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS action_files (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  action_id   TEXT    NOT NULL REFERENCES actions(id) ON DELETE CASCADE,
  file_path   TEXT    NOT NULL,
  operation   TEXT    NOT NULL
              CHECK(operation IN ('read','created','modified','deleted')),
  notes       TEXT
);

CREATE TABLE IF NOT EXISTS action_tools (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  action_id      TEXT    NOT NULL REFERENCES actions(id) ON DELETE CASCADE,
  tool_name      TEXT    NOT NULL,
  args_json      TEXT,
  result_summary TEXT,
  called_at      TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_status      ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_actions_task_id   ON actions(task_id);
CREATE INDEX IF NOT EXISTS idx_actions_agent     ON actions(agent);
CREATE INDEX IF NOT EXISTS idx_actions_status    ON actions(status);
CREATE INDEX IF NOT EXISTS idx_action_files_path ON action_files(file_path);
CREATE INDEX IF NOT EXISTS idx_action_tools_name ON action_tools(tool_name);
`

export class SQLiteDriver implements DBDriver {
  private db: SQLiteDB

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true })
    // Remove stale WAL/SHM files left by a crashed session — they cause SQLITE_IOERR.
    // A 0-byte WAL alongside a non-empty SHM means the last checkpoint never completed.
    if (existsSync(dbPath)) {
      const shm = `${dbPath}-shm`
      const wal = `${dbPath}-wal`
      if (existsSync(shm) && existsSync(wal) && statSync(wal).size === 0) {
        rmSync(shm, { force: true })
        rmSync(wal, { force: true })
      }
    }
    this.db = openSQLite(dbPath)
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('PRAGMA foreign_keys = ON')
  }

  async ensureSchema(): Promise<void> {
    this.db.exec(SCHEMA)
  }

  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.db.prepare(sql).all(...params) as unknown as T[]
  }

  async queryOne<T>(sql: string, params: unknown[] = []): Promise<T | null> {
    return (this.db.prepare(sql).get(...params) as unknown as T) ?? null
  }

  async insert(sql: string, params: unknown[] = []): Promise<number> {
    this.db.prepare(sql).run(...params)
    return lastInsertId(this.db)
  }

  async exec(sql: string, params: unknown[] = []): Promise<number> {
    const result = this.db.prepare(sql).run(...params)
    return (result as { changes?: number }).changes ?? 0
  }

  async execRaw(sql: string): Promise<void> {
    this.db.exec(sql)
  }

  async transaction<T>(fn: (tx: DBDriver) => Promise<T>): Promise<T> {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = await fn(this)
      this.db.exec('COMMIT')
      return result
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
  }

  async close(): Promise<void> {
    this.db.close()
  }
}
