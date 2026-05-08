import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { ActionRepository } from './repositories/ActionRepository'
import { StatsRepository } from './repositories/StatsRepository'
import { TaskRepository } from './repositories/TaskRepository'

import type { DBDriver } from './drivers/types'
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

// ─── DB class ─────────────────────────────────────────────────────────────────

export class HarnessDB {
  readonly tasks: TaskRepository
  readonly actions: ActionRepository
  readonly stats: StatsRepository
  private driver: DBDriver
  private config: HarnessConfig

  constructor(driver: DBDriver, config: HarnessConfig) {
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
    await this.regenerateCurrentMd()
    return (await this.tasks.getById(taskId))!
  }

  async getTasks(status?: TaskStatus): Promise<TaskRow[]> {
    return this.tasks.getAll(status)
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

    const mdPath = resolve(this.config.storage.markdownFallback.path)
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

  async exportJson(): Promise<{ tasks: TaskRow[]; actions: ActionRow[]; sections: ActionSectionRow[] }> {
    return {
      tasks: await this.tasks.getAll(),
      actions: await this.actions.getAll(),
      sections: await this.actions.getAllSections(),
    }
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
    const allTasks = await this.tasks.getAll()
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
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export async function openDB(config: HarnessConfig, cwd: string): Promise<HarnessDB> {
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
    driver = new SQLiteDriver(resolve(cwd, dbConfig.path))
  }

  await driver.ensureSchema()
  return new HarnessDB(driver, config)
}
