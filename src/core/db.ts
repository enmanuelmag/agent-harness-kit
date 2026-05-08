import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import type { DBDriver } from './drivers/types'
import type {
  ActionFileRow,
  ActionRow,
  ActionSectionRow,
  AgentName,
  DatabaseConfig,
  HarnessConfig,
  TaskAcceptanceRow,
  TaskRow,
  TaskStatus,
} from '@/types'

// ─── DB class ─────────────────────────────────────────────────────────────────

export class HarnessDB {
  private driver: DBDriver
  private config: HarnessConfig

  constructor(driver: DBDriver, config: HarnessConfig) {
    this.driver = driver
    this.config = config
  }

  // ─── Tasks ────────────────────────────────────────────────────────────────

  async addTask(params: {
    slug: string
    title: string
    description?: string
    acceptance?: string[]
  }): Promise<TaskRow> {
    const now = new Date().toISOString()
    const taskId = await this.driver.insert(
      `INSERT INTO tasks (slug, title, description, status, created_at) VALUES (?, ?, ?, 'pending', ?)`,
      [params.slug, params.title, params.description ?? null, now],
    )

    if (params.acceptance?.length) {
      for (const criterion of params.acceptance) {
        await this.driver.exec(
          `INSERT INTO task_acceptance (task_id, criterion) VALUES (?, ?)`,
          [taskId, criterion],
        )
      }
    }

    await this.regenerateCurrentMd()
    return (await this.getTaskById(taskId))!
  }

  async getTasks(status?: TaskStatus): Promise<TaskRow[]> {
    if (status) {
      return this.driver.query<TaskRow>(`SELECT * FROM tasks WHERE status = ? ORDER BY id`, [status])
    }
    return this.driver.query<TaskRow>(`SELECT * FROM tasks ORDER BY id`)
  }

  async getTaskById(id: number): Promise<TaskRow | null> {
    return this.driver.queryOne<TaskRow>(`SELECT * FROM tasks WHERE id = ?`, [id])
  }

  async getTaskBySlug(slug: string): Promise<TaskRow | null> {
    return this.driver.queryOne<TaskRow>(`SELECT * FROM tasks WHERE slug = ?`, [slug])
  }

  async getTaskAcceptance(taskId: number): Promise<TaskAcceptanceRow[]> {
    return this.driver.query<TaskAcceptanceRow>(`SELECT * FROM task_acceptance WHERE task_id = ?`, [taskId])
  }

  async updateTaskStatus(idOrSlug: number | string, status: TaskStatus): Promise<TaskRow> {
    const now = new Date().toISOString()
    const task =
      typeof idOrSlug === 'number'
        ? await this.getTaskById(idOrSlug)
        : await this.getTaskBySlug(idOrSlug)
    if (!task) throw new Error(`Task not found: ${idOrSlug}`)

    if (status === 'in_progress' && !task.started_at) {
      await this.driver.exec(`UPDATE tasks SET status = ?, started_at = ? WHERE id = ?`, [status, now, task.id])
    } else if (status === 'done') {
      await this.driver.exec(`UPDATE tasks SET status = ?, completed_at = ? WHERE id = ?`, [status, now, task.id])
    } else {
      await this.driver.exec(`UPDATE tasks SET status = ? WHERE id = ?`, [status, task.id])
    }

    await this.regenerateCurrentMd()
    return (await this.getTaskById(task.id))!
  }

  async claimTask(id: number, agent: string): Promise<TaskRow | null> {
    const now = new Date().toISOString()
    return this.driver.transaction(async (tx) => {
      await tx.exec(
        `UPDATE tasks SET status = 'in_progress', assigned_to = ?, started_at = ? WHERE id = ? AND status = 'pending'`,
        [agent, now, id],
      )
      const task = await tx.queryOne<TaskRow>(`SELECT * FROM tasks WHERE id = ?`, [id])
      if (!task || task.status !== 'in_progress' || task.assigned_to !== agent) return null
      await this.regenerateCurrentMd()
      return task
    })
  }

