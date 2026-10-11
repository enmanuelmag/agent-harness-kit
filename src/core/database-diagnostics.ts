import { AsyncLocalStorage } from 'node:async_hooks'
import { stat } from 'node:fs/promises'

import type { DBDriver } from './drivers/types'
import type { OperationalNotice } from './operational-notices'

export interface DatabaseDiagnosticsConfig {
  enabled?: boolean
  slowMs?: number
  windowMs?: number
  minSamples?: number
  minSlow?: number
  slowFraction?: number
  cooldownMs?: number
}
const defaults = {
  enabled: true,
  slowMs: 500,
  windowMs: 300_000,
  minSamples: 10,
  minSlow: 3,
  slowFraction: 0.2,
  cooldownMs: 600_000,
}
export function normalizeDatabaseDiagnostics(raw: unknown): typeof defaults {
  const value = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const bounded = (key: keyof typeof defaults, min: number, max: number, integer = false) => {
    const n = value[key]
    return typeof n === 'number' &&
      Number.isFinite(n) &&
      n >= min &&
      n <= max &&
      (!integer || Number.isInteger(n))
      ? n
      : (defaults[key] as number)
  }
  return {
    enabled: value.enabled !== false,
    slowMs: bounded('slowMs', 1, 60_000),
    windowMs: bounded('windowMs', 1_000, 3_600_000),
    minSamples: bounded('minSamples', 1, 128, true),
    minSlow: bounded('minSlow', 1, 128, true),
    slowFraction: bounded('slowFraction', 0.01, 1),
    cooldownMs: bounded('cooldownMs', 1_000, 86_400_000),
  }
}
const cliSink = new AsyncLocalStorage<(notice: OperationalNotice) => void>()
/** Command-scoped sink holds no connections and never writes from a driver. */
export function withDatabaseNoticeSink<T>(
  sink: (notice: OperationalNotice) => void,
  operation: () => Promise<T>
): Promise<T> {
  return cliSink.run(sink, operation)
}
export function currentDatabaseNoticeSink() {
  return cliSink.getStore()
}
const historyAdvice =
  'Review history retention and plan any bulk cleanup manually after preserving needed history. Archiving hides rows and does not shrink storage.'
export class DatabaseDiagnostics {
  private samples: { at: number; elapsed: number }[] = []
  private lastNotice = -Infinity
  private cached?: { at: number; notice: OperationalNotice; oldCount?: number }
  private pending?: Promise<OperationalNotice>
  readonly settings: typeof defaults
  constructor(
    raw?: unknown,
    private clock = () => performance.now(),
    private wallClock = () => new Date()
  ) {
    this.settings = normalizeDatabaseDiagnostics(raw)
  }
  wrap(driver: DBDriver): DBDriver {
    const timed = async <T>(operation: () => Promise<T>): Promise<T> => {
      let start: number | undefined
      try {
        if (this.settings.enabled) start = this.clock()
      } catch {
        /* advisory only */
      }
      try {
        return await operation()
      } finally {
        try {
          if (start !== undefined) {
            const at = this.clock()
            this.samples.push({ at, elapsed: Math.max(0, at - start) })
            this.prune(at)
          }
        } catch {
          /* never replace an operation result or rejection */
        }
      }
    }
    return {
      query: (sql, params) => timed(() => driver.query(sql, params)),
      queryOne: (sql, params) => timed(() => driver.queryOne(sql, params)),
      insert: (sql, params) => timed(() => driver.insert(sql, params)),
      exec: (sql, params) => timed(() => driver.exec(sql, params)),
      execRaw: (sql) => timed(() => driver.execRaw(sql)),
      transaction: (fn) => driver.transaction((tx) => fn(this.wrap(tx))),
      ensureSchema: () => driver.ensureSchema(),
      reconnect: () => driver.reconnect(),
      close: () => driver.close(),
    }
  }
  private prune(now: number) {
    this.samples = this.samples
      .filter((sample) => now - sample.at <= this.settings.windowMs)
      .slice(-128)
  }
  takeNotice(): OperationalNotice | undefined {
    try {
      if (!this.settings.enabled) return
      const now = this.clock()
      this.prune(now)
      const slow = this.samples.filter((sample) => sample.elapsed >= this.settings.slowMs).length
      if (
        this.samples.length < this.settings.minSamples ||
        slow < this.settings.minSlow ||
        slow / this.samples.length < this.settings.slowFraction ||
        now - this.lastNotice < this.settings.cooldownMs
      )
        return
      this.lastNotice = now
      const history =
        this.cached && now - this.cached.at < 300_000 && (this.cached.oldCount ?? 0) >= 1000
      return {
        code: 'database-sustained-latency',
        severity: 'info',
        scope: 'database',
        message:
          `Recent database calls were repeatedly slow (${slow}/${this.samples.length} calls >=${this.settings.slowMs}ms within ${this.settings.windowMs}ms). Review connectivity and query workload.` +
          (history
            ? ' At least 1,000 completed tasks are older than 90 days. ' + historyAdvice
            : ''),
        details: {
          samples: String(this.samples.length),
          slowCalls: String(slow),
          slowMs: String(this.settings.slowMs),
          windowMs: String(this.settings.windowMs),
          maxMs: String(Math.max(...this.samples.map((sample) => sample.elapsed))),
        },
      }
    } catch {
      return undefined
    }
  }
  async inspect(driver: DBDriver, sqlitePath?: string): Promise<OperationalNotice> {
    const unavailable: OperationalNotice = {
      code: 'database-diagnostics',
      severity: 'info',
      scope: 'database',
      message: 'Optional database diagnostics are unavailable.',
    }
    if (!this.settings.enabled)
      return { ...unavailable, message: 'Database diagnostics are disabled.' }
    let ownsProbe = false
    try {
      const now = this.clock()
      if (this.cached && now - this.cached.at < 300_000) return this.cached.notice
      if (this.pending) return this.pending
      ownsProbe = true
      this.pending = (async () => {
        let oldCount: number | undefined
        try {
          const cutoff = new Date(this.wallClock().getTime() - 90 * 86_400_000).toISOString()
          const row = await driver.queryOne<{ count: number | string }>(
            "SELECT COUNT(*) AS count FROM tasks WHERE status = 'done' AND completed_at IS NOT NULL AND completed_at < ?",
            [cutoff]
          )
          const count = row?.count === null || row?.count === undefined ? NaN : Number(row.count)
          if (Number.isSafeInteger(count) && count >= 0) oldCount = count
        } catch {
          /* history is unknown, never infer it */
        }
        const details: Record<string, string> = {
          measuredAt: this.wallClock().toISOString(),
          oldCompletedTasks: oldCount === undefined ? 'unknown' : String(oldCount),
          storageBytes: 'unknown',
        }
        if (sqlitePath) {
          try {
            const main = await stat(sqlitePath)
            let wal = 0
            try {
              wal = (await stat(sqlitePath + '-wal')).size
            } catch {
              /* WAL optional */
            }
            details.storageBytes = String(main.size + wal)
          } catch {
            /* storage context optional */
          }
        }
        const notice: OperationalNotice = {
          code: 'database-diagnostics',
          severity: 'info',
          scope: 'database',
          message:
            oldCount === undefined
              ? unavailable.message
              : `${oldCount} completed tasks are older than 90 days (including archived history).` +
                (oldCount >= 1000 ? ' ' + historyAdvice : ''),
          details,
        }
        this.cached = { at: this.clock(), notice, oldCount }
        return notice
      })()
      return await this.pending
    } catch {
      return unavailable
    } finally {
      if (ownsProbe) this.pending = undefined
    }
  }
}
