export interface DBDriver {
  /** Run a SELECT or any query returning rows */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
  /** Run a query expected to return at most one row */
  queryOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null>
  /** Run an INSERT and return the auto-generated numeric ID */
  insert(sql: string, params?: unknown[]): Promise<number>
  /** Run an UPDATE/DELETE and return affected row count */
  exec(sql: string, params?: unknown[]): Promise<number>
  /** Run DDL or PRAGMA statements (no return value) */
  execRaw(sql: string): Promise<void>
  /** Run a set of operations in a transaction */
  transaction<T>(fn: (tx: DBDriver) => Promise<T>): Promise<T>
  /** Create tables if they don't exist yet */
  ensureSchema(): Promise<void>
  close(): Promise<void>
}