  // ─── Actions ──────────────────────────────────────────────────────────────

  async startAction(taskId: number, agent: AgentName): Promise<ActionRow> {
    const now = new Date().toISOString()
    const id = randomUUID()
    await this.driver.exec(
      `INSERT INTO actions (id, task_id, agent, status, created_at) VALUES (?, ?, ?, 'in_progress', ?)`,
      [id, taskId, agent, now],
    )
    await this.regenerateCurrentMd()
    return (await this.getAction(id))!
  }

  async writeSection(actionId: string, sectionType: string, content: string): Promise<void> {
    const now = new Date().toISOString()
    await this.driver.exec(
      `INSERT INTO action_sections (action_id, section_type, content, created_at) VALUES (?, ?, ?, ?)`,
      [actionId, sectionType, content, now],
    )
    await this.regenerateCurrentMd()
  }

  async completeAction(actionId: string, summary: string): Promise<ActionRow> {
    const now = new Date().toISOString()
    await this.driver.exec(
      `UPDATE actions SET status = 'completed', completed_at = ?, summary = ? WHERE id = ?`,
      [now, summary, actionId],
    )
    await this.regenerateCurrentMd()
    return (await this.getAction(actionId))!
  }

  async closeOrphanedActions(taskId: number): Promise<number> {
    const now = new Date().toISOString()
    return this.driver.exec(
      `UPDATE actions SET status = 'completed', completed_at = ?, summary = 'Auto-closed: task marked done' WHERE task_id = ? AND status = 'in_progress'`,
      [now, taskId],
    )
  }

  async getAction(actionId: string): Promise<ActionRow | null> {
    return this.driver.queryOne<ActionRow>(`SELECT * FROM actions WHERE id = ?`, [actionId])
  }

  async getActionsForTask(taskId: number): Promise<ActionRow[]> {
    return this.driver.query<ActionRow>(
      `SELECT * FROM actions WHERE task_id = ? ORDER BY created_at`,
      [taskId],
    )
  }

  async getActionSections(actionId: string): Promise<ActionSectionRow[]> {
    return this.driver.query<ActionSectionRow>(
      `SELECT * FROM action_sections WHERE action_id = ? ORDER BY created_at`,
      [actionId],
    )
  }

  async recordFile(
    actionId: string,
    filePath: string,
    operation: ActionFileRow['operation'],
    notes?: string,
  ): Promise<void> {
    await this.driver.exec(
      `INSERT INTO action_files (action_id, file_path, operation, notes) VALUES (?, ?, ?, ?)`,
      [actionId, filePath, operation, notes ?? null],
    )
  }

  async recordTool(
    actionId: string,
    toolName: string,
    argsJson?: string,
    resultSummary?: string,
  ): Promise<void> {
    const now = new Date().toISOString()
    await this.driver.exec(
      `INSERT INTO action_tools (action_id, tool_name, args_json, result_summary, called_at) VALUES (?, ?, ?, ?, ?)`,
      [actionId, toolName, argsJson ?? null, resultSummary ?? null, now],
    )
  }

  async getFilesForTask(taskId: number): Promise<(ActionFileRow & { agent: AgentName })[]> {
    return this.driver.query<ActionFileRow & { agent: AgentName }>(
      `SELECT af.*, a.agent FROM action_files af JOIN actions a ON af.action_id = a.id WHERE a.task_id = ? ORDER BY a.agent, af.operation`,
      [taskId],
    )
  }

  async getTopTools(limit = 10): Promise<{ tool_name: string; uses: number }[]> {
    return this.driver.query<{ tool_name: string; uses: number }>(
      `SELECT tool_name, COUNT(*) as uses FROM action_tools GROUP BY tool_name ORDER BY uses DESC LIMIT ?`,
      [limit],
    )
  }

