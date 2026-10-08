import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { ActionRepository } from './repositories/ActionRepository'
import { StatsRepository } from './repositories/StatsRepository'
import { TaskRepository } from './repositories/TaskRepository'
import { actionDeniedMessage,canStartAction } from './task-execution-policy'

import type { DBDriver } from './drivers/types'
import type {
  ActionRow,
  ActionSectionRow,
  AgentName,
  HarnessConfig,
  StorageState,
  TaskAcceptanceRow,
  TaskExecutionMode,
  TaskHealthRunRow,
  TaskRepairRow,
  TaskRow,
  TaskStatus,
} from '@/types'

/** Full relational export of persistent task workflow data. */
export interface FullExport {
  tasks: TaskRow[]
  taskAcceptance: TaskAcceptanceRow[]
  actions: ActionRow[]
  sections: ActionSectionRow[]
  healthRuns: TaskHealthRunRow[]
  repairs: TaskRepairRow[]
}

/** Tables with an integer autoincrement/serial primary key, in FK-safe
 *  insertion order (parents before children). Since task #73, `actions.id`
 *  is a driver-generated autoincrement INTEGER (previously an
 *  application-generated UUID/TEXT id, which is why it used to be excluded
 *  from this list) — see src/core/drivers/migrate-actions.ts for the
 *  one-time migration that upgrades a pre-existing DB in place. */
const AUTOINCREMENT_TABLES = [
  'tasks',
  'task_acceptance',
  'actions',
  'action_sections',
  'task_repairs',
] as const

/** Full insertion order across the four workflow tables, respecting FK constraints
 *  (parent before child): tasks -> task_acceptance -> actions ->
 *  action_sections. */
const TABLE_INSERT_ORDER = [
  'tasks',
  'task_acceptance',
  'actions',
  'action_sections',
  'task_health_runs',
  'task_repairs',
] as const

/** Reverse of TABLE_INSERT_ORDER — used to TRUNCATE a non-empty destination
 *  safely (children before parents) when `--force` is used. */
const TABLE_DELETE_ORDER = [...TABLE_INSERT_ORDER].reverse()

// ─── Global storage path resolution ────────────────────────────────────────

/** Default relative sqlite path used whenever `LocalStorageConfig.sqlitePath`
 *  is omitted, and as the fallback filename component for `scope: 'global'`
 *  (which never reads a configured path at all — see resolveSqlitePath()).
 *  Centralized here (task #56) to stop the literal '.harness/harness.db'
 *  from drifting across config.ts/templates.ts/tests. */
export const DEFAULT_SQLITE_PATH = '.harness/harness.db'

/** Resolves the directory used for 'global' scope storage: ~/.harness/dbs/<projectId>/
 *  Uses os.homedir() (not $HOME env var) for portability. Callers are
 *  responsible for creating the directory (mkdirSync recursive) before use. */
export function resolveGlobalStorageDir(
  config: HarnessConfig,
  homeDir: string = homedir()
): string {
  return join(homeDir, '.harness', 'dbs', config.storage.projectId)
}

// ─── DB class ─────────────────────────────────────────────────────────────────

export class HarnessDB {
  readonly tasks: TaskRepository
  readonly actions: ActionRepository
  readonly stats: StatsRepository
  private driver: DBDriver
  private config: HarnessConfig

  constructor(driver: DBDriver, config: HarnessConfig, _homeDir: string = homedir()) {
    this.driver = driver
    this.config = config
    this.tasks = new TaskRepository(driver)
    this.actions = new ActionRepository(driver)
    this.stats = new StatsRepository(driver)
  }

  // ─── Tasks (public facade — delegates to TaskRepository) ──────────────────

  async addTask(params: {
    slug: string
    title: string
    description?: string
    acceptance?: string[]
  }): Promise<TaskRow> {
    const taskId = await this.tasks.add({
      slug: params.slug,
      title: params.title,
      description: params.description,
    })
    if (params.acceptance?.length) {
      await this.tasks.addAcceptance(taskId, params.acceptance)
    }
    return (await this.tasks.getById(taskId))!
  }

  async getTasks(status?: TaskStatus, includeArchived = false): Promise<TaskRow[]> {
    return this.tasks.getAll(status, includeArchived)
  }

