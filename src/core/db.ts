import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { ActionRepository } from './repositories/ActionRepository'
import { StatsRepository } from './repositories/StatsRepository'
import { TaskRepository } from './repositories/TaskRepository'

import type { DBDriver } from './drivers/types'
import type {
  ActionFileRow,
  ActionRow,
  ActionSectionRow,
  ActionToolRow,
  AgentName,
  HarnessConfig,
  StorageState,
  TaskAcceptanceRow,
  TaskRow,
  TaskStatus,
} from '@/types'

/** Full relational export of every table — used by `ahk migrate storage` and
 *  `ahk export --json`. MUST include all 6 tables (tasks, task_acceptance,
 *  actions, action_sections, action_files, action_tools); omitting any of
 *  them silently drops user data during a migration. */
export interface FullExport {
  tasks: TaskRow[]
  taskAcceptance: TaskAcceptanceRow[]
  actions: ActionRow[]
  sections: ActionSectionRow[]
  actionFiles: ActionFileRow[]
  actionTools: ActionToolRow[]
}

/** Tables with an integer autoincrement/serial primary key, in FK-safe
 *  insertion order (parents before children). `actions` is excluded — its id
 *  is an application-generated UUID (TEXT), never autoincrement. */
const AUTOINCREMENT_TABLES = ['tasks', 'task_acceptance', 'action_sections', 'action_files', 'action_tools'] as const

/** Full insertion order across all 6 tables, respecting FK constraints
 *  (parent before child): tasks -> task_acceptance -> actions ->
 *  action_sections/action_files/action_tools. */
const TABLE_INSERT_ORDER = ['tasks', 'task_acceptance', 'actions', 'action_sections', 'action_files', 'action_tools'] as const

/** Reverse of TABLE_INSERT_ORDER — used to TRUNCATE a non-empty destination
 *  safely (children before parents) when `--force` is used. */
const TABLE_DELETE_ORDER = [...TABLE_INSERT_ORDER].reverse()

// ─── Global storage path resolution ────────────────────────────────────────

/** Resolves the directory used for 'global' scope storage: ~/.harness/dbs/<projectId>/
 *  Uses os.homedir() (not $HOME env var) for portability. Callers are
 *  responsible for creating the directory (mkdirSync recursive) before use. */
export function resolveGlobalStorageDir(config: HarnessConfig, homeDir: string = homedir()): string {
  return join(homeDir, '.harness', 'dbs', config.storage.projectId)
}

// ─── DB class ─────────────────────────────────────────────────────────────────

export class HarnessDB {
  readonly tasks: TaskRepository
  readonly actions: ActionRepository
  readonly stats: StatsRepository
  private driver: DBDriver
  private config: HarnessConfig
  /** Overridable home directory, used to keep 'global' scope tests off the real $HOME. */
  private homeDir: string

