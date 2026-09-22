import type { DBDriver } from '../drivers/types'
import type {
  AgentStatRow,
  CountRow,
  TimelineRow,
} from '../server-types'

export interface DBCounts {
  totalActions: number
  activeAgents: number
}

export { AgentStatRow, TimelineRow }

const AGENT_ORDER = ['lead', 'explorer', 'builder', 'reviewer']

export class StatsRepository {
  constructor(private driver: DBDriver) {}

  async getCounts(): Promise<DBCounts> {
    const [{ total: totalActions }] = await this.driver.query<CountRow>(
      `SELECT COUNT(*) as total FROM actions`
    )
    const [{ total: activeAgents }] = await this.driver.query<CountRow>(
      `SELECT COUNT(DISTINCT agent) as total FROM actions WHERE status = 'in_progress'`
    )
    return { totalActions, activeAgents }
  }

  async getAgentStats(): Promise<AgentStatRow[]> {
    const rows = await this.driver.query<AgentStatRow>(
      `SELECT
        a.agent,
        COUNT(*)                                              as actions_total,
        SUM(CASE WHEN a.status='completed' THEN 1 ELSE 0 END) as actions_done,
        SUM(CASE WHEN a.status='blocked'   THEN 1 ELSE 0 END) as actions_blocked,
        COUNT(DISTINCT a.task_id)                             as tasks_worked
       FROM actions a
       GROUP BY a.agent
       ORDER BY actions_total DESC`
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
      [limit]
    )
  }
}