  async getTaskById(id: number): Promise<TaskRow | null> {
    return this.tasks.getById(id)
  }

  async getTaskBySlug(slug: string): Promise<TaskRow | null> {
    return this.tasks.getBySlug(slug)
  }

  async getTaskAcceptance(taskId: number): Promise<TaskAcceptanceRow[]> {
    return this.tasks.getAcceptance(taskId)
  }

  async updateTaskStatus(idOrSlug: number | string, status: TaskStatus): Promise<TaskRow> {
    if (status === 'done') {
      throw new Error('Direct completion is forbidden; use the final health verification flow')
    }
    const now = new Date().toISOString()
    const task =
      typeof idOrSlug === 'number'
        ? await this.tasks.getById(idOrSlug)
        : await this.tasks.getBySlug(idOrSlug)
    if (!task) throw new Error(`Task not found: ${idOrSlug}`)

    if (status === 'pending') {
      await this.tasks.release(task.id, now)
    } else if (status === 'in_progress' && !task.started_at) {
      await this.tasks.setStatus(task.id, status, { started_at: now })
    } else {
      await this.tasks.setStatus(task.id, status)
    }

    return (await this.tasks.getById(task.id))!
  }

  /** Atomically closes a task only when this server's recent, post-claim health
   * evidence is still the latest result. Do not replace this with a read then
   * update: a later failed health run must invalidate an earlier pass. */
  async completeTaskWithHealthEvidence(id: number, ttlMs: number, clock = new Date()): Promise<TaskRow | null> {
    const now = clock.toISOString()
    const cutoff = new Date(clock.getTime() - ttlMs).toISOString()
    return this.driver.transaction(async (tx) => {
      const changed = await tx.exec(
        `UPDATE tasks SET status = 'done', execution_mode = 'normal', completed_at = ?, updated_at = ?
         WHERE id = ? AND archived_at IS NULL AND status != 'done'
           AND health_status = 'passed' AND health_started_at > started_at
           AND health_completed_at >= ? AND health_completed_at <= ?`,
        [now, now, id, cutoff, now]
      )
      if (!changed) return null
      const actions = new ActionRepository(tx)
      await actions.closeOrphaned(id, now)
      return new TaskRepository(tx).getById(id)
    })
  }

  async claimTask(id: number, agent: string): Promise<TaskRow | null> {
    const now = new Date().toISOString()
    return this.driver.transaction(async (tx) => {
      // need to create a new TaskRepository instance bound to the transaction
      const txTasks = new TaskRepository(tx)
      const changed = await txTasks.claim(id, agent, now)
      if (!changed) return null
      const task = await txTasks.getById(id)
      if (!task || task.status !== 'in_progress' || task.assigned_to !== agent) return null
      return task
    })
  }

  /** Resolve an automatically or manually run health result without holding a
   * DB transaction while the external script runs. */
  async resolveHealthMode(taskId: number, result: { state: string; runId: string; claimGeneration: number; executionMode: TaskExecutionMode }, phase: 'claim' | 'manual' | 'verify'): Promise<TaskRow | null> {
    const task = await this.getTaskById(taskId)
    if (!task || task.claim_generation !== result.claimGeneration || task.health_run_id !== result.runId || task.execution_mode !== result.executionMode) return null
    const passed = result.state === 'passed'
    let next = task.execution_mode
    if (phase === 'claim') next = passed ? 'normal' : 'blocked'
    else if (phase === 'verify') next = passed ? 'verifying' : ((await this.tasks.getActiveRepair(taskId, task.claim_generation)) ? 'repair' : 'blocked')
    else if (!passed) next = (await this.tasks.getActiveRepair(taskId, task.claim_generation)) ? 'repair' : 'blocked'
    else if (task.execution_mode === 'blocked' || task.execution_mode === 'checking') next = 'normal'
    const changed = await this.tasks.setExecutionMode(taskId, next, result.claimGeneration, new Date().toISOString(), result.executionMode, result.runId)
    return changed ? this.getTaskById(taskId) : null
  }

