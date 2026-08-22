import type { DBDriver } from '../drivers/types'
import type { ActionFileRow, ActionRow, ActionSectionRow, ActionToolRow, AgentName } from '@/types'

export interface ActionWithDetails extends ActionRow {
  sections: ActionSectionRow[]
  files: ActionFileRow[]
  tools: ActionToolRow[]
}

export interface ActionListRow extends ActionRow {
  section_count: number
}

export interface ActionSectionIndexRow {
  id: number
  action_id: number
  section_type: string
  chars: number
  created_at: string
}

export class ActionRepository {
  constructor(private driver: DBDriver) {}

  /** Returns the new autoincrement id — mirrors TaskRepository.add(). Since
   *  task #73, `actions.id` is a driver-generated INTEGER, not an
   *  application-generated UUID, so callers no longer pass an id in. */
  async create(taskId: number, agent: AgentName, now: string): Promise<number> {
    return this.driver.insert(
      `INSERT INTO actions (task_id, agent, status, created_at) VALUES (?, ?, 'in_progress', ?)`,
      [taskId, agent, now],
    )
  }

  async complete(actionId: number, summary: string, now: string): Promise<void> {
    await this.driver.exec(
      `UPDATE actions SET status = 'completed', completed_at = ?, summary = ? WHERE id = ?`,
      [now, summary, actionId],
    )
  }

  async closeOrphaned(taskId: number, now: string): Promise<number> {
    return this.driver.exec(
      `UPDATE actions SET status = 'completed', completed_at = ?, summary = 'Auto-closed: task marked done' WHERE task_id = ? AND status = 'in_progress'`,
      [now, taskId],
    )
  }

  async getById(actionId: number): Promise<ActionRow | null> {
    return this.driver.queryOne<ActionRow>(`SELECT * FROM actions WHERE id = ?`, [actionId])
  }

  async getForTask(taskId: number): Promise<ActionRow[]> {
    return this.driver.query<ActionRow>(
      `SELECT * FROM actions WHERE task_id = ? ORDER BY created_at`,
      [taskId],
    )
  }

  /** Compact newest-first index used by actions.list. The cursor is the last
   *  row from the previous page, so it remains stable when new actions arrive. */
  async listForTask(
    taskId: number,
    options: {
      agent?: AgentName
      status?: ActionRow['status']
      cursor?: { createdAt: string; id: number }
      limit: number
    },
  ): Promise<ActionListRow[]> {
    const where = ['a.task_id = ?']
    const params: unknown[] = [taskId]
    if (options.agent) {
      where.push('a.agent = ?')
      params.push(options.agent)
    }
    if (options.status) {
      where.push('a.status = ?')
      params.push(options.status)
    }
    if (options.cursor) {
      where.push('(a.created_at < ? OR (a.created_at = ? AND a.id < ?))')
      params.push(options.cursor.createdAt, options.cursor.createdAt, options.cursor.id)
    }
    params.push(options.limit)
    return this.driver.query<ActionListRow>(
      `SELECT a.*, COUNT(s.id) AS section_count
       FROM actions a LEFT JOIN action_sections s ON s.action_id = a.id
       WHERE ${where.join(' AND ')}
       GROUP BY a.id, a.task_id, a.agent, a.status, a.created_at, a.completed_at, a.summary
       ORDER BY a.created_at DESC, a.id DESC LIMIT ?`,
      params,
    )
  }

  async getAll(): Promise<ActionRow[]> {
    return this.driver.query<ActionRow>(`SELECT * FROM actions ORDER BY created_at`)
  }

  async getWithDetails(taskId: number): Promise<ActionWithDetails[]> {
    const actions = await this.getForTask(taskId)
    return Promise.all(
      actions.map(async (action) => ({
        ...action,
        sections: await this.getSections(action.id),
        files: await this.getFiles(action.id),
        tools: await this.getTools(action.id),
      })),
    )
  }

  // ─── Sections ─────────────────────────────────────────────────────────────

  async addSection(actionId: number, sectionType: string, content: string, now: string): Promise<void> {
    await this.driver.exec(
      `INSERT INTO action_sections (action_id, section_type, content, created_at) VALUES (?, ?, ?, ?)`,
      [actionId, sectionType, content, now],
    )
  }

  async getSections(actionId: number): Promise<ActionSectionRow[]> {
    return this.driver.query<ActionSectionRow>(
      `SELECT * FROM action_sections WHERE action_id = ? ORDER BY created_at`,
      [actionId],
    )
  }

