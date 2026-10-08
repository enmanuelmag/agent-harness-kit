import mysql, { type ExecuteValues } from 'mysql2/promise'

import { migrateActionsToIntegerIds } from './migrate-actions'
import { removeTraceabilityTables } from './remove-traceability'

import type { DBDriver } from './types'
import type { RemoteDBConfig } from '@/types'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tasks (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  slug         VARCHAR(255) NOT NULL UNIQUE,
  title        VARCHAR(500) NOT NULL,
  description  TEXT,
  status       VARCHAR(20)  NOT NULL DEFAULT 'pending'
               CHECK(status IN ('pending','in_progress','done','blocked')),
  assigned_to  VARCHAR(255),
  created_at   VARCHAR(30)  NOT NULL,
  started_at   VARCHAR(30),
  completed_at VARCHAR(30),
  archived_at  VARCHAR(30),
  updated_at   VARCHAR(30) NOT NULL DEFAULT CURRENT_TIMESTAMP
  ,health_run_id VARCHAR(36)
  ,health_status VARCHAR(16)
  ,health_started_at VARCHAR(30)
  ,health_completed_at VARCHAR(30)
  ,health_log_path TEXT
  ,health_script_path TEXT
  ,execution_mode VARCHAR(16) NOT NULL DEFAULT 'normal'
  ,claim_generation INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS task_health_runs (
  id VARCHAR(36) PRIMARY KEY,
  task_id INT NOT NULL,
  claim_generation INT NOT NULL,
  execution_mode VARCHAR(16) NOT NULL,
  status VARCHAR(16) NOT NULL,
  started_at VARCHAR(30) NOT NULL,
  completed_at VARCHAR(30),
  log_path TEXT,
  script_path TEXT,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS task_repairs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  task_id INT NOT NULL,
  claim_generation INT NOT NULL,
  failed_health_run_id VARCHAR(36) NOT NULL,
  reason TEXT NOT NULL,
  scope TEXT NOT NULL,
  actor VARCHAR(255) NOT NULL,
  created_at VARCHAR(30) NOT NULL,
  closed_at VARCHAR(30),
  final_health_run_id VARCHAR(36),
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (failed_health_run_id) REFERENCES task_health_runs(id)
);

CREATE TABLE IF NOT EXISTS task_acceptance (
  id        INT AUTO_INCREMENT PRIMARY KEY,
  task_id   INT  NOT NULL,
  criterion TEXT NOT NULL,
  met       INT  NOT NULL DEFAULT 0,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS actions (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  task_id      INT          NOT NULL,
  agent        VARCHAR(100) NOT NULL,
  status       VARCHAR(20)  NOT NULL DEFAULT 'in_progress'
               CHECK(status IN ('in_progress','completed','blocked')),
  created_at   VARCHAR(30)  NOT NULL,
  completed_at VARCHAR(30),
  summary      TEXT,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS action_sections (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  action_id    INT NOT NULL,
  section_type VARCHAR(100) NOT NULL,
  content      TEXT         NOT NULL,
  created_at   VARCHAR(30)  NOT NULL,
  FOREIGN KEY (action_id) REFERENCES actions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tasks_status      ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_actions_task_id   ON actions(task_id);
CREATE INDEX IF NOT EXISTS idx_actions_agent     ON actions(agent);
CREATE INDEX IF NOT EXISTS idx_actions_status    ON actions(status);
`

type MySQLPool = mysql.Pool

export class MySQLDriver implements DBDriver {
  private pool: MySQLPool

  constructor(config: RemoteDBConfig) {
    this.pool = mysql.createPool(config.connectionString)
  }

  async ensureSchema(): Promise<void> {
    // Run each statement individually since mysql2 doesn't support multi-statement by default
    const statements = SCHEMA.split(';')
      .map((s) => s.trim())
      .filter(Boolean)

    const conn = await this.pool.getConnection()
    try {
      for (const stmt of statements) {
        await conn.execute(stmt)
      }
      // Migration: add archived_at column (safe to run multiple times)
      try {
        await conn.execute('ALTER TABLE tasks ADD COLUMN archived_at VARCHAR(30)')
      } catch {
        // Column already exists — ignore
      }
      for (const column of ['health_run_id VARCHAR(36)', 'health_status VARCHAR(16)', 'health_started_at VARCHAR(30)', 'health_completed_at VARCHAR(30)', 'health_log_path TEXT', 'health_script_path TEXT']) {
        try { await conn.execute(`ALTER TABLE tasks ADD COLUMN ${column}`) } catch (error) {
          if (!/duplicate column|already exists/i.test(String(error))) throw error
        }
      }
      for (const column of ["execution_mode VARCHAR(16) NOT NULL DEFAULT 'normal'", 'claim_generation INT NOT NULL DEFAULT 0']) {
        try { await conn.execute(`ALTER TABLE tasks ADD COLUMN ${column}`) } catch (error) {
          if (!/duplicate column|already exists/i.test(String(error))) throw error
        }
      }
      await conn.execute(`CREATE TABLE IF NOT EXISTS task_health_runs (id VARCHAR(36) PRIMARY KEY, task_id INT NOT NULL, claim_generation INT NOT NULL, execution_mode VARCHAR(16) NOT NULL, status VARCHAR(16) NOT NULL, started_at VARCHAR(30) NOT NULL, completed_at VARCHAR(30), log_path TEXT, script_path TEXT, FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE)`)
      await conn.execute(`CREATE TABLE IF NOT EXISTS task_repairs (id INT AUTO_INCREMENT PRIMARY KEY, task_id INT NOT NULL, claim_generation INT NOT NULL, failed_health_run_id VARCHAR(36) NOT NULL, reason TEXT NOT NULL, scope TEXT NOT NULL, actor VARCHAR(255) NOT NULL, created_at VARCHAR(30) NOT NULL, closed_at VARCHAR(30), final_health_run_id VARCHAR(36), FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE)`)
      // Migration: add updated_at column (safe to run multiple times)
      try {
        await conn.execute(
          `ALTER TABLE tasks ADD COLUMN updated_at VARCHAR(30) NOT NULL DEFAULT CURRENT_TIMESTAMP`
        )
        await conn.execute(
          `UPDATE tasks SET updated_at = COALESCE(completed_at, started_at, created_at) WHERE updated_at IS NULL OR updated_at = ''`
        )
      } catch {
        // Column already exists — ignore
      }
    } finally {
      conn.release()
    }
    // Migration (task #73): actions.id VARCHAR/UUID -> INT AUTO_INCREMENT,
    // preserving all existing rows. Idempotent — no-op once already migrated.
    // Run outside the connection above (own execRaw/query calls via the pool)
    // since MySQL's DDL isn't transactional either way.
    await migrateActionsToIntegerIds(this, 'mysql', SCHEMA)
    await removeTraceabilityTables(this, 'mysql')
  }

  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const [rows] = await this.pool.execute(sql, params as ExecuteValues)
    return rows as unknown as T[]
  }

  async queryOne<T>(sql: string, params: unknown[] = []): Promise<T | null> {
    const rows = await this.query<T>(sql, params)
    return (rows as T[])[0] ?? null
  }

  async insert(sql: string, params: unknown[] = []): Promise<number> {
    const [result] = await this.pool.execute(sql, params as ExecuteValues)
    return (result as mysql.ResultSetHeader).insertId
  }

  async exec(sql: string, params: unknown[] = []): Promise<number> {
    const [result] = await this.pool.execute(sql, params as ExecuteValues)
    return (result as mysql.ResultSetHeader).affectedRows
  }

  async execRaw(sql: string): Promise<void> {
    await this.pool.query(sql)
  }

  async transaction<T>(fn: (tx: DBDriver) => Promise<T>): Promise<T> {
    const conn = await this.pool.getConnection()
    await conn.beginTransaction()
    try {
      const txDriver = new MySQLTxDriver(conn)
      const result = await fn(txDriver)
      await conn.commit()
      return result
    } catch (err) {
      await conn.rollback()
      throw err
    } finally {
      conn.release()
    }
  }

  async reconnect(): Promise<void> {
    /* no-op — connection pool handles freshness */
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}

class MySQLTxDriver implements DBDriver {
  constructor(private conn: mysql.PoolConnection) {}

  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const [rows] = await this.conn.execute(sql, params as ExecuteValues)
    return rows as unknown as T[]
  }

  async queryOne<T>(sql: string, params: unknown[] = []): Promise<T | null> {
    return (await this.query<T>(sql, params))[0] ?? null
  }

  async insert(sql: string, params: unknown[] = []): Promise<number> {
    const [result] = await this.conn.execute(sql, params as ExecuteValues)
    return (result as mysql.ResultSetHeader).insertId
  }

  async exec(sql: string, params: unknown[] = []): Promise<number> {
    const [result] = await this.conn.execute(sql, params as ExecuteValues)
    return (result as mysql.ResultSetHeader).affectedRows
  }

  async execRaw(sql: string): Promise<void> {
    await this.conn.query(sql)
  }

  async transaction<T>(fn: (tx: DBDriver) => Promise<T>): Promise<T> {
    return fn(this)
  }

  async ensureSchema(): Promise<void> {}
  async reconnect(): Promise<void> {
    /* no-op — connection pool handles freshness */
  }
  async close(): Promise<void> {}
}
