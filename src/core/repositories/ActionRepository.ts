import type { DBDriver } from '../drivers/types'
import type { ActionFileRow, ActionRow, ActionSectionRow, AgentName } from '@/types'

export interface ActionWithDetails extends ActionRow {
  sections: ActionSectionRow[]
  files: ActionFileRow[]
  tools: ActionToolRow[]
}

export interface ActionToolRow {
  id: number
  action_id: string
  tool_name: string
  args_json: string | null
  result_summary: string | null
  called_at: string
}

export class ActionRepository {
  constructor(private driver: DBDriver) {}

  async create(id: string, taskId: number, agent: AgentName, now: string): Promise<void> {
    await this.driver.exec(
      `INSERT INTO actions (id, task_id, agent, status, created_at) VALUES (?, ?, ?, 'in_progress', ?)`,
      [id, taskId, agent, now],
    )
  }

  async complete(actionId: string, summary: string, now: string): Promise<void> {
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

  async getById(actionId: string): Promise<ActionRow | null> {
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

  async addSection(actionId: string, sectionType: string, content: string, now: string): Promise<void> {
    await this.driver.exec(
      `INSERT INTO action_sections (action_id, section_type, content, created_at) VALUES (?, ?, ?, ?)`,
      [actionId, sectionType, content, now],
    )
  }

  async getSections(actionId: string): Promise<ActionSectionRow[]> {
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
    actionId: string,
    filePath: string,
    operation: ActionFileRow['operation'],
    notes: string | null,
  ): Promise<void> {
    await this.driver.exec(
      `INSERT INTO action_files (action_id, file_path, operation, notes) VALUES (?, ?, ?, ?)`,
      [actionId, filePath, operation, notes],
    )
  }

  async getFiles(actionId: string): Promise<ActionFileRow[]> {
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

  // ─── Tools ────────────────────────────────────────────────────────────────

  async addTool(
    actionId: string,
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

  async getTools(actionId: string): Promise<ActionToolRow[]> {
    return this.driver.query<ActionToolRow>(
      `SELECT * FROM action_tools WHERE action_id = ? ORDER BY called_at`,
      [actionId],
    )
  }

  async getTopTools(limit: number): Promise<{ tool_name: string; uses: number }[]> {
    return this.driver.query<{ tool_name: string; uses: number }>(
      `SELECT tool_name, COUNT(*) as uses FROM action_tools GROUP BY tool_name ORDER BY uses DESC LIMIT ?`,
      [limit],
    )
  }
}