  async beginRepair(taskId: number, actor: string, reason: string, scope: string): Promise<{ task: TaskRow; repair: TaskRepairRow } | 'duplicate' | null> {
    return this.driver.transaction(async (tx) => {
      const tasks = new TaskRepository(tx)
      const task = await tasks.getById(taskId)
      if (!task || task.archived_at || task.status !== 'in_progress' || task.health_status !== 'failed' || !task.health_run_id)
        return null
      const existing = await tasks.getActiveRepair(taskId, task.claim_generation)
      if (existing) return 'duplicate'
      if (task.execution_mode !== 'blocked') return null
      const failedRun = await tasks.getHealthRun(task.health_run_id)
      if (!failedRun || failedRun.task_id !== taskId || failedRun.claim_generation !== task.claim_generation || failedRun.status !== 'failed') return null
      const now = new Date().toISOString()
      const repairId = await tasks.createRepair({ task_id: taskId, claim_generation: task.claim_generation, failed_health_run_id: task.health_run_id, reason, scope, actor, created_at: now })
      const changed = await tasks.setExecutionMode(taskId, 'repair', task.claim_generation, now, 'blocked', task.health_run_id)
      if (!changed) return null
      const repair = (await tx.queryOne<TaskRepairRow>('SELECT * FROM task_repairs WHERE id = ?', [repairId]))!
      return { task: (await tasks.getById(taskId))!, repair }
    })
  }

  async beginVerification(taskId: number): Promise<TaskRow | null> {
    return this.driver.transaction(async (tx) => {
      const tasks = new TaskRepository(tx)
      const task = await tasks.getById(taskId)
      if (!task || task.archived_at || task.status === 'done') return null
      const changed = await tasks.setExecutionMode(taskId, 'verifying', task.claim_generation, new Date().toISOString(), task.execution_mode)
      return changed ? tasks.getById(taskId) : null
    })
  }

  async finalizeVerifiedTask(taskId: number, result: { state: string; runId: string; claimGeneration: number; executionMode: TaskExecutionMode }): Promise<TaskRow | null> {
    if (result.state !== 'passed') return null
    const now = new Date().toISOString()
    return this.driver.transaction(async (tx) => {
      const tasks = new TaskRepository(tx)
      const task = await tasks.getById(taskId)
      if (!task || task.execution_mode !== 'verifying' || result.executionMode !== 'verifying' || task.claim_generation !== result.claimGeneration || task.health_run_id !== result.runId || task.health_status !== 'passed') return null
      const changed = await tx.exec(`UPDATE tasks SET status = 'done', execution_mode = 'normal', completed_at = ?, updated_at = ? WHERE id = ? AND claim_generation = ? AND execution_mode = 'verifying'`, [now, now, taskId, result.claimGeneration])
      if (!changed) return null
      await tasks.closeActiveRepair(taskId, result.claimGeneration, result.runId, now)
      await new ActionRepository(tx).closeOrphaned(taskId, now)
      return tasks.getById(taskId)
    })
  }

  async markAcceptanceMet(criterionId: number): Promise<void> {
    return this.tasks.markAcceptanceMet(criterionId)
  }

  async updateTask(
    id: number,
    params: { title?: string; description?: string | null; slug?: string }
  ): Promise<TaskRow> {
    await this.tasks.update(id, params)
    return (await this.tasks.getById(id))!
  }

  async updateTaskAcceptance(taskId: number, criteria: string[]): Promise<void> {
    await this.tasks.replaceAcceptance(taskId, criteria)
  }

  async archiveTask(id: number): Promise<TaskRow> {
    await this.tasks.archive(id)
    return (await this.tasks.getById(id))!
  }

  async unarchiveTask(id: number): Promise<TaskRow> {
    await this.tasks.unarchive(id)
    return (await this.tasks.getById(id))!
  }

  async getArchivedTasks(): Promise<TaskRow[]> {
    return this.tasks.getArchived()
  }

  async getStatusSummary(): Promise<{ status: string; total: number }[]> {
    return this.tasks.getStatusSummary()
  }

  // ─── Actions (public facade — delegates to ActionRepository) ──────────────

