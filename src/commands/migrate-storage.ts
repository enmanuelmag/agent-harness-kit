import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import pc from 'picocolors'

import { loadConfig } from '@/core/config'
import {
  DEFAULT_MARKDOWN_PATH,
  DEFAULT_SQLITE_PATH,
  type FullExport,
  getRowCounts,
  isEmptyDatabase,
  openDB,
  readStorageStateFile,
  resolveGlobalStorageDir,
  resolveSqlitePathForScope,
} from '@/core/db'

import type { DatabaseConfig, HarnessConfig } from '@/types'

export interface MigrateStorageOptions {
  force?: boolean
  dryRun?: boolean
}

type DbType = DatabaseConfig['type']

function log(msg: string): void {
  console.log(msg)
}

/** Aborts the current migration by throwing — callers (the CLI action
 *  handler) are responsible for printing the message and exiting non-zero.
 *  Throwing (rather than calling process.exit here) keeps this module
 *  testable without killing the test process. */
function fail(msg: string): never {
  throw new Error(msg)
}

/** The relative markdown-fallback path to use as the base for
 *  `currentMdPathForScope()` below. Mirrors `defaultSqlitePathForConfig()` —
 *  `LocalStorageConfig.markdownFallback.path` only exists (and only means
 *  anything) when `config.storage.scope === 'local'`; for a config CURRENTLY
 *  in scope='global' there's no field to read a custom path from, so this
 *  always falls back to `DEFAULT_MARKDOWN_PATH` in that case. */
function defaultMarkdownPathForConfig(config: HarnessConfig): string {
  return config.storage.scope === 'local' ? config.storage.markdownFallback.path : DEFAULT_MARKDOWN_PATH
}

/** Physical location of a project's harness `current.md`, following the same
 *  scope convention `HarnessDB.regenerateCurrentMd()` uses. */
function currentMdPathForScope(scope: 'local' | 'global', config: HarnessConfig, cwd: string, homeDir: string): string {
  return scope === 'global'
    ? join(resolveGlobalStorageDir(config, homeDir), 'current.md')
    : resolve(cwd, defaultMarkdownPathForConfig(config))
}

/** The relative sqlite path override to use as the base for
 *  `resolveSqlitePathForScope()` calls in this file. `LocalStorageConfig.sqlitePath`
 *  only exists (and only means anything) when `config.storage.scope ===
 *  'local'` — for a config CURRENTLY in scope='global', there is no field to
 *  read a custom local filename from at all, so this always falls back to
 *  `DEFAULT_SQLITE_PATH` in that case.
 *
 *  Known UX tradeoff (accepted, see task #56 consultant advisory): a custom
 *  local sqlite filename (`storage.sqlitePath`) does NOT survive a
 *  global -> local round trip — migrating back to local always lands at
 *  `DEFAULT_SQLITE_PATH` unless the user re-sets `storage.sqlitePath`
 *  afterward. This is a deliberate consequence of making `sqlitePath`
 *  local-only in the type system (see StorageConfig in src/types.ts) rather
 *  than leaving it unenforceable across scopes. */
function defaultSqlitePathForConfig(config: HarnessConfig): string {
  return config.storage.scope === 'local' && config.database.type === 'sqlite'
    ? (config.storage.sqlitePath ?? DEFAULT_SQLITE_PATH)
    : DEFAULT_SQLITE_PATH
}

/** Backs up the destination's current content (all 6 tables, via
 *  exportJson()) to a local JSON file BEFORE any destructive `--force`
 *  overwrite. Aborts the whole command (throws) if the backup can't be
 *  written — fail-safe, per task #47 consultant advisory point 2. */
