import { resetAutoincrementSequences } from '../db'

import type { DBDriver } from './types'

/** Suffix used to rename the pre-migration (UUID/TEXT id) `actions` table
 *  and its 3 FK children out of the way while the new autoincrement-INTEGER
 *  shape is created and populated. Also the marker `resumeIfInterrupted()`
 *  looks for on every startup, so a migration interrupted mid-way (crash,
 *  kill -9 — a real risk on MySQL, whose DDL isn't transactional) is
 *  detected and cleanly retried rather than silently left half-done. */
const OLD_SUFFIX = '_old_v2migration'

const ACTION_TABLES = ['actions', 'action_sections', 'action_files', 'action_tools'] as const
const CHILD_TABLES = ['action_sections', 'action_files', 'action_tools'] as const

type DbType = 'sqlite' | 'postgres' | 'mysql'

function oldName(table: string): string {
  return `${table}${OLD_SUFFIX}`
}

/** Task #73: migrates `actions.id` (and every `action_id` FK) from a
 *  TEXT/VARCHAR UUID primary key to an autoincrement INTEGER one, preserving
 *  every existing row — `.harness/harness.db` is this tool's source of
 *  truth, so a silent reset is not acceptable here. Runs automatically
 *  inside `ensureSchema()` on every server start (same trigger point as the
 *  archived_at/updated_at column migrations already in each driver) and is
 *  idempotent — a DB already on the new shape is a fast no-op.
 *
 *  A plain `ALTER TABLE ... ALTER COLUMN TYPE` isn't possible: existing ids
 *  are UUID strings, not castable to integer. This instead does the classic
 *  rename-old / recreate-new / copy-remapped / drop-old dance, building the
 *  UUID -> sequential-integer mapping in application memory (this is a
 *  single project's local action log — small enough that this is simpler
 *  and safer than a pure-SQL remap per engine).
 *
 *  `schemaSql` is the driver's own SCHEMA constant (same string ensureSchema
 *  already runs at startup) — reused both to type-detect the `actions.id`
 *  column and to recreate the 4 action tables (+ their indexes) once the old
 *  ones are renamed away; the CREATE TABLE/INDEX IF NOT EXISTS statements
 *  for tasks/task_acceptance in it are no-ops since those tables are
 *  untouched by this migration. */
export async function migrateActionsToIntegerIds(
  driver: DBDriver,
  dbType: DbType,
  schemaSql: string
): Promise<void> {
  await resumeIfInterrupted(driver, dbType)

  if (!(await needsMigration(driver, dbType))) return

  console.log(
    '[agent-harness-kit] Migrating actions table to integer ids (one-time, automatic) — do not interrupt.'
  )

  if (dbType === 'mysql') {
    // MySQL DDL (RENAME/CREATE/DROP TABLE) auto-commits statement-by-statement,
    // so wrapping this in a transaction would be a false guarantee, not a real
    // one. Safety instead comes from resumeIfInterrupted() above, which
    // detects and cleanly retries a migration a crash left half-done.
    await runMigration(driver, dbType, schemaSql)
  } else {
    await driver.transaction((tx) => runMigration(tx, dbType, schemaSql))
  }
}

/** Detects leftover `*_old_v2migration` tables from a migration interrupted
 *  mid-way. Checked uniformly on every engine for one consistent, testable
 *  code path, though it's a hard requirement (not just hygiene) for MySQL
 *  specifically, since its DDL isn't transactional.
 *
 *  IMPORTANT: the rename-away step (2) and the old-table-drop step (6) are
 *  each a loop of 4 *separate*, non-atomic DDL statements — a crash can
 *  leave any subset of the 4 `_old_v2migration` tables present. This must
 *  NOT assume "if `actions_old_v2migration` exists, all 4 do" (that was the
 *  original, buggy version of this function — see task #73 review). Two
 *  concrete failure modes that assumption caused:
 *   1. Crash mid-rename (only `actions` renamed so far) — the other 3
 *      tables are still LIVE under their original names with real data.
 *      Unconditionally dropping "whatever sits under the live names" would
 *      destroy that live data with no backup to restore from.
 *   2. Crash mid-cleanup (children's `_old` tables already dropped,
 *      `actions_old_v2migration` not yet dropped) — the live child tables
 *      at that point already hold the fully-migrated, correct data.
 *      Unconditionally dropping them (because `actions_old_v2migration`
 *      still exists) would destroy that data with no `_old` counterpart
 *      left to restore from.
 *
 *  Correct recovery strategy, decided per table AND checked for
 *  data-copy-completeness before touching anything:
 *   - If, for every table that still has an `_old` backup, the LIVE table
 *     already holds exactly as many rows as its `_old` backup (i.e. the
 *     copy step fully finished before the crash — we were interrupted only
 *     during cleanup), the `_old` tables are pure leftovers: drop them and
 *     touch nothing else.
 *   - Otherwise (at least one table's copy is missing or partial), this is
 *     an all-or-nothing redo: for every table that has an intact `_old`
 *     backup, drop whatever (possibly partial, possibly nonexistent) live
 *     table sits under the real name and restore the backup, so the
 *     migration below redoes the whole thing cleanly from scratch. A table
 *     that was never renamed away (no `_old` counterpart at all) is left
 *     completely untouched — it is never safe to drop a live table we have
 *     no backup for. */