  async startAction(taskId: number, agent: AgentName): Promise<ActionRow> {
    const now = new Date().toISOString()
    return this.driver.transaction(async (tx) => {
      const tasks = new TaskRepository(tx)
      const task = await tasks.getById(taskId)
      if (!task || task.archived_at) throw new Error(`Task not found: ${taskId}`)
      // Repository callers include import/legacy maintenance flows. External
      // callers are gated in `assertActionCanStart`, shared by MCP/UI adapters.
      if (task.status === 'in_progress' && !canStartAction(task.execution_mode, agent))
        throw new Error(actionDeniedMessage(task.execution_mode, agent))
      const actions = new ActionRepository(tx)
      const id = await actions.create(taskId, agent, now)
      return (await actions.getById(id))!
    })
  }

  async assertActionCanStart(taskId: number, agent: AgentName): Promise<void> {
    const task = await this.getTaskById(taskId)
    if (!task || task.archived_at) throw new Error(`Task not found: ${taskId}`)
    if (task.status !== 'in_progress') throw new Error(`Cannot start an action for task #${taskId} with status '${task.status}'`)
    if (!canStartAction(task.execution_mode, agent)) throw new Error(actionDeniedMessage(task.execution_mode, agent))
  }

  async writeSection(actionId: number, sectionType: string, content: string): Promise<void> {
    const now = new Date().toISOString()
    await this.actions.addSection(actionId, sectionType, content, now)
  }

  async completeAction(actionId: number, summary: string): Promise<ActionRow> {
    const now = new Date().toISOString()
    await this.actions.complete(actionId, summary, now)
    return (await this.actions.getById(actionId))!
  }

  async closeOrphanedActions(taskId: number): Promise<number> {
    const now = new Date().toISOString()
    return this.actions.closeOrphaned(taskId, now)
  }

  async getAction(actionId: number): Promise<ActionRow | null> {
    return this.actions.getById(actionId)
  }

  async getActionsForTask(taskId: number): Promise<ActionRow[]> {
    return this.actions.getForTask(taskId)
  }

  async listActionsForTask(
    taskId: number,
    options: {
      agent?: AgentName
      status?: ActionRow['status']
      cursor?: { createdAt: string; id: number }
      limit: number
    }
  ) {
    return this.actions.listForTask(taskId, options)
  }

  async getActionSections(actionId: number): Promise<ActionSectionRow[]> {
    return this.actions.getSections(actionId)
  }

  async getActionSection(sectionId: number): Promise<ActionSectionRow | null> {
    return this.actions.getSectionById(sectionId)
  }

  async listActionSections(
    actionId: number,
    options: { types?: string[]; cursor?: number; limit: number }
  ) {
    return this.actions.listSections(actionId, options)
  }

  async getCompletedHandoffSections(taskId: number) {
    return this.actions.getCompletedHandoffSections(taskId)
  }

  // ─── Raw query escape hatch ───────────────────────────────────────────────

  async queryRaw<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]> {
    return this.driver.query<T>(sql, params)
  }

  // ─── Export helpers ───────────────────────────────────────────────────────

  /** Full relational export of tasks, acceptance criteria, actions, and sections. */
  async exportJson(): Promise<FullExport> {
    return {
      tasks: await this.tasks.getAll(undefined, true),
      taskAcceptance: await this.tasks.getAllAcceptance(),
      actions: await this.actions.getAll(),
      sections: await this.actions.getAllSections(),
      healthRuns: await this.driver.query<TaskHealthRunRow>('SELECT * FROM task_health_runs ORDER BY started_at, id'),
      repairs: await this.driver.query<TaskRepairRow>('SELECT * FROM task_repairs ORDER BY id'),
    }
  }

  /** Row counts for all four workflow tables against THIS db's driver — used to decide
   *  whether a destination is "empty" (safe to import into directly) before
   *  a migration. Counts are queried directly (COUNT(*)), never inferred
   *  from storage-state.json. */
  async getRowCounts(): Promise<Record<(typeof TABLE_INSERT_ORDER)[number], number>> {
    return getRowCounts(this.driver)
  }

  /** Imports a full export into THIS db's driver — see standalone
   *  `importFullExport()` for the transactional/rollback/sequence-reset
   *  guarantees. `dbType` must match `this.config.database.type`. */
  async importFullExport(
    data: FullExport,
    dbType: 'sqlite' | 'postgres' | 'mysql',
    opts?: { truncateFirst: boolean }
  ): Promise<void> {
    return importFullExport(this.driver, data, dbType, opts)
  }

  async reconnect(): Promise<void> {
    await this.driver.reconnect()
  }

  async close(): Promise<void> {
    await this.driver.close()
  }

  // ─── storage-state.json (real storage state, for `ahk migrate storage`) ──

  /** Writes .harness/storage-state.json, ALWAYS project-local regardless of
   *  scope. Reflects the REAL current storage state (scope/projectId/dbType
   *  actually in use right now), as opposed to agent-harness-kit.config.ts
   *  which reflects the DESIRED state. Format is stable — task #47 (ahk
   *  migrate storage) depends on it; do not change field names/shape. */
  async writeStorageState(cwd: string): Promise<void> {
    writeStorageStateFile(cwd, this.config.storage.dir, {
      scope: this.config.storage.scope,
      projectId: this.config.storage.projectId,
      dbType: this.config.database.type,
      migratedAt: new Date().toISOString(),
    })
  }
}