async function backupDestination(cwd: string, storageDir: string, data: FullExport): Promise<string> {
  const backupsDir = resolve(cwd, storageDir, 'backups')
  const path = join(backupsDir, `pre-migrate-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  try {
    mkdirSync(backupsDir, { recursive: true })
    writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf8')
  } catch (err) {
    throw new Error(
      `Could not write destination backup to ${path} (${err instanceof Error ? err.message : String(err)}). ` +
        `Aborting migration WITHOUT touching the destination — nothing was overwritten.`,
    )
  }
  return path
}

/** Copies a sqlite `.db` file (plus WAL/SHM sidecars if present) to a new
 *  path, verifying the copy exists before returning. Does not delete the
 *  original — caller decides when it's safe to remove it. */
function copySqliteFile(srcPath: string, destPath: string): void {
  mkdirSync(dirname(destPath), { recursive: true })
  copyFileSync(srcPath, destPath)
  for (const suffix of ['-wal', '-shm']) {
    if (existsSync(`${srcPath}${suffix}`)) {
      copyFileSync(`${srcPath}${suffix}`, `${destPath}${suffix}`)
    }
  }
  if (!existsSync(destPath)) {
    throw new Error(`Copy verification failed: ${destPath} does not exist after copy.`)
  }
}

export async function runMigrateStorage(
  cwd: string,
  opts: MigrateStorageOptions,
  homeDir: string = homedir(),
): Promise<void> {
  const config = await loadConfig(cwd)
  const storageDir = config.storage.dir
  const state = readStorageStateFile(cwd, storageDir)

  // ── Case: storage-state.json is missing ──────────────────────────────────
  // NEVER treat this as "destination empty, safe to migrate". Probe the real
  // content at both sqlite candidate locations (local + global default
  // paths) before deciding anything. See task #47 consultant advisory pt.6.
  let realScope: 'local' | 'global'
  let realDbType: DbType

  if (!state) {
    const defaultSqlitePath = defaultSqlitePathForConfig(config)
    const localPath = resolveSqlitePathForScope('local', defaultSqlitePath, cwd, config, homeDir)
    const globalPath = resolveSqlitePathForScope('global', defaultSqlitePath, cwd, config, homeDir)

    const localCount = await probeTaskCount(localPath)
    const globalCount = await probeTaskCount(globalPath)

    if (localCount > 0 && globalCount > 0) {
      fail(
        `storage-state.json is missing and BOTH candidate locations have data — ` +
          `local (${localPath}): ${localCount} task(s); global (${globalPath}): ${globalCount} task(s). ` +
          `Refusing to guess which one is authoritative. Resolve manually (inspect both databases) ` +
          `or delete the one that should be discarded, then re-run this command.`,
      )
    }

    if (localCount === 0 && globalCount === 0) {
      // Nothing exists anywhere yet — nothing to migrate. Just record the
      // current (desired) state so future runs have a storage-state.json.
      const db = await openDB(config, cwd, homeDir)
      try {
        await db.writeStorageState(cwd)
      } finally {
        await db.close()
      }
      log(pc.dim('storage-state.json was missing; no data found at either candidate location. Nothing to migrate — state recorded.'))
      return
    }

    // Exactly one candidate has data — self-heal: treat it as the real
    // (source) location without requiring --force, since this isn't a
    // blind guess (only one plausible source exists).
    realScope = localCount > 0 ? 'local' : 'global'
    realDbType = 'sqlite'
    log(
      pc.yellow(
        `storage-state.json was missing. Detected real data at ${realScope} sqlite location ` +
          `(${realScope === 'local' ? localPath : globalPath}) — using it as the migration source.`,
      ),
    )
  } else {
    realScope = state.scope
    realDbType = state.dbType
  }

  const desiredScope = config.storage.scope
  const desiredDbType = config.database.type

  // ── Case 1: everything matches — nothing to migrate ──────────────────────
  if (realScope === desiredScope && realDbType === desiredDbType) {
    log(pc.green(`✓ Storage already matches config (scope=${desiredScope}, database=${desiredDbType}) — nothing to migrate.`))
    return
  }

  // ── Unsupported direction: source was a remote DB ─────────────────────────
  // storage-state.json intentionally never stores connection strings/creds,
  // so we cannot auto-reconnect to a previous remote database. Out of scope
  // for this command — fail safe rather than guess.
  if (realDbType !== 'sqlite') {
    fail(
      `Cannot auto-locate the previous ${realDbType} database — storage-state.json does not retain connection ` +
        `credentials for security. Manually run "ahk export --json" while still connected to the old database ` +
        `(with the old config), then adjust agent-harness-kit.config.ts and re-import. This direction is out of scope for "ahk migrate storage".`,
    )
  }

  // ── Case: scope changes but dbType stays sqlite → move files directly ────
  if (desiredDbType === 'sqlite' && realDbType === 'sqlite') {
    return migrateScopeOnly(cwd, config, homeDir, realScope, desiredScope, opts)
  }

  // ── Case: dbType changes (sqlite -> postgres/mysql, or vice versa is
  //     unsupported above) → full export/import through a transaction ──────
  return migrateAcrossDbType(cwd, config, homeDir, realScope, opts)
}

/** Returns the number of rows in `tasks` at `dbPath`, or 0 if the file
 *  doesn't exist. Never creates the file (existence is checked first) —
 *  probing must not have side effects. */
async function probeTaskCount(dbPath: string): Promise<number> {
  if (!existsSync(dbPath)) return 0
  const { SQLiteDriver } = await import('@/core/drivers/sqlite')
  const driver = new SQLiteDriver(dbPath)
  try {
    await driver.ensureSchema()
    const counts = await getRowCounts(driver)
    return counts.tasks
  } finally {
    await driver.close()
  }
}

// ─── Case: local <-> global, same engine (sqlite) ──────────────────────────

async function migrateScopeOnly(
  cwd: string,
  config: HarnessConfig,
  homeDir: string,
  fromScope: 'local' | 'global',
  toScope: 'local' | 'global',
  opts: MigrateStorageOptions,
): Promise<void> {
  const sqlitePath = defaultSqlitePathForConfig(config)
  const srcDb = resolveSqlitePathForScope(fromScope, sqlitePath, cwd, config, homeDir)
  const destDb = resolveSqlitePathForScope(toScope, sqlitePath, cwd, config, homeDir)
  const srcMd = currentMdPathForScope(fromScope, config, cwd, homeDir)
  const destMd = currentMdPathForScope(toScope, config, cwd, homeDir)

  if (!existsSync(srcDb)) {
    fail(`Source database not found at ${srcDb} (expected ${fromScope} scope) — nothing to move.`)
  }

  const destExists = existsSync(destDb)
  if (destExists) {
    const { SQLiteDriver } = await import('@/core/drivers/sqlite')
    const destDriver = new SQLiteDriver(destDb)
    let destEmpty: boolean
    try {
      await destDriver.ensureSchema()
      destEmpty = await isEmptyDatabase(destDriver)
    } finally {
      await destDriver.close()
    }
    if (!destEmpty && !opts.force) {
      fail(
        `Destination (${toScope}, ${destDb}) already has data. Re-run with --force to overwrite it ` +
          `(a backup of the destination will be written first).`,
      )
    }
    if (!destEmpty && opts.force) {
      // Back up destination content before overwriting.
      const { SQLiteDriver: Driver } = await import('@/core/drivers/sqlite')
      const backupDriver = new Driver(destDb)
      let data: FullExport
      try {
        await backupDriver.ensureSchema()
        const { HarnessDB } = await import('@/core/db')
        // `config` is passed unmodified (not re-scoped to `toScope`) — safe
        // because exportJson() only queries `backupDriver`'s tables and never
        // reads `this.config.storage` at all. Re-scoping here would also no
        // longer type-check cleanly against the StorageConfig discriminated
        // union (task #56) since `sqlitePath` only exists on the 'local'
        // branch.
        const tmpDb = new HarnessDB(backupDriver, config, homeDir)
        data = await tmpDb.exportJson()
      } finally {
        await backupDriver.close()
      }
      const backupPath = await backupDestination(cwd, config.storage.dir, data)
      log(pc.yellow(`  Backed up existing destination data → ${backupPath}`))
    }
  }

  if (opts.dryRun) {
    log(pc.dim(`[dry-run] Would copy ${srcDb} → ${destDb} (scope ${fromScope} → ${toScope}), and move current.md.`))
    return
  }

  copySqliteFile(srcDb, destDb)
  log(pc.green(`✓ Copied database ${srcDb} → ${destDb}`))

  if (existsSync(srcMd)) {
    mkdirSync(dirname(destMd), { recursive: true })
    copyFileSync(srcMd, destMd)
    log(pc.green(`✓ Copied current.md ${srcMd} → ${destMd}`))
  }

  // Only remove the source AFTER the copy is verified in place.
  rmSync(srcDb, { force: true })
  rmSync(`${srcDb}-wal`, { force: true })
  rmSync(`${srcDb}-shm`, { force: true })
  if (existsSync(srcMd) && srcMd !== destMd) rmSync(srcMd, { force: true })

  // Write storage-state ONLY after the move is confirmed successful.
  const db = await openDB(config, cwd, homeDir)
  try {
    await db.writeStorageState(cwd)
  } finally {
    await db.close()
  }

  log(pc.green(`✓ Storage migrated: scope ${fromScope} → ${toScope}`))
}

// ─── Case: database engine changes (sqlite -> postgres/mysql) ─────────────

async function migrateAcrossDbType(
  cwd: string,
  config: HarnessConfig,
  homeDir: string,
  sourceScope: 'local' | 'global',
  opts: MigrateStorageOptions,
): Promise<void> {
  const sqlitePath = defaultSqlitePathForConfig(config)
  const srcPath = resolveSqlitePathForScope(sourceScope, sqlitePath, cwd, config, homeDir)
  if (!existsSync(srcPath)) {
    fail(`Source sqlite database not found at ${srcPath} (expected ${sourceScope} scope) — nothing to migrate.`)
  }

  const { SQLiteDriver } = await import('@/core/drivers/sqlite')
  const srcDriver = new SQLiteDriver(srcPath)
  let sourceData: FullExport
  let sourceCounts: Awaited<ReturnType<typeof getRowCounts>>
  try {
    await srcDriver.ensureSchema()
    sourceCounts = await getRowCounts(srcDriver)
    const { HarnessDB } = await import('@/core/db')
    // `config` is passed unmodified (not re-scoped/re-typed to sqlite) — safe
    // because exportJson() only queries `srcDriver`'s tables and never reads
    // `this.config` at all. See the identical comment above in
    // migrateScopeOnly() for why re-scoping isn't attempted here anymore.
    const srcDb = new HarnessDB(srcDriver, config, homeDir)
    sourceData = await srcDb.exportJson()
  } finally {
    await srcDriver.close()
  }

  // Fail fast: connect to destination before touching anything else.
  let destDb
  try {
    destDb = await openDB(config, cwd, homeDir)
  } catch (err) {
    fail(`Could not connect to destination (${config.database.type}): ${err instanceof Error ? err.message : String(err)}. Verify database configuration.`)
  }

  try {
    const destCounts = await destDb.getRowCounts()
    const destEmpty = Object.values(destCounts).every((n) => n === 0)
    const sourceEmpty = Object.values(sourceCounts).every((n) => n === 0)

    if (!destEmpty) {
      if (!opts.force) {
        const bothHaveData = !sourceEmpty
        fail(
          bothHaveData
            ? `Both source (${sourceCounts.tasks} task(s)) and destination (${config.database.type}, ${destCounts.tasks} task(s)) ` +
                `have data that DIVERGE — this is not a first-time migration. Refusing to auto-merge. ` +
                `Review both manually, or re-run with --force to overwrite the destination (a JSON backup will be written first).`
            : `Destination (${config.database.type}) already has data (${destCounts.tasks} task(s)). ` +
                `Re-run with --force to overwrite it (a backup of the destination will be written first).`,
        )
      }
    }

    if (opts.dryRun) {
      log(
        pc.dim(
          `[dry-run] Would migrate ${sourceCounts.tasks} task(s) from sqlite (${sourceScope}, ${srcPath}) ` +
            `to ${config.database.type}${destEmpty ? '' : ' (destination has data — would back up first, then overwrite)'}.`,
        ),
      )
      return
    }

    let backupPath: string | null = null
    if (!destEmpty && opts.force) {
      const currentDestData = await destDb.exportJson()
      backupPath = await backupDestination(cwd, config.storage.dir, currentDestData)
      log(pc.yellow(`  Backed up existing destination data → ${backupPath}`))
    }

    // Single transaction covers the entire import (and truncate, if any).
    // storage-state is written ONLY after this resolves without throwing.
    await destDb.importFullExport(sourceData, config.database.type, { truncateFirst: !destEmpty })

    await destDb.writeStorageState(cwd)

    log(
      pc.green(
        `✓ Migrated ${sourceData.tasks.length} task(s), ${sourceData.actions.length} action(s) ` +
          `from sqlite (${sourceScope}) → ${config.database.type}.`,
      ),
    )
    if (backupPath) log(pc.dim(`  Destination backup: ${backupPath}`))
    log(pc.yellow(`  Note: the original sqlite file at ${srcPath} was NOT deleted — remove it manually once you've verified the migration.`))
  } finally {
    await destDb.close()
  }
}
