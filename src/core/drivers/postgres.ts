import postgres from 'postgres'

import type { DBDriver } from './types'
import type { DatabaseConfig } from '@/types'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tasks (
  id           SERIAL PRIMARY KEY,
  slug         TEXT   NOT NULL UNIQUE,
  title        TEXT   NOT NULL,
  description  TEXT,
  status       TEXT   NOT NULL DEFAULT 'pending'
               CHECK(status IN ('pending','in_progress','done','blocked')),
  assigned_to  TEXT,
  created_at   TEXT   NOT NULL,
  started_at   TEXT,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS task_acceptance (
  id        SERIAL  PRIMARY KEY,
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
  id           SERIAL  PRIMARY KEY,
  action_id    TEXT    NOT NULL REFERENCES actions(id) ON DELETE CASCADE,
  section_type TEXT    NOT NULL,
  content      TEXT    NOT NULL,
  created_at   TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS action_files (
  id          SERIAL  PRIMARY KEY,
  action_id   TEXT    NOT NULL REFERENCES actions(id) ON DELETE CASCADE,
  file_path   TEXT    NOT NULL,
  operation   TEXT    NOT NULL
              CHECK(operation IN ('read','created','modified','deleted')),
  notes       TEXT
);

CREATE TABLE IF NOT EXISTS action_tools (
  id             SERIAL  PRIMARY KEY,
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

// Convert SQLite-style ? placeholders to Postgres $1, $2, ...
function toPositional(sql: string): string {
  let i = 0
  return sql.replace(/\?/g, () => `$${++i}`)
}

export class PostgresDriver implements DBDriver {
  private sql: postgres.Sql

  constructor(config: DatabaseConfig) {
    if (config.connectionString) {
      this.sql = postgres(config.connectionString)
    } else {
      this.sql = postgres({
        host: config.host ?? 'localhost',
        port: config.port ?? 5432,
        user: config.user,
        password: config.password,
        database: config.database,
      })
    }
  }

  async ensureSchema(): Promise<void> {
    await this.sql.unsafe(SCHEMA)
  }

  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const rows = await this.sql.unsafe(toPositional(sql), params as postgres.ParameterOrJSON<never>[])
    return rows as unknown as T[]
  }

  async queryOne<T>(sql: string, params: unknown[] = []): Promise<T | null> {
    const rows = await this.query<T>(sql, params)
    return rows[0] ?? null
  }

  async insert(sql: string, params: unknown[] = []): Promise<number> {
    const withReturning = toPositional(sql.trimEnd()) + ' RETURNING id'
    const rows = await this.sql.unsafe(withReturning, params as postgres.ParameterOrJSON<never>[])
    return (rows[0] as unknown as { id: number }).id
  }

  async exec(sql: string, params: unknown[] = []): Promise<number> {
    const result = await this.sql.unsafe(toPositional(sql), params as postgres.ParameterOrJSON<never>[])
    return result.count
  }

  async execRaw(sql: string): Promise<void> {
    await this.sql.unsafe(sql)
  }

  async transaction<T>(fn: (tx: DBDriver) => Promise<T>): Promise<T> {
    let result!: T
    await this.sql.begin(async (txSql) => {
      const txDriver = new PostgresTxDriver(txSql)
      result = await fn(txDriver)
    })
    return result
  }

  async close(): Promise<void> {
    await this.sql.end()
  }
}

class PostgresTxDriver implements DBDriver {
  constructor(private sql: postgres.TransactionSql) { }

  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const rows = await this.sql.unsafe(toPositional(sql), params as postgres.ParameterOrJSON<never>[])
    return rows as unknown as T[]
  }

  async queryOne<T>(sql: string, params: unknown[] = []): Promise<T | null> {
    return (await this.query<T>(sql, params))[0] ?? null
  }

  async insert(sql: string, params: unknown[] = []): Promise<number> {
    const withReturning = toPositional(sql.trimEnd()) + ' RETURNING id'
    const rows = await this.sql.unsafe(withReturning, params as postgres.ParameterOrJSON<never>[])
    return (rows[0] as unknown as { id: number }).id
  }

  async exec(sql: string, params: unknown[] = []): Promise<number> {
    const result = await this.sql.unsafe(toPositional(sql), params as postgres.ParameterOrJSON<never>[])
    return result.count
  }

  async execRaw(sql: string): Promise<void> {
    await this.sql.unsafe(sql)
  }

  async transaction<T>(fn: (tx: DBDriver) => Promise<T>): Promise<T> {
    return fn(this)
  }

  async ensureSchema(): Promise<void> { }
  async close(): Promise<void> { }
}
