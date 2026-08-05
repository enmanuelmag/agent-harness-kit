import type { DBDriver } from '../drivers/types'
import type { ActionFileRow, ActionRow, ActionSectionRow, ActionToolRow, AgentName } from '@/types'

export interface ActionWithDetails extends ActionRow {
  sections: ActionSectionRow[]
  files: ActionFileRow[]
  tools: ActionToolRow[]
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