async function resumeIfInterrupted(driver: DBDriver, dbType: DbType): Promise<void> {
  const leftoverTables: string[] = []
  for (const table of ACTION_TABLES) {
    if (await tableExists(driver, dbType, oldName(table))) leftoverTables.push(table)
  }
  if (leftoverTables.length === 0) return

  console.log(
    '[agent-harness-kit] Detected leftover tables from an interrupted actions-table migration — resuming.'
  )

  if (await migrationDataComplete(driver, dbType, leftoverTables)) {
    // Every table with a surviving `_old` backup already has its full copy
    // live — we crashed only during step-6 cleanup. Finish dropping the
    // leftovers; never touch the (already correct) live tables.
    for (const table of leftoverTables) {
      await driver.execRaw(`DROP TABLE IF EXISTS ${oldName(table)}`)
    }
    // Cleanup may have been interrupted before the final sequence-sync step
    // too — cheap and idempotent to redo here.
    await resetAutoincrementSequences(driver, dbType)
    return
  }

  // Incomplete copy somewhere — safe all-or-nothing redo: only ever touch a
  // table that has an intact `_old` backup to fall back to.
  for (const table of leftoverTables) {
    await driver.execRaw(`DROP TABLE IF EXISTS ${table}`)
    await driver.execRaw(`ALTER TABLE ${oldName(table)} RENAME TO ${table}`)
  }
}

/** True only if, for every table in `tablesWithBackup`, the live table
 *  exists and holds exactly as many rows as its `_old` backup — i.e. the
 *  data-copy steps (4/5) fully completed for all of them before whatever
 *  interrupted the migration. A single incomplete/missing live table makes
 *  this false, which triggers the safe "restore and redo" path instead of
 *  risking treating a partial copy as done. */
async function migrationDataComplete(
  driver: DBDriver,
  dbType: DbType,
  tablesWithBackup: string[]
): Promise<boolean> {
  for (const table of tablesWithBackup) {
    if (!(await tableExists(driver, dbType, table))) return false
    const liveCount = await countRows(driver, table)
    const oldCount = await countRows(driver, oldName(table))
    if (liveCount !== oldCount) return false
  }
  return true
}

async function countRows(driver: DBDriver, table: string): Promise<number> {
  const row = await driver.queryOne<{ count: number }>(`SELECT COUNT(*) as count FROM ${table}`)
  return Number(row?.count ?? 0)
}

async function needsMigration(driver: DBDriver, dbType: DbType): Promise<boolean> {
  if (dbType === 'sqlite') {
    const cols = await driver.query<{ name: string; type: string }>(`PRAGMA table_info(actions)`)
    const idCol = cols.find((c) => c.name === 'id')
    return idCol?.type?.toUpperCase() === 'TEXT'
  }
  if (dbType === 'postgres') {
    const row = await driver.queryOne<{ data_type: string }>(
      `SELECT data_type FROM information_schema.columns WHERE table_name = 'actions' AND column_name = 'id'`
    )
    return row?.data_type === 'text'
  }
  const row = await driver.queryOne<{ data_type: string }>(
    `SELECT DATA_TYPE as data_type FROM information_schema.columns WHERE TABLE_NAME = 'actions' AND COLUMN_NAME = 'id' AND TABLE_SCHEMA = DATABASE()`
  )
  return row?.data_type === 'varchar'
}

