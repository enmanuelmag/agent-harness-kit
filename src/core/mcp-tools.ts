import { z } from 'zod'

import { recover } from './mcp-field-recovery'
import * as recovery from './mcp-normalizers'
import { OUTPUT_SCHEMAS } from './mcp-outputs'
import { RELATIONSHIPS, SPEC_KINDS } from './specs'

// Canonical Zod fields are the only authored input schema source.
export const TOOLS = [
  {
    name: 'specs.list',
    description:
      'List use cases from docs/use-cases and specifications from docs/specs without loading bodies.',
    inputSchema: z.object({
      specKind: recover(z.enum(SPEC_KINDS).optional(), recovery.optionalStr, 0),
      status: recover(z.string().optional(), recovery.optionalStr, 2),
      query: recover(z.string().optional(), recovery.optionalStr, 1),
      offset: recover(
        z.number().optional(),
        (args, key) => recovery.boundedInt(args, key, 0, 0, Number.MAX_SAFE_INTEGER),
        3
      ),
      limit: recover(
        z.number().optional(),
        (args, key) => recovery.boundedInt(args, key, 50, 1, 100),
        4
      ),
    }),
    outputSchema: OUTPUT_SCHEMAS['specs.list'],
  },
  {
    name: 'specs.get',
    description: 'Read one specification body by slug with an explicit offset and limit.',
    inputSchema: z.object({
      slug: recover(z.string(), recovery.str, 0),
      offset: recover(
        z.number().optional(),
        (args, key) => recovery.boundedInt(args, key, 0, 0, Number.MAX_SAFE_INTEGER),
        1
      ),
      limit: recover(
        z.number().optional(),
        (args, key) => recovery.boundedInt(args, key, 8000, 1, 12000),
        2
      ),
    }),
    outputSchema: OUTPUT_SCHEMAS['specs.get'],
  },
  {
    name: 'specs.search',
    description: 'Search specification metadata and body content with bounded excerpts.',
    inputSchema: z.object({
      query: recover(z.string(), recovery.str, 2),
      specKind: recover(z.enum(SPEC_KINDS).optional(), recovery.optionalStr, 0),
      status: recover(z.string().optional(), recovery.optionalStr, 1),
      offset: recover(
        z.number().optional(),
        (args, key) => recovery.boundedInt(args, key, 0, 0, Number.MAX_SAFE_INTEGER),
        3
      ),
      limit: recover(
        z.number().optional(),
        (args, key) => recovery.boundedInt(args, key, 50, 1, 100),
        4
      ),
    }),
    outputSchema: OUTPUT_SCHEMAS['specs.search'],
  },
  {
    name: 'specs.related',
    description: 'List related specification headers and edges without their bodies.',
    inputSchema: z.object({
      slug: recover(z.string(), recovery.str, 0),
      relationships: recover(
        z.array(z.enum(RELATIONSHIPS)).optional(),
        recovery.optionalStringArray,
        1
      ),
    }),
    outputSchema: OUTPUT_SCHEMAS['specs.related'],
  },
  {
    name: 'specs.create',
    description:
      'Create a validated use case in docs/use-cases or specification in docs/specs from structured fields.',
    inputSchema: z.object({
      slug: recover(z.string(), recovery.str, 1),
      title: recover(z.string(), recovery.str, 2),
      description: recover(z.string(), recovery.str, 3),
      specKind: recover(z.enum(SPEC_KINDS), recovery.str, 0),
      status: recover(z.string().optional(), recovery.optionalStr, 4),
      sourceSpec: recover(z.string().optional(), recovery.optionalStr, 5),
      sourceUseCases: recover(z.array(z.string()).optional(), recovery.optionalStringArray, 6),
      content: recover(z.string(), recovery.str, 7),
    }),
    outputSchema: OUTPUT_SCHEMAS['specs.create'],
  },
  {
    name: 'specs.update_metadata',
    description: 'Update validated metadata fields without hand-editing frontmatter.',
    inputSchema: z.object({
      slug: recover(z.string(), recovery.str, 5),
      title: recover(z.string().optional(), recovery.str, 0),
      description: recover(z.string().optional(), recovery.str, 1),
      status: recover(z.string().optional(), recovery.str, 2),
      sourceSpec: recover(z.string().optional(), recovery.str, 3),
      sourceUseCases: recover(z.array(z.string()).optional(), recovery.optionalStringArray, 4),
    }),
    outputSchema: OUTPUT_SCHEMAS['specs.update_metadata'],
  },
  {
    name: 'specs.update_content',
    description: 'Replace a specification body while preserving its validated frontmatter.',
    inputSchema: z.object({
      slug: recover(z.string(), recovery.str, 0),
      content: recover(z.string(), recovery.str, 1),
    }),
    outputSchema: OUTPUT_SCHEMAS['specs.update_content'],
  },
  {
    name: 'specs.transition',
    description: 'Change a specification status while enforcing source approval rules.',
    inputSchema: z.object({
      slug: recover(z.string(), recovery.str, 0),
      status: recover(z.string(), recovery.str, 1),
    }),
    outputSchema: OUTPUT_SCHEMAS['specs.transition'],
  },
  {
    name: 'specs.link',
    description: 'Create a bidirectional validated relationship between two specifications.',
    inputSchema: z.object({
      slug: recover(z.string(), recovery.str, 0),
      targetSlug: recover(z.string(), recovery.str, 1),
      relationship: recover(z.enum(RELATIONSHIPS), recovery.str, 2),
    }),
    outputSchema: OUTPUT_SCHEMAS['specs.link'],
  },
  {
    name: 'specs.unlink',
    description: 'Remove a relationship and its inverse from two specifications.',
    inputSchema: z.object({
      slug: recover(z.string(), recovery.str, 0),
      targetSlug: recover(z.string(), recovery.str, 1),
      relationship: recover(z.enum(RELATIONSHIPS), recovery.str, 2),
    }),
    outputSchema: OUTPUT_SCHEMAS['specs.unlink'],
  },
  {
    name: 'specs.validate',
    description:
      'Validate docs/use-cases and docs/specs frontmatter, links, and source references.',
    inputSchema: z.object({}),
    outputSchema: OUTPUT_SCHEMAS['specs.validate'],
  },
  {
    name: 'health.run',
    description:
      'Run the native health check for a task and persist server-owned completion evidence. Run before work and immediately before tasks.update(done).',
    inputSchema: z.object({
      taskId: recover(z.number().describe('Positive task ID'), recovery.num, 0),
    }),
    outputSchema: OUTPUT_SCHEMAS['health.run'],
  },
  {
    name: 'actions.start',
    description: 'Start a new action for a task. Returns an actionId.',
    inputSchema: z.object({
      taskId: recover(z.number().describe('The task ID from tasks.get'), recovery.num, 0),
      agent: recover(
        z
          .string()
          .describe(
            'Agent name: lead | explorer | consultant | builder | reviewer | custom:<name>'
          ),
        recovery.str,
        1
      ),
    }),
    outputSchema: OUTPUT_SCHEMAS['actions.start'],
  },
  {
    name: 'actions.write',
    description: 'Record a free-form section in an action.',
    inputSchema: z.object({
      actionId: recover(
        z.number().describe('The actionId returned by actions.start'),
        recovery.num,
        0
      ),
      sectionType: recover(
        z
          .string()
          .describe('Section name, such as result, blockers, next_steps, or a custom name.'),
        recovery.str,
        1
      ),
      content: recover(
        z
          .string()
          .describe(
            'Content for this section. No length limit; avoid padding \u2014 it costs shared context for other agents.'
          ),
        recovery.str,
        2
      ),
    }),
    outputSchema: OUTPUT_SCHEMAS['actions.write'],
  },
  {
    name: 'actions.complete',
    description: 'Close an action with a one-line summary.',
    inputSchema: z.object({
      actionId: recover(
        z.number().describe('The actionId of the action to close'),
        recovery.num,
        0
      ),
      summary: recover(z.string().describe('One-line summary of what was done'), recovery.str, 1),
    }),
    outputSchema: OUTPUT_SCHEMAS['actions.complete'],
  },
  {
    name: 'actions.get',
    description:
      'Full task action history, including every action and section. Potentially large; use only for audit or diagnosis.',
    inputSchema: z.object({
      taskId: recover(z.number().describe('Task ID'), recovery.num, 0),
    }),
    outputSchema: OUTPUT_SCHEMAS['actions.get'],
  },
  {
    name: 'actions.list',
    description:
      'Compact newest-first action index. Use to discover actions before reading a specific action or section.',
    inputSchema: z.object({
      taskId: recover(z.number().describe('Task ID'), recovery.num, 0),
      agent: z.string().optional().describe('Optional agent filter'),
      status: z
        .enum(['in_progress', 'completed', 'blocked'])
        .optional()
        .describe('Optional action status filter'),
      cursor: recover(
        z.string().optional().describe('Opaque cursor returned as nextCursor'),
        recovery.optionalStr,
        1
      ),
      limit: recover(
        z.number().optional().describe('Maximum items (1-100; default 20)'),
        (args, key) => recovery.boundedInt(args, key, 20, 1, 100),
        2
      ),
    }),
    outputSchema: OUTPUT_SCHEMAS['actions.list'],
  },
  {
    name: 'actions.get_by_id',
    description:
      'Get one action and a compact index of its sections; section contents are not included.',
    inputSchema: z.object({
      actionId: recover(z.number().describe('Action ID'), recovery.num, 0),
    }),
    outputSchema: OUTPUT_SCHEMAS['actions.get_by_id'],
  },
  {
    name: 'actions.sections.list',
    description:
      'Compact newest-first section index for one action. Filter by section types without loading content.',
    inputSchema: z.object({
      actionId: recover(z.number().describe('Action ID'), recovery.num, 0),
      types: recover(
        z.array(z.string()).optional().describe('Optional section-type filter'),
        recovery.optionalStringArray,
        1
      ),
      cursor: recover(
        z.string().optional().describe('Opaque cursor returned as nextCursor'),
        recovery.optionalStr,
        2
      ),
      limit: recover(
        z.number().optional().describe('Maximum items (1-100; default 20)'),
        (args, key) => recovery.boundedInt(args, key, 20, 1, 100),
        3
      ),
    }),
    outputSchema: OUTPUT_SCHEMAS['actions.sections.list'],
  },
  {
    name: 'actions.sections.get',
    description:
      'Read one section content with an explicit character range. This is the only generic action reader that returns long text.',
    inputSchema: z.object({
      sectionId: recover(z.number().describe('Section ID'), recovery.num, 0),
      offset: recover(
        z.number().optional().describe('Zero-based character offset (default 0)'),
        (args, key) => recovery.boundedInt(args, key, 0, 0, Number.MAX_SAFE_INTEGER),
        1
      ),
      length: recover(
        z.number().optional().describe('Characters to return (1-12000; default 8000)'),
        (args, key) => recovery.boundedInt(args, key, 8000, 1, 12000),
        2
      ),
    }),
    outputSchema: OUTPUT_SCHEMAS['actions.sections.get'],
  },
  {
    name: 'actions.handoff.write',
    description:
      'Write a validated, recipient-directed, bounded handoff for a completed action to resume work without loading the full history.',
    inputSchema: z.object({
      actionId: recover(z.number().describe('Producer action ID'), recovery.num, 0),
      recipient: z.enum(['lead', 'explorer', 'consultant', 'builder', 'reviewer']),
      goal: recover(z.string(), recovery.str, 6),
      completed: recover(z.array(z.string()), recovery.requiredStringArray, 1),
      decisions: recover(z.array(z.string()), recovery.requiredStringArray, 2),
      files: recover(z.array(z.string()), recovery.requiredStringArray, 3),
      verification: recover(z.array(z.string()), recovery.requiredStringArray, 4),
      blockers: recover(z.array(z.string()), recovery.requiredStringArray, 5),
      nextStep: recover(z.string(), recovery.str, 7),
    }),
    outputSchema: OUTPUT_SCHEMAS['actions.handoff.write'],
  },
  {
    name: 'actions.handoff.get',
    description:
      'Get the newest completed canonical handoff addressed to a recipient. Returns HANDOFF_NOT_FOUND instead of falling back to history.',
    inputSchema: z.object({
      taskId: recover(z.number().describe('Task ID'), recovery.num, 0),
      recipient: z
        .enum(['lead', 'explorer', 'consultant', 'builder', 'reviewer'])
        .optional()
        .describe('Recipient role; defaults to builder'),
    }),
    outputSchema: OUTPUT_SCHEMAS['actions.handoff.get'],
  },
  {
    name: 'tasks.get',
    description: 'List tasks, optionally filtered by status. Excludes archived tasks by default.',
    inputSchema: z.object({
      status: z
        .enum(['pending', 'in_progress', 'done', 'blocked'])
        .optional()
        .describe('Filter by status (omit for all tasks)'),
      includeArchived: z
        .boolean()
        .optional()
        .describe('If true, include archived tasks in results'),
    }),
    outputSchema: OUTPUT_SCHEMAS['tasks.get'],
  },
  {
    name: 'tasks.claim',
    description:
      'Atomically claim a pending task and run server-owned health automatically. Returns the task, health result, and execution mode.',
    inputSchema: z.object({
      id: recover(z.number().describe('Task ID to claim'), recovery.num, 0),
      agent: recover(z.string().describe('Your agent name'), recovery.str, 1),
    }),
    outputSchema: OUTPUT_SCHEMAS['tasks.claim'],
  },
  {
    name: 'tasks.repair.begin',
    description:
      'Enter an audited repair mode after a failed server-owned health run. Requires a bounded reason and scope.',
    inputSchema: z.object({
      taskId: recover(z.number(), recovery.num, 0),
      actor: recover(z.string(), recovery.str, 1),
      reason: recover(z.string(), recovery.str, 2),
      scope: recover(z.string(), recovery.str, 3),
    }),
    outputSchema: OUTPUT_SCHEMAS['tasks.repair.begin'],
  },
  {
    name: 'tasks.update',
    description: 'Change the status of a task.',
    inputSchema: z.object({
      id: recover(z.number().describe('Task ID'), recovery.num, 0),
      status: recover(z.enum(['pending', 'in_progress', 'done', 'blocked']), recovery.str, 1),
    }),
    outputSchema: OUTPUT_SCHEMAS['tasks.update'],
  },
  {
    name: 'docs.search',
    description: 'Search the project docs folder for content matching a query.',
    inputSchema: z.object({
      query: recover(z.string().describe('Search terms'), recovery.str, 0),
    }),
    outputSchema: OUTPUT_SCHEMAS['docs.search'],
  },
  {
    name: 'tasks.acceptance.update',
    description: 'Mark an acceptance criterion as met. Use the criterion id from tasks.get.',
    inputSchema: z.object({
      criterionId: recover(
        z.number().describe('The id of the acceptance criterion to mark as met'),
        recovery.num,
        0
      ),
    }),
    outputSchema: OUTPUT_SCHEMAS['tasks.acceptance.update'],
  },
  {
    name: 'tasks.acceptance.get',
    description:
      'Given a taskId, returns all acceptance criteria for that task with their id, task_id, criterion text, and met status. Use the returned id values to call tasks.acceptance_update(criterionId).',
    inputSchema: z.object({
      taskId: recover(z.number().describe('Task ID'), recovery.num, 0),
    }),
    outputSchema: OUTPUT_SCHEMAS['tasks.acceptance.get'],
  },
  {
    name: 'tasks.add',
    description:
      'Create a new task in the harness. Use this when the user describes work in natural language. Infer slug, title, description, and acceptance criteria from the conversation. Ask for missing critical info before calling.',
    inputSchema: z.object({
      title: recover(
        z.string().describe('Short human-readable title for the task'),
        recovery.str,
        0
      ),
      slug: z
        .string()
        .optional()
        .describe('URL-safe identifier (lowercase, hyphens). Auto-derived from title if omitted.'),
      description: z
        .string()
        .optional()
        .describe(
          'Longer description of the task goal. No length limit; avoid padding \u2014 it costs shared context for other agents.'
        ),
      acceptance: z
        .array(z.string())
        .optional()
        .describe(
          'List of acceptance criteria (plain sentences). No length limit; avoid padding \u2014 it costs shared context for other agents.'
        ),
    }),
    outputSchema: OUTPUT_SCHEMAS['tasks.add'],
  },
  {
    name: 'tasks.edit',
    description:
      'Edit an existing task (title, description, acceptance criteria). Omitted fields keep their current values.',
    inputSchema: z.object({
      id: recover(z.number().describe('Task ID to edit'), recovery.num, 0),
      title: z.string().optional().describe('New title (optional)'),
      description: z.string().optional().describe('New description (optional, null to clear)'),
      acceptance: z
        .array(z.string())
        .optional()
        .describe('New acceptance criteria list (optional, null to keep existing)'),
    }),
    outputSchema: OUTPUT_SCHEMAS['tasks.edit'],
  },
  {
    name: 'tasks.archive',
    description:
      'Archive a task. Archived tasks are hidden from default views (CLI and dashboard).',
    inputSchema: z.object({
      id: recover(z.number().describe('Task ID to archive'), recovery.num, 0),
    }),
    outputSchema: OUTPUT_SCHEMAS['tasks.archive'],
  },
  {
    name: 'tasks.unarchive',
    description: 'Unarchive a previously archived task, restoring it to default views.',
    inputSchema: z.object({
      id: recover(z.number().describe('Task ID to unarchive'), recovery.num, 0),
    }),
    outputSchema: OUTPUT_SCHEMAS['tasks.unarchive'],
  },
  {
    name: 'permissions.check',
    description:
      'Check that a .claude/agents/*.md definition file exists for every role. Returns { in_sync, agents } where each agent is { ok } or { ok: false, reason: "missing_file" }. Agent file CONTENTS are never inspected \u2014 they are meant to be customised freely \u2014 so this never reports drift, only absence. Run `ahk build` to restore a missing file.',
    inputSchema: z.object({}),
    outputSchema: OUTPUT_SCHEMAS['permissions.check'],
  },
  {
    name: 'deps.snapshot',
    description: 'Snapshot current package.json dependencies to .harness/deps-lock.json',
    inputSchema: z.object({}),
    outputSchema: OUTPUT_SCHEMAS['deps.snapshot'],
  },
  {
    name: 'deps.check',
    description: 'Compare current package.json against .harness/deps-lock.json and report changes',
    inputSchema: z.object({}),
    outputSchema: OUTPUT_SCHEMAS['deps.check'],
  },
  {
    name: 'ahk.doctor',
    description:
      'Check lib version, agent files, and harness skills sync status. Returns structured JSON.',
    inputSchema: z.object({}),
    outputSchema: OUTPUT_SCHEMAS['ahk.doctor'],
  },
] as const