  constructor(driver: DBDriver, config: HarnessConfig, homeDir: string = homedir()) {
    this.driver = driver
    this.config = config
    this.homeDir = homeDir
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
    await this.regenerateCurrentMd()
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
    const now = new Date().toISOString()
    const task =
      typeof idOrSlug === 'number'
        ? await this.tasks.getById(idOrSlug)
        : await this.tasks.getBySlug(idOrSlug)
    if (!task) throw new Error(`Task not found: ${idOrSlug}`)

    if (status === 'in_progress' && !task.started_at) {
      await this.tasks.setStatus(task.id, status, { started_at: now })
    } else if (status === 'done') {
      await this.tasks.setStatus(task.id, status, { completed_at: now })
    } else {
      await this.tasks.setStatus(task.id, status)
    }

    await this.regenerateCurrentMd()
    return (await this.tasks.getById(task.id))!
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
      await this.regenerateCurrentMd()
      return task
    })
  }

  async markAcceptanceMet(criterionId: number): Promise<void> {
    return this.tasks.markAcceptanceMet(criterionId)
  }

  async updateTask(id: number, params: { title?: string; description?: string | null; slug?: string }): Promise<TaskRow> {
    await this.tasks.update(id, params)
    await this.regenerateCurrentMd()
    return (await this.tasks.getById(id))!
  }

  async updateTaskAcceptance(taskId: number, criteria: string[]): Promise<void> {
    await this.tasks.replaceAcceptance(taskId, criteria)
    await this.regenerateCurrentMd()
  }

  async archiveTask(id: number): Promise<TaskRow> {
    await this.tasks.archive(id)
    await this.regenerateCurrentMd()
    return (await this.tasks.getById(id))!
  }

  async unarchiveTask(id: number): Promise<TaskRow> {
    await this.tasks.unarchive(id)
    await this.regenerateCurrentMd()
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
    const id = randomUUID()
    const now = new Date().toISOString()
    await this.actions.create(id, taskId, agent, now)
    await this.regenerateCurrentMd()
    return (await this.actions.getById(id))!
  }

  async writeSection(actionId: string, sectionType: string, content: string): Promise<void> {
    const now = new Date().toISOString()
    await this.actions.addSection(actionId, sectionType, content, now)
    await this.regenerateCurrentMd()
  }

  async completeAction(actionId: string, summary: string): Promise<ActionRow> {
    const now = new Date().toISOString()
    await this.actions.complete(actionId, summary, now)
    await this.regenerateCurrentMd()
    return (await this.actions.getById(actionId))!
  }

  async closeOrphanedActions(taskId: number): Promise<number> {
    const now = new Date().toISOString()
    return this.actions.closeOrphaned(taskId, now)
  }

  async getAction(actionId: string): Promise<ActionRow | null> {
    return this.actions.getById(actionId)
  }

  async getActionsForTask(taskId: number): Promise<ActionRow[]> {
    return this.actions.getForTask(taskId)
  }

  async getActionSections(actionId: string): Promise<ActionSectionRow[]> {
    return this.actions.getSections(actionId)
  }

  async recordFile(
    actionId: string,
    filePath: string,
    operation: ActionFileRow['operation'],
    notes?: string,
  ): Promise<void> {
    return this.actions.addFile(actionId, filePath, operation, notes ?? null)
  }

  async recordTool(
    actionId: string,
    toolName: string,
    argsJson?: string,
    resultSummary?: string,
  ): Promise<void> {
    const now = new Date().toISOString()
    return this.actions.addTool(actionId, toolName, argsJson ?? null, resultSummary ?? null, now)
  }

  async getFilesForTask(taskId: number): Promise<(ActionFileRow & { agent: AgentName })[]> {
    return this.actions.getFilesForTask(taskId)
  }

  async getTopTools(limit = 10): Promise<{ tool_name: string; uses: number }[]> {
    return this.actions.getTopTools(limit)
  }

  // ─── current.md fallback ──────────────────────────────────────────────────

  async regenerateCurrentMd(): Promise<void> {
    if (!this.config.storage.markdownFallback.enabled) return

    const mdPath =
      this.config.storage.scope === 'global'
        ? join(resolveGlobalStorageDir(this.config, this.homeDir), 'current.md')
        : resolve(this.config.storage.markdownFallback.path)
    mkdirSync(dirname(mdPath), { recursive: true })

    const inProgress = await this.tasks.getAll('in_progress')
    const now = new Date().toISOString()

    let md = `<!-- AUTO-GENERATED by agent-harness-kit — DO NOT EDIT MANUALLY -->\n`
    md += `<!-- Last updated: ${now} -->\n\n`
    md += `# Current Session\n\n`

    if (inProgress.length === 0) {
      md += `## No tasks in progress\n\n`
      const pending = await this.tasks.getAll('pending')
      if (pending.length > 0) {
        md += `### Next pending tasks\n`
        for (const t of pending.slice(0, 5)) {
          md += `- **#${t.id}** ${t.title} (\`${t.slug}\`)\n`
        }
      }
    } else {
      for (const task of inProgress) {
        md += `## Active Task\n`
        md += `- **ID:** ${task.id}\n`
        md += `- **Slug:** ${task.slug}\n`
        md += `- **Status:** ${task.status}\n`
        md += `- **Started:** ${task.started_at ?? 'unknown'}\n\n`

        const taskActions = await this.actions.getForTask(task.id)
        if (taskActions.length > 0) {
          md += `## Actions this session\n`
          md += `| Agent    | Status      | Summary                          | Started     |\n`
          md += `|----------|-------------|----------------------------------|-------------|\n`
          for (const a of taskActions) {
            const started = a.created_at.slice(11, 16)
            const summary = (a.summary ?? '').slice(0, 34).padEnd(34)
            md += `| ${a.agent.padEnd(8)} | ${a.status.padEnd(11)} | ${summary} | ${started}       |\n`
          }
          md += `\n`
        }

        const acceptance = await this.tasks.getAcceptance(task.id)
        if (acceptance.length > 0) {
          md += `## Acceptance Criteria\n`
          for (const a of acceptance) {
            md += `- [${a.met ? 'x' : ' '}] ${a.criterion}\n`
          }
          md += `\n`
        }
      }
    }

    writeFileSync(mdPath, md, 'utf8')
  }

  // ─── Raw query escape hatch ───────────────────────────────────────────────

  async queryRaw<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]> {
    return this.driver.query<T>(sql, params)
  }

  // ─── Export helpers ───────────────────────────────────────────────────────

  /** Full relational export of ALL 6 tables (tasks, task_acceptance, actions,
   *  action_sections, action_files, action_tools). Extended for task #47 —
   *  the previous version (tasks/actions/sections only) silently dropped
   *  acceptance criteria and file/tool records on export/migrate. */
  async exportJson(): Promise<FullExport> {
    return {
      tasks: await this.tasks.getAll(undefined, true),
      taskAcceptance: await this.tasks.getAllAcceptance(),
      actions: await this.actions.getAll(),
      sections: await this.actions.getAllSections(),
      actionFiles: await this.actions.getAllFiles(),
      actionTools: await this.actions.getAllTools(),
    }
  }

  /** Row counts for all 6 tables against THIS db's driver — used to decide
   *  whether a destination is "empty" (safe to import into directly) before
   *  a migration. Counts are queried directly (COUNT(*)), never inferred
   *  from storage-state.json. */
  async getRowCounts(): Promise<Record<(typeof TABLE_INSERT_ORDER)[number], number>> {
    return getRowCounts(this.driver)
  }

  /** Imports a full export into THIS db's driver — see standalone
   *  `importFullExport()` for the transactional/rollback/sequence-reset
   *  guarantees. `dbType` must match `this.config.database.type`. */
  async importFullExport(data: FullExport, dbType: 'sqlite' | 'postgres' | 'mysql', opts?: { truncateFirst: boolean }): Promise<void> {
    return importFullExport(this.driver, data, dbType, opts)
  }

  async reconnect(): Promise<void> {
    await this.driver.reconnect()
  }

  async close(): Promise<void> {
    await this.driver.close()
  }

  // ─── feature_list.json sync ───────────────────────────────────────────────

  async syncFromFeatureList(
    seeds: { slug: string; title: string; description?: string; acceptance?: string[] }[],
  ): Promise<{ added: number; skipped: number }> {
    let added = 0
    let skipped = 0
    for (const t of seeds) {
      if (await this.tasks.getBySlug(t.slug)) {
        skipped++
        continue
      }
      await this.addTask(t)
      added++
    }
    return { added, skipped }
  }

  async writeFeatureList(cwd: string): Promise<void> {
    const allTasks = await this.tasks.getAll(undefined, true)
    const list = await Promise.all(
      allTasks.map(async (t) => ({
        slug: t.slug,
        title: t.title,
        description: t.description ?? undefined,
        acceptance: (await this.tasks.getAcceptance(t.id)).map((a) => a.criterion),
        status: t.status,
      })),
    )
    const path = join(resolve(cwd), this.config.storage.dir, 'feature_list.json')
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(list, null, 2) + '\n', 'utf8')
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

