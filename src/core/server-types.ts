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

export interface RecentToolRow {
  id: number
  tool_name: string
  args_json: string | null
  result_summary: string | null
  called_at: string
  task_id: number
  task_title: string
  task_slug: string
  agent: string
}

export interface TopFileRow {
  file_path: string
  total: number
  read: number
  created: number
  modified: number
  deleted: number
}

export interface RecentFileRow {
  id: number
  file_path: string
  operation: string
  notes: string | null
  task_id: number
  task_title: string
  task_slug: string
  agent: string
  called_at: string
}

export interface AgentStatRow {
  agent: string
  actions_total: number
  actions_done: number
  actions_blocked: number
  tasks_worked: number
  files_touched: number
}

export interface TimelineRow {
  id: string
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