async function tableExists(driver: DBDriver, dbType: DbType, table: string): Promise<boolean> {
  if (dbType === 'sqlite') {
    const row = await driver.queryOne<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
      [table]
    )
    return !!row
  }
  if (dbType === 'postgres') {
    const row = await driver.queryOne<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_name = ?`,
      [table]
    )
    return !!row
  }
  const row = await driver.queryOne<{ table_name: string }>(
    `SELECT TABLE_NAME as table_name FROM information_schema.tables WHERE TABLE_NAME = ? AND TABLE_SCHEMA = DATABASE()`,
    [table]
  )
  return !!row
}

interface OldActionRow {
  id: string
  task_id: number
  agent: string
  status: string
  created_at: string
  completed_at: string | null
  summary: string | null
}

async function runMigration(driver: DBDriver, dbType: DbType, schemaSql: string): Promise<void> {
  // 1. Build the UUID -> sequential-integer map, in creation order.
  const oldOrder = await driver.query<{ id: string }>(
    `SELECT id FROM actions ORDER BY created_at, id`
  )
  const idMap = new Map<string, number>()
  oldOrder.forEach((row, i) => idMap.set(row.id, i + 1))

  // 2. Rename the 4 old-shape tables out of the way. MySQL supports a
  //    single multi-table RENAME TABLE statement that it guarantees is
  //    atomic — use it there to close the partial-rename crash window
  //    entirely (MySQL's DDL doesn't auto-commit *within* this one
  //    statement, unlike a loop of 4 separate ALTER TABLE statements).
  //    sqlite/postgres don't support multi-table rename in one statement,
  //    but don't need to: this whole function runs inside `driver.transaction()`
  //    for those two engines (see migrateActionsToIntegerIds above), so a
  //    crash mid-loop there rolls back to nothing-renamed, not partial.
  //    resumeIfInterrupted() above is still the last line of defense on all
  //    engines regardless.
  if (dbType === 'mysql') {
    const renames = ACTION_TABLES.map((table) => `${table} TO ${oldName(table)}`).join(', ')
    await driver.execRaw(`RENAME TABLE ${renames}`)
  } else {
    for (const table of ACTION_TABLES) {
      await driver.execRaw(`ALTER TABLE ${table} RENAME TO ${oldName(table)}`)
    }
  }

  // 3. Recreate them fresh (new INTEGER-id shape) + their indexes, reusing
  //    the driver's own schema definition.
  await applySchema(driver, dbType, schemaSql)

  // 4. Copy `actions` rows with remapped integer ids.
  const oldActions = await driver.query<OldActionRow>(
    `SELECT * FROM ${oldName('actions')} ORDER BY created_at, id`
  )
  for (const row of oldActions) {
    const newId = idMap.get(row.id)!
    await driver.exec(
      `INSERT INTO actions (id, task_id, agent, status, created_at, completed_at, summary) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [newId, row.task_id, row.agent, row.status, row.created_at, row.completed_at, row.summary]
    )
  }

  // 5. Copy the 3 child tables, keeping their own id but remapping action_id.
  await copyChildTable(driver, 'action_sections', idMap, [
    'id',
    'action_id',
    'section_type',
    'content',
    'created_at',
  ])
  await copyChildTable(driver, 'action_files', idMap, [
    'id',
    'action_id',
    'file_path',
    'operation',
    'notes',
  ])
  await copyChildTable(driver, 'action_tools', idMap, [
    'id',
    'action_id',
    'tool_name',
    'args_json',
    'result_summary',
    'called_at',
  ])

  // 6. Drop the old renamed tables — children first so FK constraints never block it.
  for (const table of [...CHILD_TABLES, 'actions']) {
    await driver.execRaw(`DROP TABLE IF EXISTS ${oldName(table)}`)
  }

  // 7. Sync `actions`' autoincrement/serial counter to the ids just inserted
  //    (reuses the exact same logic importFullExport() relies on; harmlessly
  //    re-syncs the other autoincrement tables too — idempotent).
  await resetAutoincrementSequences(driver, dbType)
}

async function copyChildTable(
  driver: DBDriver,
  table: (typeof CHILD_TABLES)[number],
  idMap: Map<string, number>,
  columns: string[]
): Promise<void> {
  const oldRows = await driver.query<Record<string, unknown>>(
    `SELECT * FROM ${oldName(table)} ORDER BY id`
  )
  const placeholders = columns.map(() => '?').join(', ')
  for (const row of oldRows) {
    const newActionId = idMap.get(row.action_id as string)
    if (newActionId === undefined) {
      throw new Error(
        `actions migration: ${table} row ${String(row.id)} references unknown action_id ${String(row.action_id)}`
      )
    }
    const values = columns.map((c) => (c === 'action_id' ? newActionId : row[c]))
    await driver.exec(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`,
      values
    )
  }
}

/** Applies a driver's full multi-statement SCHEMA string. MySQL's mysql2
 *  driver doesn't support multi-statement execution by default, so it must
 *  be split and run statement-by-statement — the identical approach each
 *  driver's own ensureSchema() already uses. */
async function applySchema(driver: DBDriver, dbType: DbType, schemaSql: string): Promise<void> {
  if (dbType === 'mysql') {
    const statements = schemaSql
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)
    for (const stmt of statements) {
      await driver.execRaw(stmt)
    }
  } else {
    await driver.execRaw(schemaSql)
  }
}