  async getSectionById(sectionId: number): Promise<ActionSectionRow | null> {
    return this.driver.queryOne<ActionSectionRow>(`SELECT * FROM action_sections WHERE id = ?`, [sectionId])
  }

  async listSections(
    actionId: number,
    options: { types?: string[]; cursor?: number; limit: number },
  ): Promise<ActionSectionIndexRow[]> {
    const where = ['action_id = ?']
    const params: unknown[] = [actionId]
    if (options.types?.length) {
      where.push(`section_type IN (${options.types.map(() => '?').join(', ')})`)
      params.push(...options.types)
    }
    if (options.cursor !== undefined) {
      where.push('id < ?')
      params.push(options.cursor)
    }
    params.push(options.limit)
    return this.driver.query<ActionSectionIndexRow>(
      `SELECT id, action_id, section_type, LENGTH(content) AS chars, created_at
       FROM action_sections WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ?`,
      params,
    )
  }

  async getCompletedHandoffSections(taskId: number): Promise<Array<ActionSectionRow & Pick<ActionRow, 'agent' | 'completed_at'>>> {
    return this.driver.query(
      `SELECT s.*, a.agent, a.completed_at
       FROM action_sections s JOIN actions a ON a.id = s.action_id
       WHERE a.task_id = ? AND a.status = 'completed' AND s.section_type = 'handoff'
       ORDER BY s.created_at DESC, s.id DESC`,
      [taskId],
    )
  }

  async getAllSections(): Promise<ActionSectionRow[]> {
    return this.driver.query<ActionSectionRow>(`SELECT * FROM action_sections ORDER BY created_at`)
  }

  // ─── Files ────────────────────────────────────────────────────────────────

  async addFile(
    actionId: number,
    filePath: string,
    operation: ActionFileRow['operation'],
    notes: string | null,
  ): Promise<void> {
    await this.driver.exec(
      `INSERT INTO action_files (action_id, file_path, operation, notes) VALUES (?, ?, ?, ?)`,
      [actionId, filePath, operation, notes],
    )
  }

  async getFiles(actionId: number): Promise<ActionFileRow[]> {
    return this.driver.query<ActionFileRow>(
      `SELECT * FROM action_files WHERE action_id = ?`,
      [actionId],
    )
  }

  async getFilesForTask(taskId: number): Promise<(ActionFileRow & { agent: AgentName })[]> {
    return this.driver.query<ActionFileRow & { agent: AgentName }>(
      `SELECT af.*, a.agent FROM action_files af JOIN actions a ON af.action_id = a.id WHERE a.task_id = ? ORDER BY a.agent, af.operation`,
      [taskId],
    )
  }

  /** Returns ALL action_files rows regardless of action — used by full DB
   *  exports (e.g. `ahk migrate storage`) so file-touch records aren't lost. */
  async getAllFiles(): Promise<ActionFileRow[]> {
    return this.driver.query<ActionFileRow>(`SELECT * FROM action_files ORDER BY id`)
  }

  // ─── Tools ────────────────────────────────────────────────────────────────

  async addTool(
    actionId: number,
    toolName: string,
    argsJson: string | null,
    resultSummary: string | null,
    now: string,
  ): Promise<void> {
    await this.driver.exec(
      `INSERT INTO action_tools (action_id, tool_name, args_json, result_summary, called_at) VALUES (?, ?, ?, ?, ?)`,
      [actionId, toolName, argsJson, resultSummary, now],
    )
  }

  async getTools(actionId: number): Promise<ActionToolRow[]> {
    return this.driver.query<ActionToolRow>(
      `SELECT * FROM action_tools WHERE action_id = ? ORDER BY called_at`,
      [actionId],
    )
  }

  /** Returns ALL action_tools rows regardless of action — used by full DB
   *  exports (e.g. `ahk migrate storage`) so tool-call records aren't lost. */
  async getAllTools(): Promise<ActionToolRow[]> {
    return this.driver.query<ActionToolRow>(`SELECT * FROM action_tools ORDER BY id`)
  }

  async getTopTools(limit: number): Promise<{ tool_name: string; uses: number }[]> {
    return this.driver.query<{ tool_name: string; uses: number }>(
      `SELECT tool_name, COUNT(*) as uses FROM action_tools GROUP BY tool_name ORDER BY uses DESC LIMIT ?`,
      [limit],
    )
  }
}
