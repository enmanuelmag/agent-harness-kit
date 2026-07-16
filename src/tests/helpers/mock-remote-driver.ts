import type { DBDriver } from '@/core/drivers/types'

/**
 * Minimal in-memory driver implementing the `DBDriver` interface, used to
 * exercise the "sqlite -> remote" migration path (task #47) without a real
 * Postgres/MySQL server available in CI (the repo has no existing
 * postgres/mysql test infrastructure — see src/tests/*.test.ts).
 *
 * It intentionally mimics the exact behavior that makes explicit-id
 * migration dangerous on a real Postgres SERIAL / MySQL AUTO_INCREMENT
 * column: inserting a row with an explicit `id` does NOT advance the
 * internal per-table counter — only `resetSequenceTo()` (invoked via the
 * `SELECT setval(pg_get_serial_sequence(...))` statement our code sends
 * through `execRaw`) does. This lets tests assert that
 * `importFullExport()` + its sequence reset step leaves the destination in
 * a state where a subsequent explicit-id-less insert (e.g.
 * `TaskRepository.add()`) never collides with an imported row.
 *
 * Only supports the exact SQL shapes used by src/core/db.ts /
 * src/core/repositories/*.ts — it is not a general SQL engine.
 */
export class MockRemoteDriver implements DBDriver {
  tables: Record<string, Record<string, unknown>[]> = {
    tasks: [],
    task_acceptance: [],
    actions: [],
    action_sections: [],
    action_files: [],
    action_tools: [],
  }

  /** Per-table counter, mimicking a Postgres SERIAL sequence / MySQL
   *  AUTO_INCREMENT counter. Only advances on implicit-id inserts or an
   *  explicit reset (setval-equivalent). */
  private seq: Record<string, number> = {
    tasks: 0,
    task_acceptance: 0,
    action_sections: 0,
    action_files: 0,
    action_tools: 0,
  }

  private txDepth = 0

  async ensureSchema(): Promise<void> {}
  async reconnect(): Promise<void> {}
  async close(): Promise<void> {}

  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const s = sql.trim()

    let m = s.match(/^SELECT COUNT\(\*\) as n FROM (\w+)$/i)
    if (m) return [{ n: this.tables[m[1]].length } as unknown as T]

    m = s.match(/^SELECT MAX\(id\) as max FROM (\w+)$/i)
    if (m) {
      const rows = this.tables[m[1]]
      const max = rows.length ? Math.max(...rows.map((r) => Number(r.id))) : null
      return [{ max } as unknown as T]
    }

    m = s.match(/^SELECT \* FROM (\w+) WHERE id = \?$/i)
    if (m) {
      const row = this.tables[m[1]].find((r) => r.id === params[0])
      return row ? [row as unknown as T] : []
    }

    m = s.match(/^SELECT \* FROM (\w+) WHERE slug = \?$/i)
    if (m) {
      const row = this.tables[m[1]].find((r) => r.slug === params[0])
      return row ? [row as unknown as T] : []
    }

    throw new Error(`MockRemoteDriver: unsupported query: ${s}`)
  }

  async queryOne<T>(sql: string, params: unknown[] = []): Promise<T | null> {
    const rows = await this.query<T>(sql, params)
    return rows[0] ?? null
  }

  private parseInsert(sql: string): { table: string; cols: string[] } {
    const m = sql.match(/^INSERT INTO (\w+) \(([^)]+)\) VALUES/i)
    if (!m) throw new Error(`MockRemoteDriver: unsupported insert: ${sql}`)
    return { table: m[1], cols: m[2].split(',').map((c) => c.trim()) }
  }

  async insert(sql: string, params: unknown[] = []): Promise<number> {
    const { table, cols } = this.parseInsert(sql)
    const row: Record<string, unknown> = {}
    cols.forEach((c, i) => (row[c] = params[i]))
    if (!('id' in row)) {
      this.seq[table] = (this.seq[table] ?? 0) + 1
      row.id = this.seq[table]
    }
    this.tables[table].push(row)
    return row.id as number
  }

  async exec(sql: string, params: unknown[] = []): Promise<number> {
    const s = sql.trim()

    let m = s.match(/^DELETE FROM (\w+)$/i)
    if (m) {
      const n = this.tables[m[1]].length
      this.tables[m[1]] = []
      return n
    }

    m = s.match(/^INSERT INTO/i)
    if (m) {
      const { table, cols } = this.parseInsert(s)
      const row: Record<string, unknown> = {}
      cols.forEach((c, i) => (row[c] = params[i]))
      this.tables[table].push(row)
      // Explicit-id insert deliberately does NOT advance the sequence —
      // mirrors real Postgres SERIAL / pre-reset MySQL AUTO_INCREMENT risk.
      return 1
    }

    throw new Error(`MockRemoteDriver: unsupported exec: ${s}`)
  }

  async execRaw(sql: string): Promise<void> {
    // Our postgres-dialect sequence reset: SELECT setval(pg_get_serial_sequence('<table>','id'), <n>, true)
    const m = sql.match(/pg_get_serial_sequence\('(\w+)','id'\), (\d+)/)
    if (m) {
      this.seq[m[1]] = Number(m[2])
      return
    }
    // sqlite-dialect statements should never reach a "remote" mock — ignore defensively.
  }

  async transaction<T>(fn: (tx: DBDriver) => Promise<T>): Promise<T> {
    this.txDepth++
    const snapshotTables = JSON.parse(JSON.stringify(this.tables)) as typeof this.tables
    const snapshotSeq = { ...this.seq }
    try {
      const result = await fn(this)
      this.txDepth--
      return result
    } catch (err) {
      this.tables = snapshotTables
      this.seq = snapshotSeq
      this.txDepth--
      throw err
    }
  }
}
