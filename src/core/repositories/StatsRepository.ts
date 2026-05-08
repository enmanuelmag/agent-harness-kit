import type { DBDriver } from '../drivers/types'
import type {
  AgentStatRow,
  CountRow,
  RecentFileRow,
  RecentToolRow,
  TimelineRow,
  TopFileRow,
} from '../server-types'

export interface DBCounts {
  totalActions: number
  totalFiles: number
  uniqueTools: number
  activeAgents: number
}

export { AgentStatRow, RecentFileRow, RecentToolRow, TimelineRow, TopFileRow }

const AGENT_ORDER = ['lead', 'explorer', 'builder', 'reviewer']

export class StatsRepository {
  constructor(private driver: DBDriver) { }

  async getCounts(): Promise<DBCounts> {
    const [{ total: totalActions }] = await this.driver.query<CountRow>(
      `SELECT COUNT(*) as total FROM actions`,
    )
    const [{ total: totalFiles }] = await this.driver.query<CountRow>(
      `SELECT COUNT(*) as total FROM action_files`,
    )
    const [{ total: uniqueTools }] = await this.driver.query<CountRow>(
      `SELECT COUNT(DISTINCT tool_name) as total FROM action_tools`,
    )
    const [{ total: activeAgents }] = await this.driver.query<CountRow>(
      `SELECT COUNT(DISTINCT agent) as total FROM actions WHERE status = 'in_progress'`,
    )
    return { totalActions, totalFiles, uniqueTools, activeAgents }
  }

  async getRecentTools(limit: number): Promise<RecentToolRow[]> {
    return this.driver.query<RecentToolRow>(
      `SELECT at.*, t.id as task_id, t.title as task_title, t.slug as task_slug, a.agent
       FROM action_tools at
       JOIN actions a ON at.action_id = a.id
       JOIN tasks t ON a.task_id = t.id
       ORDER BY at.called_at DESC
       LIMIT ?`,
      [limit],
    )
  }

  async getTopFiles(limit: number): Promise<TopFileRow[]> {
    return this.driver.query<TopFileRow>(
      `SELECT
        file_path,
        COUNT(*) as total,
        SUM(CASE WHEN operation='read'     THEN 1 ELSE 0 END) as read,
        SUM(CASE WHEN operation='created'  THEN 1 ELSE 0 END) as created,
        SUM(CASE WHEN operation='modified' THEN 1 ELSE 0 END) as modified,
        SUM(CASE WHEN operation='deleted'  THEN 1 ELSE 0 END) as deleted
       FROM action_files
       GROUP BY file_path
       ORDER BY total DESC
       LIMIT ?`,
      [limit],
    )
  }

  async getRecentFiles(limit: number): Promise<RecentFileRow[]> {
    return this.driver.query<RecentFileRow>(
      `SELECT af.*, t.id as task_id, t.title as task_title, t.slug as task_slug,
        a.agent, a.created_at as called_at
       FROM action_files af
       JOIN actions a ON af.action_id = a.id
       JOIN tasks t ON a.task_id = t.id
       ORDER BY a.created_at DESC
       LIMIT ?`,
      [limit],
    )
  }

  async getAgentStats(): Promise<AgentStatRow[]> {
    const rows = await this.driver.query<AgentStatRow>(
      `SELECT
        a.agent,
        COUNT(*)                                              as actions_total,
        SUM(CASE WHEN a.status='completed' THEN 1 ELSE 0 END) as actions_done,
        SUM(CASE WHEN a.status='blocked'   THEN 1 ELSE 0 END) as actions_blocked,
        COUNT(DISTINCT a.task_id)                             as tasks_worked,
        COUNT(DISTINCT af.file_path)                          as files_touched
       FROM actions a
       LEFT JOIN action_files af ON af.action_id = a.id
       GROUP BY a.agent
       ORDER BY actions_total DESC`,
    )
    return rows.sort((a, b) => {
      const ai = AGENT_ORDER.indexOf(a.agent)
      const bi = AGENT_ORDER.indexOf(b.agent)
      if (ai === -1 && bi === -1) return 0
      if (ai === -1) return 1
      if (bi === -1) return -1
      return ai - bi
    })
  }

  async getTimeline(limit: number): Promise<TimelineRow[]> {
    return this.driver.query<TimelineRow>(
      `SELECT a.*, t.title as task_title, t.slug as task_slug, t.status as task_status
       FROM actions a
       JOIN tasks t ON a.task_id = t.id
       ORDER BY a.created_at DESC
       LIMIT ?`,
      [limit],
    )
  }
}
