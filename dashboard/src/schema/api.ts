import * as v from 'valibot'

// Overview stats
export const StatsOverviewSchema = v.object({
  byStatus: v.object({
    pending: v.number(),
    in_progress: v.number(),
    done: v.number(),
    blocked: v.number(),
  }),
  totalActions: v.number(),
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

export const ActionDetailSchema = v.object({
  id: v.string(),
  task_id: v.number(),
  agent: v.string(),
  status: v.enum(StatusEnum),
  created_at: v.string(),
  completed_at: v.nullable(v.string()),
  summary: v.nullable(v.string()),
  sections: v.array(ActionSectionSchema),
})

export type ActionDetail = v.InferOutput<typeof ActionDetailSchema>

export const TaskDetailSchema = v.intersect([
  TaskSummarySchema,
  v.object({
    acceptance: v.array(AcceptanceCriterionSchema),
    actions: v.array(ActionDetailSchema),
  }),
])

export type TaskDetail = v.InferOutput<typeof TaskDetailSchema>

export const AgentStatSchema = v.object({
  agent: v.string(),
  actions_total: v.number(),
  actions_done: v.number(),
  actions_blocked: v.number(),
  tasks_worked: v.number(),
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
