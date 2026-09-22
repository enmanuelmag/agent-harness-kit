// Result shapes for queryRaw calls in dashboard-server.ts

export interface CountRow {
  total: number
}

export interface TaskListRow {
  id: number
  slug: string
  title: string
  description: string | null
  status: string
  assigned_to: string | null
  created_at: string
  started_at: string | null
  completed_at: string | null
  acceptance_total: number
  acceptance_met: number
}

export interface AgentStatRow {
  agent: string
  actions_total: number
  actions_done: number
  actions_blocked: number
  tasks_worked: number
}

export interface TimelineRow {
  id: number
  agent: string
  status: string
  summary: string | null
  created_at: string
  completed_at: string | null
  task_id: number
  task_title: string
  task_slug: string
  task_status: string
}