// ─── Full DB migration helpers (task #47 — `ahk migrate storage`) ─────────

/** Row counts for all four workflow tables, queried directly (never inferred). Used to
 *  decide whether a destination DB is "empty" before an sqlite↔remote
 *  migration. */
export async function getRowCounts(
  driver: DBDriver
): Promise<Record<(typeof TABLE_INSERT_ORDER)[number], number>> {
  const counts = {} as Record<(typeof TABLE_INSERT_ORDER)[number], number>
  for (const table of TABLE_INSERT_ORDER) {
    const row = await driver.queryOne<{ n: number }>(`SELECT COUNT(*) as n FROM ${table}`)
    counts[table] = Number(row?.n ?? 0)
  }
  return counts
}

/** True if every workflow table is empty. */
export async function isEmptyDatabase(driver: DBDriver): Promise<boolean> {
  const counts = await getRowCounts(driver)
  return Object.values(counts).every((n) => n === 0)
}

/** Deletes all workflow rows, children-before-parents, so FK
 *  constraints never block the delete. Only ever called immediately before
 *  a `--force` import, inside the same transaction as the import itself —
 *  never on its own. */
async function truncateAllTables(tx: DBDriver): Promise<void> {
  for (const table of TABLE_DELETE_ORDER) {
    await tx.exec(`DELETE FROM ${table}`)
  }
}

/** Re-synchronizes the destination's internal autoincrement/serial counter
 *  with the highest id actually present, AFTER inserting rows with explicit
 *  ids. Required because inserting explicit ids does NOT advance
 *  Postgres SERIAL sequences or SQLite's `sqlite_sequence` table — without
 *  this, the first unrelated `INSERT ... (no id)` after a migration (e.g.
 *  `tasksRepository.add()`) would collide with an imported id.
 *  MySQL AUTO_INCREMENT advances automatically on explicit-id inserts
 *  greater than the current counter — no action needed there. */
export async function resetAutoincrementSequences(
  tx: DBDriver,
  dbType: 'sqlite' | 'postgres' | 'mysql'
): Promise<void> {
  if (dbType === 'mysql') return // AUTO_INCREMENT self-advances on explicit-id insert — verified in tests.

  for (const table of AUTOINCREMENT_TABLES) {
    const row = await tx.queryOne<{ max: number | null }>(`SELECT MAX(id) as max FROM ${table}`)
    const max = row?.max
    if (!max) continue // table stayed empty — nothing to advance

    if (dbType === 'postgres') {
      await tx.execRaw(`SELECT setval(pg_get_serial_sequence('${table}','id'), ${max}, true)`)
    } else {
      // sqlite: sqlite_sequence only gets a row once a real AUTOINCREMENT
      // insert happens; explicit-id inserts bypass that, so upsert it.
      await tx.execRaw(
        `INSERT INTO sqlite_sequence (name, seq) SELECT '${table}', ${max} WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = '${table}')`
      )
      await tx.execRaw(`UPDATE sqlite_sequence SET seq = ${max} WHERE name = '${table}'`)
    }
  }
}

/** Imports a full workflow export into `destDriver`, preserving
 *  original ids (required to keep foreign keys intact — see task #47
 *  consultant advisory). The ENTIRE import (and, when `truncateFirst` is
 *  set, the pre-import wipe) runs inside a single `destDriver.transaction()`
 *  call: if anything fails partway, the whole operation rolls back and the
 *  destination is left exactly as it was found.
 *
 *  Callers MUST only mark the migration successful (e.g. call
 *  `db.writeStorageState()`) AFTER this promise resolves without throwing —
 *  never inside the transaction callback, never in a `finally`. */
