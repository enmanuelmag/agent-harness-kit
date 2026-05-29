import * as v from 'valibot';

// Overview stats
export const StatsOverviewSchema = v.object({
  byStatus: v.object({
    pending: v.number(),
    in_progress: v.number(),
    done: v.number(),
    blocked: v.number(),
  }),
  totalActions: v.number(),
  totalFiles: v.number(),
  uniqueTools: v.number(),
  activeAgents: v.number(),
})

export type StatsOverview = v.InferOutput<typeof StatsOverviewSchema>

export enum StatusEnum {
  pending = 'pending',
  in_progress = 'in_progress',
  done = 'done',
  blocked = 'blocked',
}

export const StatusEnumSchema = v.enum(StatusEnum)


// Tasks
export const TaskSummarySchema = v.object({
  id: v.number(),
  slug: v.string(),
  title: v.string(),
  description: v.nullable(v.string()),
  status: StatusEnumSchema,
  assigned_to: v.nullable(v.string()),
  created_at: v.string(),
  started_at: v.nullable(v.string()),
  completed_at: v.nullable(v.string()),
  archived_at: v.nullable(v.string()),
  acceptance_total: v.number(),
  acceptance_met: v.number(),
})

export type TaskSummary = v.InferOutput<typeof TaskSummarySchema>

// Task details
export const AcceptanceCriterionSchema = v.object({
  id: v.number(),
  task_id: v.number(),
  criterion: v.string(),
  met: v.number(),
})

export type AcceptanceCriterion = v.InferOutput<typeof AcceptanceCriterionSchema>

export const ActionSectionSchema = v.object({
  id: v.number(),
  action_id: v.string(),
  section_type: v.string(),
  content: v.string(),
  created_at: v.string(),
})

export type ActionSection = v.InferOutput<typeof ActionSectionSchema>

export enum OperationEnum {
  read = 'read',
  created = 'created',
  modified = 'modified',
  deleted = 'deleted',
}

export const FileOpSchema = v.object({
  id: v.number(),
  action_id: v.string(),
  file_path: v.string(),
  operation: v.enum(OperationEnum),
  notes: v.nullable(v.string()),
})

export type FileOp = v.InferOutput<typeof FileOpSchema>

export const ToolCallSchema = v.object({
  id: v.number(),
  action_id: v.string(),
  tool_name: v.string(),
  args_json: v.nullable(v.string()),
  result_summary: v.nullable(v.string()),
  called_at: v.string(),
})

export type ToolCall = v.InferOutput<typeof ToolCallSchema>

export const ActionDetailSchema = v.object({
  id: v.string(),
  task_id: v.number(),
  agent: v.string(),
  status: v.enum(StatusEnum),
  created_at: v.string(),
  completed_at: v.nullable(v.string()),
  summary: v.nullable(v.string()),
  sections: v.array(ActionSectionSchema),
  files: v.array(FileOpSchema),
  tools: v.array(ToolCallSchema),
})

export type ActionDetail = v.InferOutput<typeof ActionDetailSchema>

export const TaskDetailSchema = v.intersect([TaskSummarySchema, v.object({
  acceptance: v.array(AcceptanceCriterionSchema),
  actions: v.array(ActionDetailSchema),
})])

export type TaskDetail = v.InferOutput<typeof TaskDetailSchema>

// Stats for tools and files
export const TopToolSchema = v.object({
  tool_name: v.string(),
  uses: v.number(),
})

export type TopTool = v.InferOutput<typeof TopToolSchema>

export const RecentToolSchema = v.object({
  id: v.number(),
  tool_name: v.string(),
  args_json: v.nullable(v.string()),
  result_summary: v.nullable(v.string()),
  called_at: v.string(),
  task_id: v.number(),
  task_title: v.string(),
  task_slug: v.string(),
  agent: v.string(),
})

export type RecentTool = v.InferOutput<typeof RecentToolSchema>

export const TopFileSchema = v.object({
  file_path: v.string(),
  total: v.number(),
  read: v.number(),
  created: v.number(),
  modified: v.number(),
  deleted: v.number(),
})

export type TopFile = v.InferOutput<typeof TopFileSchema>

export const RecentFileSchema = v.object({
  id: v.number(),
  file_path: v.string(),
  operation: v.string(),
  notes: v.nullable(v.string()),
  task_id: v.number(),
  task_title: v.string(),
  task_slug: v.string(),
  agent: v.string(),
  called_at: v.string(),
})

export type RecentFile = v.InferOutput<typeof RecentFileSchema>

export const AgentStatSchema = v.object({
  agent: v.string(),
  actions_total: v.number(),
  actions_done: v.number(),
  actions_blocked: v.number(),
  tasks_worked: v.number(),
  files_touched: v.number(),
})

export type AgentStat = v.InferOutput<typeof AgentStatSchema>

export const TimelineEntrySchema = v.object({
  id: v.number(),
  task_id: v.number(),
  task_title: v.string(),
  task_slug: v.string(),
  agent: v.string(),
  status: v.enum(StatusEnum),
  summary: v.nullable(v.string()),
  created_at: v.string(),
})

export type TimelineEntry = v.InferOutput<typeof TimelineEntrySchema>