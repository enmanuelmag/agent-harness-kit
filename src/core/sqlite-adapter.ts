import { createRequire } from 'node:module'

const _require = createRequire(import.meta.url)
const isBun = 'bun' in process.versions

// ─── Shared interface ─────────────────────────────────────────────────────────
// Both node:sqlite (DatabaseSync) and bun:sqlite (Database) expose this surface.

export type SQLRow = Record<string, unknown>

export interface SQLStatement {
  run(...args: unknown[]): unknown
  get(...args: unknown[]): SQLRow | undefined
  all(...args: unknown[]): SQLRow[]
}

export interface SQLiteDB {
  exec(sql: string): void
  prepare(sql: string): SQLStatement
  close(): void
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function openSQLite(path: string): SQLiteDB {
  if (isBun) {
    const { Database } = _require('bun:sqlite') as {
      Database: new (path: string) => unknown
    }
    return new Database(path) as unknown as SQLiteDB
  }

  const { DatabaseSync } = _require('node:sqlite') as {
    DatabaseSync: new (path: string) => unknown
  }
  return new DatabaseSync(path) as unknown as SQLiteDB
}

// ─── last_insert_rowid() helper ───────────────────────────────────────────────
// Both bun:sqlite and node:sqlite have different return types for stmt.run().
// Reading last_insert_rowid() directly avoids the inconsistency.

export function lastInsertId(db: SQLiteDB): number {
  const row = db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }
  return row.id
}