export async function importFullExport(
  destDriver: DBDriver,
  data: FullExport,
  destDbType: 'sqlite' | 'postgres' | 'mysql',
  opts: { truncateFirst: boolean } = { truncateFirst: false }
): Promise<void> {
  // Task #73: actions.id moved from a UUID/TEXT id to an autoincrement
  // INTEGER. An export produced by a pre-2.0 build still carries string
  // action ids, which would otherwise fail deep inside the transaction below
  // with a raw, confusing driver error (a datatype mismatch on sqlite's
  // INTEGER PRIMARY KEY rowid alias, or a hard insert error on postgres/
  // mysql). Fail fast with a clear, actionable message instead.
  if (data.actions.some((a) => typeof (a as { id: unknown }).id !== 'number')) {
    throw new Error(
      'This export was produced by an older version of agent-harness-kit (actions used text/UUID ids, pre-2.0) and ' +
        'cannot be imported into a database using the current integer-id actions schema. Re-exporting from the old build ' +
        'is the only way to fix this — importing this file as-is is not supported.'
    )
  }

  await destDriver.transaction(async (tx) => {
    if (opts.truncateFirst) {
      await truncateAllTables(tx)
    }

    for (const task of data.tasks) {
      await tx.exec(
        `INSERT INTO tasks (id, slug, title, description, status, assigned_to, created_at, started_at, completed_at, archived_at, updated_at, health_run_id, health_status, health_started_at, health_completed_at, health_log_path, health_script_path, execution_mode, claim_generation) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          task.id,
          task.slug,
          task.title,
          task.description,
          task.status,
          task.assigned_to,
          task.created_at,
          task.started_at,
          task.completed_at,
          task.archived_at,
          task.updated_at,
          task.health_run_id ?? null,
          task.health_status ?? null,
          task.health_started_at ?? null,
          task.health_completed_at ?? null,
          task.health_log_path ?? null,
          task.health_script_path ?? null,
          task.execution_mode ?? 'normal',
          task.claim_generation ?? 0,
        ]
      )
    }

    for (const ta of data.taskAcceptance) {
      await tx.exec(
        `INSERT INTO task_acceptance (id, task_id, criterion, met) VALUES (?, ?, ?, ?)`,
        [ta.id, ta.task_id, ta.criterion, ta.met]
      )
    }

    for (const action of data.actions) {
      await tx.exec(
        `INSERT INTO actions (id, task_id, agent, status, created_at, completed_at, summary) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          action.id,
          action.task_id,
          action.agent,
          action.status,
          action.created_at,
          action.completed_at,
          action.summary,
        ]
      )
    }

    for (const section of data.sections) {
      await tx.exec(
        `INSERT INTO action_sections (id, action_id, section_type, content, created_at) VALUES (?, ?, ?, ?, ?)`,
        [section.id, section.action_id, section.section_type, section.content, section.created_at]
      )
    }

    for (const run of data.healthRuns ?? []) {
      await tx.exec(
        `INSERT INTO task_health_runs (id, task_id, claim_generation, execution_mode, status, started_at, completed_at, log_path, script_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [run.id, run.task_id, run.claim_generation, run.execution_mode, run.status, run.started_at, run.completed_at, run.log_path, run.script_path]
      )
    }

    for (const repair of data.repairs ?? []) {
      await tx.exec(
        `INSERT INTO task_repairs (id, task_id, claim_generation, failed_health_run_id, reason, scope, actor, created_at, closed_at, final_health_run_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [repair.id, repair.task_id, repair.claim_generation, repair.failed_health_run_id, repair.reason, repair.scope, repair.actor, repair.created_at, repair.closed_at, repair.final_health_run_id]
      )
    }

    await resetAutoincrementSequences(tx, destDbType)
  })
}

/** Resolves the physical sqlite file path for a given scope, sharing the
 *  exact convention `openDB()` uses — extracted so `ahk migrate storage` can
 *  locate the OLD file (by scope) without duplicating path logic. Does not
 *  create any directories or files. */