/** Row counts for all 6 tables, queried directly (never inferred). Used to
 *  decide whether a destination DB is "empty" before an sqlite↔remote
 *  migration. */
export async function getRowCounts(driver: DBDriver): Promise<Record<(typeof TABLE_INSERT_ORDER)[number], number>> {
  const counts = {} as Record<(typeof TABLE_INSERT_ORDER)[number], number>
  for (const table of TABLE_INSERT_ORDER) {
    const row = await driver.queryOne<{ n: number }>(`SELECT COUNT(*) as n FROM ${table}`)
    counts[table] = Number(row?.n ?? 0)
  }
  return counts
}

/** True if every table is empty (COUNT(*) = 0 for all 6 tables). */
export async function isEmptyDatabase(driver: DBDriver): Promise<boolean> {
  const counts = await getRowCounts(driver)
  return Object.values(counts).every((n) => n === 0)
}

/** Deletes all rows from all 6 tables, children-before-parents, so FK
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
async function resetAutoincrementSequences(
  tx: DBDriver,
  dbType: 'sqlite' | 'postgres' | 'mysql',
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
        `INSERT INTO sqlite_sequence (name, seq) SELECT '${table}', ${max} WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = '${table}')`,
      )
      await tx.execRaw(`UPDATE sqlite_sequence SET seq = ${max} WHERE name = '${table}'`)
    }
  }
}

/** Imports a full export (all 6 tables) into `destDriver`, preserving
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
  opts: { truncateFirst: boolean } = { truncateFirst: false },
): Promise<void> {
  await destDriver.transaction(async (tx) => {
    if (opts.truncateFirst) {
      await truncateAllTables(tx)
    }

    for (const task of data.tasks) {
      await tx.exec(
        `INSERT INTO tasks (id, slug, title, description, status, assigned_to, created_at, started_at, completed_at, archived_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        ],
      )
    }

    for (const ta of data.taskAcceptance) {
      await tx.exec(
        `INSERT INTO task_acceptance (id, task_id, criterion, met) VALUES (?, ?, ?, ?)`,
        [ta.id, ta.task_id, ta.criterion, ta.met],
      )
    }

    for (const action of data.actions) {
      await tx.exec(
        `INSERT INTO actions (id, task_id, agent, status, created_at, completed_at, summary) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [action.id, action.task_id, action.agent, action.status, action.created_at, action.completed_at, action.summary],
      )
    }

    for (const section of data.sections) {
      await tx.exec(
        `INSERT INTO action_sections (id, action_id, section_type, content, created_at) VALUES (?, ?, ?, ?, ?)`,
        [section.id, section.action_id, section.section_type, section.content, section.created_at],
      )
    }

    for (const file of data.actionFiles) {
      await tx.exec(
        `INSERT INTO action_files (id, action_id, file_path, operation, notes) VALUES (?, ?, ?, ?, ?)`,
        [file.id, file.action_id, file.file_path, file.operation, file.notes],
      )
    }

    for (const tool of data.actionTools) {
      await tx.exec(
        `INSERT INTO action_tools (id, action_id, tool_name, args_json, result_summary, called_at) VALUES (?, ?, ?, ?, ?, ?)`,
        [tool.id, tool.action_id, tool.tool_name, tool.args_json, tool.result_summary, tool.called_at],
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
  homeDir: string,
): string {
  return scope === 'global'
    ? join(resolveGlobalStorageDir(config, homeDir), 'harness.db')
    : resolve(cwd, sqlitePath)
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

export async function openDB(config: HarnessConfig, cwd: string, homeDir: string = homedir()): Promise<HarnessDB> {
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
              `Global storage dir ${globalDir} already holds a different project (projectId: ${existingState.projectId}). Refusing to reuse it.`,
            )
          }
        } catch (err) {
          if (err instanceof Error && err.message.includes('already holds a different project')) throw err
          // Malformed/unreadable state file — ignore and proceed, mkdirSync below is idempotent.
        }
      }
      mkdirSync(globalDir, { recursive: true })
      dbPath = join(globalDir, 'harness.db')
    } else {
      dbPath = resolve(cwd, dbConfig.path)
    }

    driver = new SQLiteDriver(dbPath)
  }

  await driver.ensureSchema()
  return new HarnessDB(driver, config, homeDir)
}
