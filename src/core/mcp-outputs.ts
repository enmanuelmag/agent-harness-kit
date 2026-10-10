import { z } from 'zod'

const string = z.string()
const number = z.number()
const nullableString = string.nullable()
const strings = z.array(string)
const section = z.object({ id: number, type: string, chars: number, createdAt: string })
const metadata = z.object({
  slug: string,
  title: string,
  description: string,
  specKind: string,
  status: string,
  createdAt: string,
  lastUpdated: string,
  sourceSpec: string.optional(),
  sourceUseCases: strings,
  relatedSpecs: z.array(z.object({ slug: string, relationship: string })),
})
const task = z.object({
  id: number,
  slug: string,
  title: string,
  description: nullableString,
  status: string,
  assigned_to: nullableString,
  created_at: string,
  started_at: nullableString,
  completed_at: nullableString,
  archived_at: nullableString,
  updated_at: string,
  health_run_id: nullableString,
  health_status: nullableString,
  health_started_at: nullableString,
  health_completed_at: nullableString,
  health_log_path: nullableString,
  health_script_path: nullableString,
  execution_mode: string,
  claim_generation: number,
})
const health = z.object({
  taskId: number,
  state: string,
  status: number.nullable(),
  tail: string,
  logPath: nullableString,
  scriptPath: string,
  startedAt: string,
  completedAt: string,
  expiresAt: nullableString,
  message: string.optional(),
  adaptFrom: string.optional(),
  runId: string,
  claimGeneration: number,
  executionMode: nullableString,
})
const handoff = z.object({
  goal: string,
  completed: strings,
  decisions: strings,
  files: strings,
  verification: strings,
  blockers: strings,
  nextStep: string,
})
const recorded = z.object({ recorded: z.literal(true) })
const taskValue = z.object({ value: task.nullable() })
const arrayOutput = (items: z.ZodType) => z.object({ items: z.array(items) })
const page = (items: z.ZodType) =>
  z.object({ items: z.array(items), nextOffset: number.nullable() })
const version = z.object({ current: string, latest: nullableString, outdated: z.boolean() })
const names = z.object({ missing: strings, ok: strings })
export const OUTPUT_SCHEMAS: Record<string, z.ZodType> = {
  'specs.list': z.object({
    items: z.array(metadata),
    nextOffset: number.nullable(),
    diagnostics: z.array(z.object({ path: string, message: string })),
  }),
  'specs.get': z.object({
    metadata,
    content: string,
    truncated: z.boolean(),
    nextOffset: number.nullable(),
  }),
  'specs.search': page(z.object({ metadata, excerpt: string })),
  'specs.related': z.object({
    slug: string,
    items: z.array(z.object({ metadata, relationship: string, direction: string })),
  }),
  'specs.create': z.object({ metadata }),
  'specs.update_metadata': z.object({ metadata }),
  'specs.update_content': z.object({ metadata }),
  'specs.transition': z.object({ metadata }),
  'specs.link': z.object({ linked: z.literal(true) }),
  'specs.unlink': z.object({ unlinked: z.literal(true) }),
  'specs.validate': z.object({ valid: z.boolean(), errors: strings }),
  'actions.start': z.object({ actionId: number }),
  'actions.write': recorded,
  'actions.complete': z.object({ status: string, completedAt: nullableString }),
  'actions.get': arrayOutput(
    z.object({
      id: number,
      agent: string,
      status: string,
      created_at: string,
      completed_at: nullableString,
      summary: nullableString,
      sections: z.array(
        z.object({ id: number, section_type: string, content: string, created_at: string })
      ),
    })
  ),
  'actions.list': z.object({
    items: z.array(
      z.object({
        id: number,
        agent: string,
        status: string,
        createdAt: string,
        completedAt: nullableString,
        summaryPreview: nullableString,
        sectionCount: number,
      })
    ),
    nextCursor: nullableString,
  }),
  'actions.get_by_id': z.object({
    id: number,
    taskId: number,
    agent: string,
    status: string,
    summary: nullableString,
    createdAt: string,
    completedAt: nullableString,
    sections: z.array(section),
  }),
  'actions.sections.list': z.object({ items: z.array(section), nextCursor: nullableString }),
  'actions.sections.get': z.object({
    sectionId: number,
    type: string,
    content: string,
    truncated: z.boolean(),
    nextOffset: number.nullable(),
  }),
  'actions.handoff.write': recorded.extend({ recipient: string }),
  'actions.handoff.get': z.union([
    z.object({ found: z.literal(false), reason: z.literal('HANDOFF_NOT_FOUND') }),
    z.object({
      found: z.literal(true),
      taskId: number,
      sourceActionId: number,
      sourceAgent: string,
      recipient: string,
      createdAt: string,
      handoff,
    }),
  ]),
  'tasks.get': arrayOutput(task),
  'tasks.claim': z.union([
    z.object({ error: z.literal('task_already_claimed'), taskId: number.nullable() }),
    z.object({ task: task.nullable(), health, executionMode: nullableString }),
  ]),
  'tasks.add': task,
  'tasks.edit': task,
  'tasks.archive': z.union([task, taskValue]),
  'tasks.unarchive': z.union([task, taskValue]),
  'tasks.update': z.union([task, taskValue, z.object({ task, health })]),
  'tasks.repair.begin': z.object({
    task,
    repair: z.object({
      id: number,
      task_id: number,
      claim_generation: number,
      failed_health_run_id: string,
      reason: string,
      scope: string,
      actor: string,
      created_at: string,
      closed_at: nullableString,
      final_health_run_id: nullableString,
    }),
  }),
  'tasks.acceptance.get': arrayOutput(
    z.object({ id: number, task_id: number, criterion: string, met: number })
  ),
  'tasks.acceptance.update': z.object({ criterionId: number.nullable(), met: z.literal(true) }),
  'health.run': health,
  'docs.search': arrayOutput(z.object({ file: string, line: number, text: string })),
  'permissions.check': z.object({
    in_sync: z.boolean(),
    agents: z.record(string, z.object({ ok: z.boolean(), reason: string.optional() })).optional(),
  }),
  'deps.snapshot': z.object({ message: string, capturedAt: string }),
  'deps.check': z.union([
    z.object({ status: z.literal('no-snapshot'), message: string }),
    z.object({
      significant: z.boolean(),
      added: strings,
      removed: strings,
      majorBumps: z.array(z.object({ name: string, from: string, to: string })),
      advisory: string,
      snapshotDate: string,
    }),
  ]),
  'ahk.doctor': z.object({
    lib: version,
    agents: names,
    skills: names.extend({ outdated: strings }),
  }),
}
