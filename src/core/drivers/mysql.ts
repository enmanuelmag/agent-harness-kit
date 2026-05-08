import mysql, { type ExecuteValues } from 'mysql2/promise'

import type { DBDriver } from './types'
import type { DatabaseConfig } from '@/types'

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
  completed_at VARCHAR(30)
);

CREATE TABLE IF NOT EXISTS task_acceptance (
  id        INT AUTO_INCREMENT PRIMARY KEY,
  task_id   INT  NOT NULL,
  criterion TEXT NOT NULL,
  met       INT  NOT NULL DEFAULT 0,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS actions (
  id           VARCHAR(36)  PRIMARY KEY,
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
  action_id    VARCHAR(36) NOT NULL,
  section_type VARCHAR(100) NOT NULL,
  content      TEXT         NOT NULL,
  created_at   VARCHAR(30)  NOT NULL,
  FOREIGN KEY (action_id) REFERENCES actions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS action_files (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  action_id   VARCHAR(36)  NOT NULL,
  file_path   VARCHAR(1000) NOT NULL,
  operation   VARCHAR(20)  NOT NULL
              CHECK(operation IN ('read','created','modified','deleted')),
  notes       TEXT,
  FOREIGN KEY (action_id) REFERENCES actions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS action_tools (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  action_id      VARCHAR(36)  NOT NULL,
  tool_name      VARCHAR(255) NOT NULL,
  args_json      TEXT,
  result_summary TEXT,
  called_at      VARCHAR(30)  NOT NULL,
  FOREIGN KEY (action_id) REFERENCES actions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tasks_status      ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_actions_task_id   ON actions(task_id);
CREATE INDEX IF NOT EXISTS idx_actions_agent     ON actions(agent);
CREATE INDEX IF NOT EXISTS idx_actions_status    ON actions(status);
CREATE INDEX IF NOT EXISTS idx_action_files_path ON action_files(file_path(255));
CREATE INDEX IF NOT EXISTS idx_action_tools_name ON action_tools(tool_name);
`

type MySQLPool = mysql.Pool

export class MySQLDriver implements DBDriver {
  private pool: MySQLPool

  constructor(config: DatabaseConfig) {
    if (config.connectionString) {
      this.pool = mysql.createPool(config.connectionString)
    } else {
      this.pool = mysql.createPool({
        host: config.host ?? 'localhost',
        port: config.port ?? 3306,
        user: config.user,
        password: config.password,
        database: config.database,
        multipleStatements: true,
      })
    }
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
    } finally {
      conn.release()
    }
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

  async close(): Promise<void> {
    await this.pool.end()
  }
}

class MySQLTxDriver implements DBDriver {
  constructor(private conn: mysql.PoolConnection) { }

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

  async ensureSchema(): Promise<void> { }
  async close(): Promise<void> { }
}