export function resolveSqlitePathForScope(
  scope: 'local' | 'global',
  sqlitePath: string,
  cwd: string,
  config: HarnessConfig,
  homeDir: string
): string {
  return scope === 'global'
    ? join(resolveGlobalStorageDir(config, homeDir), 'harness.db')
    : resolve(cwd, sqlitePath)
}

/** Resolves the physical sqlite file path for `config`'s OWN current scope
 *  (as opposed to `resolveSqlitePathForScope`, which resolves an arbitrary
 *  scope — used by `ahk migrate storage` to probe both candidates). This is
 *  the single mandatory entry point every call site should use instead of
 *  reading `config.database`/`config.storage.sqlitePath` directly — routing
 *  everything through here is what keeps new call sites from re-introducing
 *  the "reads a local-only field while scope=global" bug class (task #55/#56). */
export function resolveSqlitePath(
  config: HarnessConfig,
  cwd: string,
  homeDir: string = homedir()
): string {
  const sqlitePath =
    config.storage.scope === 'local'
      ? (config.storage.sqlitePath ?? DEFAULT_SQLITE_PATH)
      : DEFAULT_SQLITE_PATH
  return resolveSqlitePathForScope(config.storage.scope, sqlitePath, cwd, config, homeDir)
}

/** Writes `<storageDir>/storage-state.json` under `cwd`. Standalone (not tied
 *  to a live HarnessDB instance) so it can be called during init before a DB
 *  connection exists, and reused by future migration tooling. */
export function writeStorageStateFile(cwd: string, storageDir: string, state: StorageState): void {
  const path = join(resolve(cwd), storageDir, 'storage-state.json')
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(state, null, 2) + '\n', 'utf8')
}

/** Reads `<storageDir>/storage-state.json` under `cwd`. Returns `null` if it
 *  doesn't exist or is malformed. Used by future migration tooling (#47) to
 *  determine the real current storage state before migrating. */
export function readStorageStateFile(cwd: string, storageDir: string): StorageState | null {
  try {
    const path = join(resolve(cwd), storageDir, 'storage-state.json')
    if (!existsSync(path)) return null
    return JSON.parse(readFileSync(path, 'utf8')) as StorageState
  } catch {
    return null
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export async function openDB(
  config: HarnessConfig,
  cwd: string,
  homeDir: string = homedir()
): Promise<HarnessDB> {
  const dbConfig = config.database
  let driver: DBDriver

  if (dbConfig.type === 'postgres') {
    const { PostgresDriver } = await import('./drivers/postgres')
    driver = new PostgresDriver(dbConfig)
  } else if (dbConfig.type === 'mysql') {
    const { MySQLDriver } = await import('./drivers/mysql')
    driver = new MySQLDriver(dbConfig)
  } else {
    const { SQLiteDriver } = await import('./drivers/sqlite')
    if (dbConfig.type !== 'sqlite') {
      throw new Error('Invalid database type')
    }

    let dbPath: string
    if (config.storage.scope === 'global') {
      const globalDir = resolveGlobalStorageDir(config, homeDir)
      // Defensive check: a UUID collision is negligible, but if the target
      // dir already exists with a DIFFERENT project's state, don't silently
      // reuse it — surface the conflict instead of assuming it's free.
      const existingStatePath = join(globalDir, 'storage-state.json')
      if (existsSync(existingStatePath)) {
        try {
          const existingState = JSON.parse(readFileSync(existingStatePath, 'utf8')) as StorageState
          if (existingState.projectId !== config.storage.projectId) {
            throw new Error(
              `Global storage dir ${globalDir} already holds a different project (projectId: ${existingState.projectId}). Refusing to reuse it.`
            )
          }
        } catch (err) {
          if (err instanceof Error && err.message.includes('already holds a different project'))
            throw err
          // Malformed/unreadable state file — ignore and proceed, mkdirSync below is idempotent.
        }
      }
      mkdirSync(globalDir, { recursive: true })
      dbPath = join(globalDir, 'harness.db')
    } else {
      dbPath = resolve(cwd, config.storage.sqlitePath ?? DEFAULT_SQLITE_PATH)
    }

    driver = new SQLiteDriver(dbPath)
  }

  await driver.ensureSchema()
  return new HarnessDB(driver, config, homeDir)
}
