import type { DBDriver } from '../drivers/types'
import type { TaskAcceptanceRow, TaskExecutionMode, TaskHealthRunRow, TaskRepairRow, TaskRow, TaskStatus } from '@/types'

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
      `INSERT INTO tasks (slug, title, description, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [params.slug, params.title, params.description ?? null, params.status ?? 'pending', now, now]
    )
  }

  async addAcceptance(taskId: number, criteria: string[]): Promise<void> {
    for (const criterion of criteria) {
      await this.driver.exec(`INSERT INTO task_acceptance (task_id, criterion) VALUES (?, ?)`, [
        taskId,
        criterion,
      ])
    }
  }

  async getAll(status?: TaskStatus, includeArchived = false): Promise<TaskRow[]> {
    let sql = `SELECT * FROM tasks`
    const params: unknown[] = []
    const conditions: string[] = []

    if (!includeArchived) {
      conditions.push(`archived_at IS NULL`)
    }
    if (status) {
      conditions.push(`status = ?`)
      params.push(status)
    }
    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(' AND ')}`
    }
    sql += ` ORDER BY CASE status WHEN 'pending' THEN 1 WHEN 'in_progress' THEN 2 WHEN 'blocked' THEN 3 WHEN 'done' THEN 4 ELSE 5 END, updated_at DESC`

    return this.driver.query<TaskRow>(sql, params)
  }

  async getAllWithAcceptanceCounts(includeArchived = false): Promise<TaskWithAcceptance[]> {
    let sql = `
      SELECT t.*,
        COUNT(ta.id) as acceptance_total,
        COALESCE(SUM(ta.met), 0) as acceptance_met
      FROM tasks t
      LEFT JOIN task_acceptance ta ON ta.task_id = t.id
    `
    if (!includeArchived) {
      sql += ` WHERE t.archived_at IS NULL`
    }
    sql += ` GROUP BY t.id ORDER BY CASE t.status WHEN 'pending' THEN 1 WHEN 'in_progress' THEN 2 WHEN 'blocked' THEN 3 WHEN 'done' THEN 4 ELSE 5 END, t.updated_at DESC`
    return this.driver.query<TaskWithAcceptance>(sql)
  }

  async getById(id: number): Promise<TaskRow | null> {
    return this.driver.queryOne<TaskRow>(`SELECT * FROM tasks WHERE id = ?`, [id])
  }

  async getBySlug(slug: string): Promise<TaskRow | null> {
    return this.driver.queryOne<TaskRow>(`SELECT * FROM tasks WHERE slug = ?`, [slug])
  }

  async getAcceptance(taskId: number): Promise<TaskAcceptanceRow[]> {
    return this.driver.query<TaskAcceptanceRow>(`SELECT * FROM task_acceptance WHERE task_id = ?`, [
      taskId,
    ])
  }

  /** Returns ALL task_acceptance rows regardless of task — used by full DB
   *  exports (e.g. `ahk migrate storage`) so criteria aren't silently dropped. */
  async getAllAcceptance(): Promise<TaskAcceptanceRow[]> {
    return this.driver.query<TaskAcceptanceRow>(`SELECT * FROM task_acceptance ORDER BY id`)
  }

  async setStatus(
    id: number,
    status: TaskStatus,
    extra?: { started_at?: string; completed_at?: string }
  ): Promise<void> {
    const now = new Date().toISOString()
    if (extra?.started_at) {
      await this.driver.exec(
        `UPDATE tasks SET status = ?, started_at = ?, updated_at = ? WHERE id = ?`,
        [status, extra.started_at, now, id]
      )
    } else if (extra?.completed_at) {
      await this.driver.exec(
        `UPDATE tasks SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?`,
        [status, extra.completed_at, now, id]
      )
    } else {
      await this.driver.exec(`UPDATE tasks SET status = ?, health_run_id = NULL, health_status = NULL, health_started_at = NULL, health_completed_at = NULL, health_log_path = NULL, health_script_path = NULL, updated_at = ? WHERE id = ?`, [
        status,
        now,
        id,
      ])
    }
  }

  async update(
    id: number,
    params: { title?: string; description?: string | null; slug?: string }
  ): Promise<void> {
    const sets: string[] = []
    const vals: unknown[] = []
    const now = new Date().toISOString()
    if (params.title !== undefined) {
      sets.push('title = ?')
      vals.push(params.title)
    }
    if (params.description !== undefined) {
      sets.push('description = ?')
      vals.push(params.description)
    }
    if (params.slug !== undefined) {
      sets.push('slug = ?')
      vals.push(params.slug)
    }
    if (sets.length === 0) return
    sets.push('updated_at = ?')
    vals.push(now)
    vals.push(id)
    await this.driver.exec(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`, vals)
  }

  async replaceAcceptance(taskId: number, criteria: string[]): Promise<void> {
    await this.driver.exec(`DELETE FROM task_acceptance WHERE task_id = ?`, [taskId])
    for (const criterion of criteria) {
      await this.driver.exec(`INSERT INTO task_acceptance (task_id, criterion) VALUES (?, ?)`, [
        taskId,
        criterion,
      ])
    }
  }

  async archive(id: number): Promise<void> {
    const now = new Date().toISOString()
    await this.driver.exec(`UPDATE tasks SET archived_at = ?, updated_at = ? WHERE id = ?`, [
      now,
      now,
      id,
    ])
  }

  async unarchive(id: number): Promise<void> {
    const now = new Date().toISOString()
    await this.driver.exec(`UPDATE tasks SET archived_at = NULL, updated_at = ? WHERE id = ?`, [
      now,
      id,
    ])
  }

  async getArchived(): Promise<TaskRow[]> {
    return this.driver.query<TaskRow>(
      `SELECT * FROM tasks WHERE archived_at IS NOT NULL ORDER BY archived_at DESC`
    )
  }

  async claim(id: number, agent: string, now: string): Promise<number> {
    return this.driver.exec(
      `UPDATE tasks SET status = 'in_progress', assigned_to = ?, started_at = ?, execution_mode = 'checking', claim_generation = claim_generation + 1, health_run_id = NULL, health_status = NULL, health_started_at = NULL, health_completed_at = NULL, health_log_path = NULL, health_script_path = NULL, updated_at = ? WHERE id = ? AND status = 'pending'`,
      [agent, now, now, id]
    )
  }

  async reserveHealthRun(id: number, runId: string, startedAt: string, scriptPath: string, claimGeneration: number, mode: TaskExecutionMode): Promise<number> {
    const changed = await this.driver.exec(
      `UPDATE tasks SET health_run_id = ?, health_status = 'running', health_started_at = ?, health_completed_at = NULL, health_log_path = NULL, health_script_path = ?, updated_at = ? WHERE id = ? AND archived_at IS NULL AND claim_generation = ? AND execution_mode = ?`,
      [runId, startedAt, scriptPath, startedAt, id, claimGeneration, mode]
    )
    if (!changed) return 0
    await this.driver.exec(`UPDATE task_health_runs SET status = 'superseded', completed_at = ? WHERE task_id = ? AND claim_generation = ? AND status = 'running' AND id != ?`, [startedAt, id, claimGeneration, runId])
    await this.driver.exec(`INSERT INTO task_health_runs (id, task_id, claim_generation, execution_mode, status, started_at, script_path) VALUES (?, ?, ?, ?, 'running', ?, ?)`, [runId, id, claimGeneration, mode, startedAt, scriptPath])
    return changed
  }

  async finishHealthRun(id: number, runId: string, status: 'passed' | 'failed', completedAt: string, logPath: string | null, scriptPath: string | null, claimGeneration: number, mode: TaskExecutionMode): Promise<number> {
    const changed = await this.driver.exec(
      `UPDATE tasks SET health_status = ?, health_completed_at = ?, health_log_path = ?, health_script_path = COALESCE(?, health_script_path), updated_at = ? WHERE id = ? AND health_run_id = ? AND health_status = 'running' AND claim_generation = ? AND execution_mode = ?`,
      [status, completedAt, logPath, scriptPath, completedAt, id, runId, claimGeneration, mode]
    )
    if (changed) await this.driver.exec(`UPDATE task_health_runs SET status = ?, completed_at = ?, log_path = ?, script_path = COALESCE(?, script_path) WHERE id = ? AND task_id = ? AND claim_generation = ? AND execution_mode = ? AND status = 'running'`, [status, completedAt, logPath, scriptPath, runId, id, claimGeneration, mode])
    return changed
  }

  async setExecutionMode(id: number, mode: TaskExecutionMode, generation: number, now: string, expectedMode: TaskExecutionMode, healthRunId?: string): Promise<number> {
    const token = healthRunId ? ` AND health_run_id = ?` : ''
    return this.driver.exec(
      `UPDATE tasks SET execution_mode = ?, updated_at = ? WHERE id = ? AND claim_generation = ? AND execution_mode = ? AND archived_at IS NULL${token}`,
      healthRunId ? [mode, now, id, generation, expectedMode, healthRunId] : [mode, now, id, generation, expectedMode]
    )
  }

  async getHealthRun(id: string): Promise<TaskHealthRunRow | null> { return this.driver.queryOne<TaskHealthRunRow>('SELECT * FROM task_health_runs WHERE id = ?', [id]) }

  async createRepair(params: Omit<TaskRepairRow, 'id' | 'closed_at' | 'final_health_run_id'>): Promise<number> {
    return this.driver.insert(
      `INSERT INTO task_repairs (task_id, claim_generation, failed_health_run_id, reason, scope, actor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [params.task_id, params.claim_generation, params.failed_health_run_id, params.reason, params.scope, params.actor, params.created_at]
    )
  }

  async getActiveRepair(taskId: number, generation: number): Promise<TaskRepairRow | null> {
    return this.driver.queryOne<TaskRepairRow>(
      `SELECT * FROM task_repairs WHERE task_id = ? AND claim_generation = ? AND closed_at IS NULL ORDER BY id DESC LIMIT 1`,
      [taskId, generation]
    )
  }

  async release(id: number, now: string): Promise<number> {
    return this.driver.exec(`UPDATE tasks SET status = 'pending', assigned_to = NULL, started_at = NULL, execution_mode = 'normal', health_run_id = NULL, health_status = NULL, health_started_at = NULL, health_completed_at = NULL, health_log_path = NULL, health_script_path = NULL, updated_at = ? WHERE id = ? AND status != 'done'`, [now, id])
  }

  async closeActiveRepair(taskId: number, generation: number, finalHealthRunId: string, now: string): Promise<number> {
    return this.driver.exec(
      `UPDATE task_repairs SET closed_at = ?, final_health_run_id = ? WHERE task_id = ? AND claim_generation = ? AND closed_at IS NULL`,
      [now, finalHealthRunId, taskId, generation]
    )
  }

  async markAcceptanceMet(criterionId: number): Promise<void> {
    await this.driver.exec(`UPDATE task_acceptance SET met = 1 WHERE id = ?`, [criterionId])
  }

  async getStatusSummary(): Promise<{ status: string; total: number }[]> {
    return this.driver.query<{ status: string; total: number }>(
      `SELECT status, COUNT(*) as total FROM tasks WHERE archived_at IS NULL GROUP BY status`
    )
  }
}
