import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { lastInsertId, openSQLite, type SQLiteDB } from './sqlite-adapter'

import type {
  ActionFileRow,
  ActionRow,
  ActionSectionRow,
  AgentName,
  HarnessConfig,
  TaskAcceptanceRow,
  TaskRow,
  TaskStatus,
} from '@/types'

// ─── Schema ───────────────────────────────────────────────────────────────────

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tasks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  slug         TEXT    NOT NULL UNIQUE,
  title        TEXT    NOT NULL,
  description  TEXT,
  status       TEXT    NOT NULL DEFAULT 'pending'
               CHECK(status IN ('pending','in_progress','done','blocked')),
  assigned_to  TEXT,
  created_at   TEXT    NOT NULL,
  started_at   TEXT,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS task_acceptance (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
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
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  action_id    TEXT    NOT NULL REFERENCES actions(id) ON DELETE CASCADE,
  section_type TEXT    NOT NULL,
  content      TEXT    NOT NULL,
  created_at   TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS action_files (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  action_id   TEXT    NOT NULL REFERENCES actions(id) ON DELETE CASCADE,
  file_path   TEXT    NOT NULL,
  operation   TEXT    NOT NULL
              CHECK(operation IN ('read','created','modified','deleted')),
  notes       TEXT
);

CREATE TABLE IF NOT EXISTS action_tools (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
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

// ─── DB class ─────────────────────────────────────────────────────────────────

export class HarnessDB {
  private db: SQLiteDB
  private config: HarnessConfig

  constructor(dbPath: string, config: HarnessConfig) {
    this.config = config
    const abs = resolve(dbPath)
    mkdirSync(dirname(abs), { recursive: true })
    this.db = openSQLite(abs)
    this.db.exec(`PRAGMA journal_mode = WAL`)
    this.db.exec(`PRAGMA foreign_keys = ON`)
    this.db.exec(SCHEMA)
  }

  // ─── Tasks ────────────────────────────────────────────────────────────────

  addTask(params: {
    slug: string
    title: string
    description?: string
    acceptance?: string[]
  }): TaskRow {
    const now = new Date().toISOString()
    this.db
      .prepare(
        `INSERT INTO tasks (slug, title, description, status, created_at)
         VALUES (@slug, @title, @description, 'pending', @created_at)`
      )
      .run({
        slug: params.slug,
        title: params.title,
        description: params.description ?? null,
        created_at: now,
      })

    const taskId = lastInsertId(this.db)

    if (params.acceptance?.length) {
      const accStmt = this.db.prepare(
        `INSERT INTO task_acceptance (task_id, criterion) VALUES (?, ?)`
      )
      for (const criterion of params.acceptance) {
        accStmt.run(taskId, criterion)
      }
    }

    this.regenerateCurrentMd()
    return this.getTaskById(taskId)!
  }

  getTasks(status?: TaskStatus): TaskRow[] {
    if (status) {
      return this.db
        .prepare(`SELECT * FROM tasks WHERE status = ? ORDER BY id`)
        .all(status) as unknown as TaskRow[]
    }
    return this.db.prepare(`SELECT * FROM tasks ORDER BY id`).all() as unknown as TaskRow[]
  }

  getTaskById(id: number): TaskRow | null {
    return (this.db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as unknown as TaskRow) ?? null
  }

  getTaskBySlug(slug: string): TaskRow | null {
    return (this.db.prepare(`SELECT * FROM tasks WHERE slug = ?`).get(slug) as unknown as TaskRow) ?? null
  }

  getTaskAcceptance(taskId: number): TaskAcceptanceRow[] {
    return this.db
      .prepare(`SELECT * FROM task_acceptance WHERE task_id = ?`)
      .all(taskId) as unknown as TaskAcceptanceRow[]
  }

  updateTaskStatus(idOrSlug: number | string, status: TaskStatus): TaskRow {
    const now = new Date().toISOString()
    const task =
      typeof idOrSlug === 'number' ? this.getTaskById(idOrSlug) : this.getTaskBySlug(idOrSlug)
    if (!task) throw new Error(`Task not found: ${idOrSlug}`)

    if (status === 'in_progress' && !task.started_at) {
      this.db
        .prepare(
          `UPDATE tasks SET status = ?, started_at = ? WHERE id = ?`
        )
        .run(status, now, task.id)
    } else if (status === 'done') {
      this.db
        .prepare(
          `UPDATE tasks SET status = ?, completed_at = ? WHERE id = ?`
        )
        .run(status, now, task.id)
    } else {
      this.db.prepare(`UPDATE tasks SET status = ? WHERE id = ?`).run(status, task.id)
    }

    this.regenerateCurrentMd()
    return this.getTaskById(task.id)!
  }

  claimTask(id: number, agent: string): TaskRow | null {
    const now = new Date().toISOString()
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db
        .prepare(
          `UPDATE tasks SET status = 'in_progress', assigned_to = ?, started_at = ?
           WHERE id = ? AND status = 'pending'`
        )
        .run(agent, now, id)
      this.db.exec('COMMIT')

      // Verify the claim succeeded by reading back — if status changed, we own it
      const task = this.getTaskById(id)
      if (!task || task.status !== 'in_progress' || task.assigned_to !== agent) return null

      this.regenerateCurrentMd()
      return task
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
  }

  // ─── Actions ──────────────────────────────────────────────────────────────

  startAction(taskId: number, agent: AgentName): ActionRow {
    const now = new Date().toISOString()
    const id = randomUUID()
    this.db
      .prepare(
        `INSERT INTO actions (id, task_id, agent, status, created_at)
         VALUES (?, ?, ?, 'in_progress', ?)`
      )
      .run(id, taskId, agent, now)

    this.regenerateCurrentMd()
    return this.getAction(id)!
  }

  writeSection(actionId: string, sectionType: string, content: string): void {
    const now = new Date().toISOString()
    this.db
      .prepare(
        `INSERT INTO action_sections (action_id, section_type, content, created_at)
         VALUES (?, ?, ?, ?)`
      )
      .run(actionId, sectionType, content, now)

    this.regenerateCurrentMd()
  }

  completeAction(actionId: string, summary: string): ActionRow {
    const now = new Date().toISOString()
    this.db
      .prepare(
        `UPDATE actions SET status = 'completed', completed_at = ?, summary = ?
         WHERE id = ?`
      )
      .run(now, summary, actionId)

    this.regenerateCurrentMd()
    return this.getAction(actionId)!
  }

  getAction(actionId: string): ActionRow | null {
    return (
      (this.db.prepare(`SELECT * FROM actions WHERE id = ?`).get(actionId) as unknown as ActionRow) ?? null
    )
  }

  getActionsForTask(taskId: number): ActionRow[] {
    return this.db
      .prepare(`SELECT * FROM actions WHERE task_id = ? ORDER BY created_at`)
      .all(taskId) as unknown as ActionRow[]
  }

  getActionSections(actionId: string): ActionSectionRow[] {
    return this.db
      .prepare(
        `SELECT * FROM action_sections WHERE action_id = ? ORDER BY created_at`
      )
      .all(actionId) as unknown as ActionSectionRow[]
  }

  recordFile(
    actionId: string,
    filePath: string,
    operation: ActionFileRow['operation'],
    notes?: string
  ): void {
    this.db
      .prepare(
        `INSERT INTO action_files (action_id, file_path, operation, notes)
         VALUES (?, ?, ?, ?)`
      )
      .run(actionId, filePath, operation, notes ?? null)
  }

  recordTool(
    actionId: string,
    toolName: string,
    argsJson?: string,
    resultSummary?: string
  ): void {
    const now = new Date().toISOString()
    this.db
      .prepare(
        `INSERT INTO action_tools (action_id, tool_name, args_json, result_summary, called_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(actionId, toolName, argsJson ?? null, resultSummary ?? null, now)
  }

  getFilesForTask(taskId: number): (ActionFileRow & { agent: AgentName })[] {
    return this.db
      .prepare(
        `SELECT af.*, a.agent
         FROM action_files af
         JOIN actions a ON af.action_id = a.id
         WHERE a.task_id = ?
         ORDER BY a.agent, af.operation`
      )
      .all(taskId) as unknown as (ActionFileRow & { agent: AgentName })[]
  }

  getTopTools(limit = 10): { tool_name: string; uses: number }[] {
    return this.db
      .prepare(
        `SELECT tool_name, COUNT(*) as uses
         FROM action_tools
         GROUP BY tool_name
         ORDER BY uses DESC
         LIMIT ?`
      )
      .all(limit) as { tool_name: string; uses: number }[]
  }

  getStatusSummary(): { status: string; total: number }[] {
    return this.db
      .prepare(`SELECT status, COUNT(*) as total FROM tasks GROUP BY status`)
      .all() as { status: string; total: number }[]
  }

  // ─── current.md fallback ──────────────────────────────────────────────────

  regenerateCurrentMd(): void {
    if (!this.config.storage.markdownFallback.enabled) return

    const mdPath = resolve(this.config.storage.markdownFallback.path)
    mkdirSync(dirname(mdPath), { recursive: true })

    const inProgress = this.getTasks('in_progress')
    const now = new Date().toISOString()

    let md = `<!-- AUTO-GENERATED by agent-harness-kit — DO NOT EDIT MANUALLY -->\n`
    md += `<!-- Last updated: ${now} -->\n\n`
    md += `# Current Session\n\n`

    if (inProgress.length === 0) {
      md += `## No tasks in progress\n\n`
      const pending = this.getTasks('pending')
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

        const actions = this.getActionsForTask(task.id)
        if (actions.length > 0) {
          md += `## Actions this session\n`
          md += `| Agent    | Status      | Summary                          | Started     |\n`
          md += `|----------|-------------|----------------------------------|-------------|\n`
          for (const a of actions) {
            const started = a.created_at.slice(11, 16)
            const summary = (a.summary ?? '').slice(0, 34).padEnd(34)
            md += `| ${a.agent.padEnd(8)} | ${a.status.padEnd(11)} | ${summary} | ${started}       |\n`
          }
          md += `\n`
        }

        const acceptance = this.getTaskAcceptance(task.id)
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

  // ─── Raw query (dashboard / analytics) ───────────────────────────────────

  queryRaw<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T[] {
    return this.db.prepare(sql).all(...params) as unknown as T[]
  }

  // ─── Export helpers ───────────────────────────────────────────────────────

  exportJson(): { tasks: TaskRow[]; actions: ActionRow[]; sections: ActionSectionRow[] } {
    return {
      tasks: this.getTasks(),
      actions: this.db
        .prepare(`SELECT * FROM actions ORDER BY created_at`)
        .all() as unknown as ActionRow[],
      sections: this.db
        .prepare(`SELECT * FROM action_sections ORDER BY created_at`)
        .all() as unknown as ActionSectionRow[],
    }
  }

  close(): void {
    this.db.close()
  }

  // ─── feature_list.json sync ───────────────────────────────────────────────

  syncFromFeatureList(
    tasks: {
      slug: string
      title: string
      description?: string
      acceptance?: string[]
    }[]
  ): { added: number; skipped: number } {
    let added = 0
    let skipped = 0

    for (const t of tasks) {
      if (this.getTaskBySlug(t.slug)) {
        skipped++
        continue
      }
      this.addTask(t)
      added++
    }

    return { added, skipped }
  }

  writeFeatureList(cwd: string): void {
    const tasks = this.getTasks()
    const list = tasks.map((t) => ({
      slug: t.slug,
      title: t.title,
      description: t.description ?? undefined,
      acceptance: this.getTaskAcceptance(t.id).map((a) => a.criterion),
      status: t.status,
    }))

    const path = join(resolve(cwd), this.config.storage.dir, 'feature_list.json')
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(list, null, 2) + '\n', 'utf8')
  }
}

export function openDB(config: HarnessConfig, cwd: string): HarnessDB {
  const dbPath = join(resolve(cwd), config.storage.dbPath)
  return new HarnessDB(dbPath, config)
}