  async getStatusSummary(): Promise<{ status: string; total: number }[]> {
    return this.driver.query<{ status: string; total: number }>(
      `SELECT status, COUNT(*) as total FROM tasks GROUP BY status`,
    )
  }

  async markAcceptanceMet(criterionId: number): Promise<void> {
    await this.driver.exec(`UPDATE task_acceptance SET met = 1 WHERE id = ?`, [criterionId])
  }

  // ─── current.md fallback ──────────────────────────────────────────────────

  async regenerateCurrentMd(): Promise<void> {
    if (!this.config.storage.markdownFallback.enabled) return

    const mdPath = resolve(this.config.storage.markdownFallback.path)
    mkdirSync(dirname(mdPath), { recursive: true })

    const inProgress = await this.getTasks('in_progress')
    const now = new Date().toISOString()

    let md = `<!-- AUTO-GENERATED by agent-harness-kit — DO NOT EDIT MANUALLY -->\n`
    md += `<!-- Last updated: ${now} -->\n\n`
    md += `# Current Session\n\n`

    if (inProgress.length === 0) {
      md += `## No tasks in progress\n\n`
      const pending = await this.getTasks('pending')
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

        const actions = await this.getActionsForTask(task.id)
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

        const acceptance = await this.getTaskAcceptance(task.id)
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

  async queryRaw<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]> {
    return this.driver.query<T>(sql, params)
  }

  // ─── Export helpers ───────────────────────────────────────────────────────

  async exportJson(): Promise<{ tasks: TaskRow[]; actions: ActionRow[]; sections: ActionSectionRow[] }> {
    return {
      tasks: await this.getTasks(),
      actions: await this.driver.query<ActionRow>(`SELECT * FROM actions ORDER BY created_at`),
      sections: await this.driver.query<ActionSectionRow>(`SELECT * FROM action_sections ORDER BY created_at`),
    }
  }

  async close(): Promise<void> {
    await this.driver.close()
  }

  // ─── feature_list.json sync ───────────────────────────────────────────────

  async syncFromFeatureList(
    tasks: { slug: string; title: string; description?: string; acceptance?: string[] }[],
  ): Promise<{ added: number; skipped: number }> {
    let added = 0
    let skipped = 0
    for (const t of tasks) {
      if (await this.getTaskBySlug(t.slug)) {
        skipped++
        continue
      }
      await this.addTask(t)
      added++
    }
    return { added, skipped }
  }

  async writeFeatureList(cwd: string): Promise<void> {
    const tasks = await this.getTasks()
    const list = await Promise.all(
      tasks.map(async (t) => ({
        slug: t.slug,
        title: t.title,
        description: t.description ?? undefined,
        acceptance: (await this.getTaskAcceptance(t.id)).map((a) => a.criterion),
        status: t.status,
      })),
    )

    const path = join(resolve(cwd), this.config.storage.dir, 'feature_list.json')
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(list, null, 2) + '\n', 'utf8')
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export async function openDB(config: HarnessConfig, cwd: string): Promise<HarnessDB> {
  const dbConfig = resolveDbConfig(config)
  let driver: DBDriver

  if (dbConfig.type === 'postgres') {
    const { PostgresDriver } = await import('./drivers/postgres')
    driver = new PostgresDriver(dbConfig)
  } else if (dbConfig.type === 'mysql') {
    const { MySQLDriver } = await import('./drivers/mysql')
    driver = new MySQLDriver(dbConfig)
  } else {
    const { SQLiteDriver } = await import('./drivers/sqlite')
    const dbPath = resolve(cwd, config.storage.dbPath)
    driver = new SQLiteDriver(dbPath)
  }

  await driver.ensureSchema()
  return new HarnessDB(driver, config)
}

function resolveDbConfig(config: HarnessConfig): DatabaseConfig {
  if (config.database) return config.database
  return { type: 'sqlite' }
}

