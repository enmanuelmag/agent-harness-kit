import type { DBDriver } from '../drivers/types'
import type { TaskAcceptanceRow, TaskRow, TaskStatus } from '@/types'

export interface TaskWithAcceptance extends TaskRow {
  acceptance_total: number
  acceptance_met: number
}

export class TaskRepository {
  constructor(private driver: DBDriver) {}

  async add(params: {
    slug: string
    title: string
    description?: string | null
    status?: TaskStatus
  }): Promise<number> {
    const now = new Date().toISOString()
    return this.driver.insert(
      `INSERT INTO tasks (slug, title, description, status, created_at) VALUES (?, ?, ?, ?, ?)`,
      [params.slug, params.title, params.description ?? null, params.status ?? 'pending', now],
    )
  }

  async addAcceptance(taskId: number, criteria: string[]): Promise<void> {
    for (const criterion of criteria) {
      await this.driver.exec(
        `INSERT INTO task_acceptance (task_id, criterion) VALUES (?, ?)`,
        [taskId, criterion],
      )
    }
  }

  async getAll(status?: TaskStatus): Promise<TaskRow[]> {
    if (status) {
      return this.driver.query<TaskRow>(`SELECT * FROM tasks WHERE status = ? ORDER BY id`, [status])
    }
    return this.driver.query<TaskRow>(`SELECT * FROM tasks ORDER BY id`)
  }

  async getAllWithAcceptanceCounts(): Promise<TaskWithAcceptance[]> {
    return this.driver.query<TaskWithAcceptance>(`
      SELECT t.*,
        COUNT(ta.id) as acceptance_total,
        COALESCE(SUM(ta.met), 0) as acceptance_met
      FROM tasks t
      LEFT JOIN task_acceptance ta ON ta.task_id = t.id
      GROUP BY t.id
      ORDER BY t.id
    `)
  }

  async getById(id: number): Promise<TaskRow | null> {
    return this.driver.queryOne<TaskRow>(`SELECT * FROM tasks WHERE id = ?`, [id])
  }

  async getBySlug(slug: string): Promise<TaskRow | null> {
    return this.driver.queryOne<TaskRow>(`SELECT * FROM tasks WHERE slug = ?`, [slug])
  }

  async getAcceptance(taskId: number): Promise<TaskAcceptanceRow[]> {
    return this.driver.query<TaskAcceptanceRow>(
      `SELECT * FROM task_acceptance WHERE task_id = ?`,
      [taskId],
    )
  }

  async setStatus(id: number, status: TaskStatus, extra?: { started_at?: string; completed_at?: string }): Promise<void> {
    if (extra?.started_at) {
      await this.driver.exec(
        `UPDATE tasks SET status = ?, started_at = ? WHERE id = ?`,
        [status, extra.started_at, id],
      )
    } else if (extra?.completed_at) {
      await this.driver.exec(
        `UPDATE tasks SET status = ?, completed_at = ? WHERE id = ?`,
        [status, extra.completed_at, id],
      )
    } else {
      await this.driver.exec(`UPDATE tasks SET status = ? WHERE id = ?`, [status, id])
    }
  }

  async claim(id: number, agent: string, now: string): Promise<number> {
    return this.driver.exec(
      `UPDATE tasks SET status = 'in_progress', assigned_to = ?, started_at = ? WHERE id = ? AND status = 'pending'`,
      [agent, now, id],
    )
  }

  async markAcceptanceMet(criterionId: number): Promise<void> {
    await this.driver.exec(`UPDATE task_acceptance SET met = 1 WHERE id = ?`, [criterionId])
  }

  async getStatusSummary(): Promise<{ status: string; total: number }[]> {
    return this.driver.query<{ status: string; total: number }>(
      `SELECT status, COUNT(*) as total FROM tasks GROUP BY status`,
    )
  }
}
