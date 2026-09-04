import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Server } from '@modelcontextprotocol/sdk/server'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

import { type HarnessDB, openDB } from './db'
import { getDoctorStatus } from './doctor'
import { slugify } from './materializer/scaffold-utils'
import { checkPermissionsSync } from './permissions-check'
import {
  type Relationship,
  RELATIONSHIPS,
  SPEC_KINDS,
  type SpecKind,
  type SpecMetadata,
  SpecStore,
} from './specs'

import type { ActionFileRow, ActionStatus, AgentName, HarnessConfig, TaskStatus } from '@/types'

const VERSION = '0.1.0'

// ─── Tool schemas ─────────────────────────────────────────────────────────────

const SPEC_TOOLS = [
  { name: 'specs.list', description: 'List specification headers from docs/specs without loading bodies.', inputSchema: { type: 'object', properties: { specKind: { type: 'string', enum: SPEC_KINDS }, status: { type: 'string' }, query: { type: 'string' }, offset: { type: 'number' }, limit: { type: 'number' } } } },
  { name: 'specs.get', description: 'Read one specification body by slug with an explicit offset and limit.', inputSchema: { type: 'object', properties: { slug: { type: 'string' }, offset: { type: 'number' }, limit: { type: 'number' } }, required: ['slug'] } },
  { name: 'specs.related', description: 'List related specification headers and edges without their bodies.', inputSchema: { type: 'object', properties: { slug: { type: 'string' }, relationships: { type: 'array', items: { type: 'string', enum: RELATIONSHIPS } } }, required: ['slug'] } },
  { name: 'specs.create', description: 'Create a validated specification in docs/specs from structured fields.', inputSchema: { type: 'object', properties: { slug: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' }, specKind: { type: 'string', enum: SPEC_KINDS }, status: { type: 'string' }, sourceSpec: { type: 'string' }, content: { type: 'string' } }, required: ['slug', 'title', 'description', 'specKind', 'content'] } },
  { name: 'specs.update_metadata', description: 'Update validated metadata fields without hand-editing frontmatter.', inputSchema: { type: 'object', properties: { slug: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' }, status: { type: 'string' }, sourceSpec: { type: 'string' } }, required: ['slug'] } },
  { name: 'specs.update_content', description: 'Replace a specification body while preserving its validated frontmatter.', inputSchema: { type: 'object', properties: { slug: { type: 'string' }, content: { type: 'string' } }, required: ['slug', 'content'] } },
  { name: 'specs.transition', description: 'Change a specification status while enforcing source approval rules.', inputSchema: { type: 'object', properties: { slug: { type: 'string' }, status: { type: 'string' } }, required: ['slug', 'status'] } },
  { name: 'specs.link', description: 'Create a bidirectional validated relationship between two specifications.', inputSchema: { type: 'object', properties: { slug: { type: 'string' }, targetSlug: { type: 'string' }, relationship: { type: 'string', enum: RELATIONSHIPS } }, required: ['slug', 'targetSlug', 'relationship'] } },
  { name: 'specs.unlink', description: 'Remove a relationship and its inverse from two specifications.', inputSchema: { type: 'object', properties: { slug: { type: 'string' }, targetSlug: { type: 'string' }, relationship: { type: 'string', enum: RELATIONSHIPS } }, required: ['slug', 'targetSlug', 'relationship'] } },
  { name: 'specs.validate', description: 'Validate all docs/specs frontmatter, links, and source references.', inputSchema: { type: 'object', properties: {} } },
] as const

const TOOLS = [
  ...SPEC_TOOLS,
  {
    name: 'actions.start',
    description: 'Start a new action for a task. Returns an actionId.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'number', description: 'The task ID from tasks.get' },
        agent: {
          type: 'string',
          description:
            'Agent name: lead | explorer | consultant | builder | reviewer | custom:<name>',
        },
      },
      required: ['taskId', 'agent'],
    },
  },
  {
    name: 'actions.write',
    description:
      'Record a section in an action. Standard sections: result, tools_used, blockers, next_steps.',
    inputSchema: {
      type: 'object',
      properties: {
        actionId: { type: 'number', description: 'The actionId returned by actions.start' },
        sectionType: {
          type: 'string',
          description:
            'Section name: result | tools_used | blockers | next_steps | <custom>. Do NOT use files_modified to track files — it is stored as plain text only. Use actions.record_file instead.',
        },
        content: {
          type: 'string',
          description:
            'Content for this section. No length limit; avoid padding — it costs shared context for other agents.',
        },
      },
      required: ['actionId', 'sectionType', 'content'],
    },
  },
  {
    name: 'actions.complete',
    description: 'Close an action with a one-line summary.',
    inputSchema: {
      type: 'object',
      properties: {
        actionId: { type: 'number', description: 'The actionId of the action to close' },
        summary: { type: 'string', description: 'One-line summary of what was done' },
      },
      required: ['actionId', 'summary'],
    },
  },
  {
    name: 'actions.get',
    description:
      'Full task action history, including every action and section. Potentially large; use only for audit or diagnosis.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'number', description: 'Task ID' },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'actions.list',
    description:
      'Compact newest-first action index. Use to discover actions before reading a specific action or section.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'number', description: 'Task ID' },
        agent: { type: 'string', description: 'Optional agent filter' },
        status: {
          type: 'string',
          enum: ['in_progress', 'completed', 'blocked'],
          description: 'Optional action status filter',
        },
        cursor: { type: 'string', description: 'Opaque cursor returned as nextCursor' },
        limit: { type: 'number', description: 'Maximum items (1-100; default 20)' },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'actions.get_by_id',
    description:
      'Get one action and a compact index of its sections; section contents are not included.',
    inputSchema: {
      type: 'object',
      properties: { actionId: { type: 'number', description: 'Action ID' } },
      required: ['actionId'],
    },
  },
  {
    name: 'actions.sections.list',
    description:
      'Compact newest-first section index for one action. Filter by section types without loading content.',
    inputSchema: {
      type: 'object',
      properties: {
        actionId: { type: 'number', description: 'Action ID' },
        types: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional section-type filter',
        },
        cursor: { type: 'string', description: 'Opaque cursor returned as nextCursor' },
        limit: { type: 'number', description: 'Maximum items (1-100; default 20)' },
      },
      required: ['actionId'],
    },
  },
  {
    name: 'actions.sections.get',
    description:
      'Read one section content with an explicit character range. This is the only generic action reader that returns long text.',
    inputSchema: {
      type: 'object',
      properties: {
        sectionId: { type: 'number', description: 'Section ID' },
        offset: { type: 'number', description: 'Zero-based character offset (default 0)' },
        length: { type: 'number', description: 'Characters to return (1-12000; default 8000)' },
      },
      required: ['sectionId'],
    },
  },
  {
    name: 'actions.handoff.write',
    description:
      'Write a validated, recipient-directed, bounded handoff for a completed action to resume work without loading the full history.',
    inputSchema: {
      type: 'object',
      properties: {
        actionId: { type: 'number', description: 'Producer action ID' },
        recipient: {
          type: 'string',
          enum: ['lead', 'explorer', 'consultant', 'builder', 'reviewer'],
        },
        goal: { type: 'string' },
        completed: { type: 'array', items: { type: 'string' } },
        decisions: { type: 'array', items: { type: 'string' } },
        files: { type: 'array', items: { type: 'string' } },
        verification: { type: 'array', items: { type: 'string' } },
        blockers: { type: 'array', items: { type: 'string' } },
        nextStep: { type: 'string' },
      },
      required: [
        'actionId',
        'recipient',
        'goal',
        'completed',
        'decisions',
        'files',
        'verification',
        'blockers',
        'nextStep',
      ],
    },
  },
  {
    name: 'actions.handoff.get',
    description:
      'Get the newest completed canonical handoff addressed to a recipient. Returns HANDOFF_NOT_FOUND instead of falling back to history.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'number', description: 'Task ID' },
        recipient: {
          type: 'string',
          enum: ['lead', 'explorer', 'consultant', 'builder', 'reviewer'],
          description: 'Recipient role; defaults to builder',
        },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'tasks.get',
    description: 'List tasks, optionally filtered by status. Excludes archived tasks by default.',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['pending', 'in_progress', 'done', 'blocked'],
          description: 'Filter by status (omit for all tasks)',
        },
        includeArchived: {
          type: 'boolean',
          description: 'If true, include archived tasks in results',
        },
      },
    },
  },
  {
    name: 'tasks.claim',
    description:
      'Atomically claim a pending task. Returns task_already_claimed if another agent got it first.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Task ID to claim' },
        agent: { type: 'string', description: 'Your agent name' },
      },
      required: ['id', 'agent'],
    },
  },
  {
    name: 'tasks.update',
    description: 'Change the status of a task.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Task ID' },
        status: {
          type: 'string',
          enum: ['pending', 'in_progress', 'done', 'blocked'],
        },
      },
      required: ['id', 'status'],
    },
  },
  {
    name: 'docs.search',
    description: 'Search the project docs folder for content matching a query.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search terms' },
      },
      required: ['query'],
    },
  },
  {
    name: 'actions.record_file',
    description:
      'Record one or more files touched during an action, atomically (all-or-nothing). This is the only way to populate the files-touched count shown in the dashboard. Batch every file from a step of work into a single call — a single-element array is correct when only one file was touched.',
    inputSchema: {
      type: 'object',
      properties: {
        actionId: { type: 'number', description: 'The actionId returned by actions.start' },
        files: {
          type: 'array',
          minItems: 1,
          description: 'Files touched, recorded atomically in one transaction.',
          items: {
            type: 'object',
            properties: {
              filePath: {
                type: 'string',
                description: 'Absolute or repo-relative path of the file',
              },
              operation: {
                type: 'string',
                enum: ['read', 'created', 'modified', 'deleted'],
                description: 'What was done to the file',
              },
              notes: { type: 'string', description: 'Optional short note about the change' },
            },
            required: ['filePath', 'operation'],
          },
        },
      },
      required: ['actionId', 'files'],
    },
  },
  {
    name: 'tasks.acceptance.update',
    description: 'Mark an acceptance criterion as met. Use the criterion id from tasks.get.',
    inputSchema: {
      type: 'object',
      properties: {
        criterionId: {
          type: 'number',
          description: 'The id of the acceptance criterion to mark as met',
        },
      },
      required: ['criterionId'],
    },
  },
  {
    name: 'tasks.acceptance.get',
    description:
      'Given a taskId, returns all acceptance criteria for that task with their id, task_id, criterion text, and met status. Use the returned id values to call tasks.acceptance_update(criterionId).',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'number', description: 'Task ID' },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'tasks.add',
    description:
      'Create a new task in the harness. Use this when the user describes work in natural language. Infer slug, title, description, and acceptance criteria from the conversation. Ask for missing critical info before calling.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short human-readable title for the task' },
        slug: {
          type: 'string',
          description:
            'URL-safe identifier (lowercase, hyphens). Auto-derived from title if omitted.',
        },
        description: {
          type: 'string',
          description:
            'Longer description of the task goal. No length limit; avoid padding — it costs shared context for other agents.',
        },
        acceptance: {
          type: 'array',
          items: { type: 'string' },
          description:
            'List of acceptance criteria (plain sentences). No length limit; avoid padding — it costs shared context for other agents.',
        },
      },
      required: ['title'],
    },
  },
  {
    name: 'actions.record_tool',
    description:
      'Record one or more tool calls made during an action, atomically (all-or-nothing). This is the only way to populate the Tools dashboard. Batch every tool call from a step of work into a single call — a single-element array is correct when only one call was made.',
    inputSchema: {
      type: 'object',
      properties: {
        actionId: { type: 'number', description: 'The actionId returned by actions.start' },
        calls: {
          type: 'array',
          minItems: 1,
          description: 'Tool calls made, recorded atomically in one transaction.',
          items: {
            type: 'object',
            properties: {
              toolName: {
                type: 'string',
                description: 'Name of the tool that was called (e.g. Read, Bash, Edit)',
              },
              argsJson: {
                type: 'string',
                description: 'Optional JSON string of the arguments passed to the tool',
              },
              resultSummary: {
                type: 'string',
                description: 'Optional short summary of the tool result',
              },
            },
            required: ['toolName'],
          },
        },
      },
      required: ['actionId', 'calls'],
    },
  },
  {
    name: 'tasks.edit',
    description:
      'Edit an existing task (title, description, acceptance criteria). Omitted fields keep their current values.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Task ID to edit' },
        title: { type: 'string', description: 'New title (optional)' },
        description: { type: 'string', description: 'New description (optional, null to clear)' },
        acceptance: {
          type: 'array',
          items: { type: 'string' },
          description: 'New acceptance criteria list (optional, null to keep existing)',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'tasks.archive',
    description:
      'Archive a task. Archived tasks are hidden from default views (CLI and dashboard).',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Task ID to archive' },
      },
      required: ['id'],
    },
  },
  {
    name: 'tasks.unarchive',
    description: 'Unarchive a previously archived task, restoring it to default views.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Task ID to unarchive' },
      },
      required: ['id'],
    },
  },
  {
    name: 'permissions.check',
    description:
      'Check that a .claude/agents/*.md definition file exists for every role. Returns { in_sync, agents } where each agent is { ok } or { ok: false, reason: "missing_file" }. Agent file CONTENTS are never inspected — they are meant to be customised freely — so this never reports drift, only absence. Run `ahk build` to restore a missing file.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'deps.snapshot',
    description: 'Snapshot current package.json dependencies to .harness/deps-lock.json',
    inputSchema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'deps.check',
    description: 'Compare current package.json against .harness/deps-lock.json and report changes',
    inputSchema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'ahk.doctor',
    description:
      'Check lib version, agent files, and harness skills sync status. Returns structured JSON.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
] as const

// ─── Server ───────────────────────────────────────────────────────────────────

export async function startMcpServer(config: HarnessConfig, cwd: string): Promise<void> {
  const db = await openDB(config, cwd)
  const docsPath = resolve(cwd, config.project.docsPath)

  const server = new Server(
    { name: 'agent-harness-kit', version: VERSION },
    { capabilities: { tools: {} } }
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params
    const a = (args ?? {}) as Record<string, unknown>

    try {
      const result = await dispatch(name, a, db, docsPath, cwd, config)
      return result
    } catch (err) {
      return ok(`Error: ${err instanceof Error ? err.message : String(err)}`, true)
    }
  })

  const transport = new StdioServerTransport()
  await server.connect(transport)
}

// ─── Dispatch ─────────────────────────────────────────────────────────────────

export async function dispatch(
  name: string,
  args: Record<string, unknown>,
  db: HarnessDB,
  docsPath: string,
  cwd: string,
  config: HarnessConfig
): Promise<CallToolResult> {
  const specs = new SpecStore(docsPath)
  switch (name) {
    case 'specs.list': {
      const specKind = optionalStr(args, 'specKind')
      if (specKind && !SPEC_KINDS.includes(specKind as SpecKind)) throw new Error(`invalid specKind '${specKind}'`)
      const query = optionalStr(args, 'query')?.toLowerCase()
      const offset = boundedInt(args, 'offset', 0, 0, Number.MAX_SAFE_INTEGER)
      const limit = boundedInt(args, 'limit', 50, 1, 100)
      const matches = specs.list().filter(({ metadata }) =>
        (!specKind || metadata.specKind === specKind) &&
        (!optionalStr(args, 'status') || metadata.status === optionalStr(args, 'status')) &&
        (!query || `${metadata.slug} ${metadata.title} ${metadata.description}`.toLowerCase().includes(query))
      )
      return ok(JSON.stringify({ items: matches.slice(offset, offset + limit).map((doc) => doc.metadata), nextOffset: offset + limit < matches.length ? offset + limit : null }))
    }
    case 'specs.get': {
      const document = specs.get(str(args, 'slug'))
      const offset = boundedInt(args, 'offset', 0, 0, Number.MAX_SAFE_INTEGER)
      const limit = boundedInt(args, 'limit', 8000, 1, 12000)
      const content = document.content.slice(offset, offset + limit)
      const nextOffset = offset + content.length
      return ok(JSON.stringify({ metadata: document.metadata, content, truncated: nextOffset < document.content.length, nextOffset: nextOffset < document.content.length ? nextOffset : null }))
    }
    case 'specs.related': {
      const slug = str(args, 'slug')
      specs.get(slug)
      const relationships = optionalStringArray(args, 'relationships')
      if (relationships?.some((value) => !RELATIONSHIPS.includes(value as Relationship))) throw new Error('relationships contains an invalid relationship')
      const related = specs.list().flatMap(({ metadata }) => metadata.relatedSpecs
        .filter((relation) => relation.slug === slug || metadata.slug === slug)
        .filter((relation) => !relationships || relationships.includes(relation.relationship))
        .map((relation) => ({ metadata: metadata.slug === slug ? specs.get(relation.slug).metadata : metadata, relationship: relation.relationship, direction: metadata.slug === slug ? 'outgoing' : 'incoming' })))
      return ok(JSON.stringify({ slug, items: related }))
    }
    case 'specs.create': {
      const kind = str(args, 'specKind') as SpecKind
      if (!SPEC_KINDS.includes(kind)) throw new Error(`invalid specKind '${kind}'`)
      const document = specs.create({
        slug: str(args, 'slug'), title: str(args, 'title'), description: str(args, 'description'),
        specKind: kind, status: (optionalStr(args, 'status') ?? 'draft') as SpecMetadata['status'],
        sourceSpec: optionalStr(args, 'sourceSpec'), relatedSpecs: [], content: str(args, 'content'),
      })
      return ok(JSON.stringify({ metadata: document.metadata }))
    }
    case 'specs.update_metadata': {
      const changes: Partial<Omit<SpecMetadata, 'slug' | 'createdAt'>> = {}
      if ('title' in args) changes.title = str(args, 'title')
      if ('description' in args) changes.description = str(args, 'description')
      if ('status' in args) changes.status = str(args, 'status') as SpecMetadata['status']
      if ('sourceSpec' in args) changes.sourceSpec = str(args, 'sourceSpec')
      const document = specs.updateMetadata(str(args, 'slug'), changes)
      return ok(JSON.stringify({ metadata: document.metadata }))
    }
    case 'specs.update_content': {
      const document = specs.updateContent(str(args, 'slug'), str(args, 'content'))
      return ok(JSON.stringify({ metadata: document.metadata }))
    }
    case 'specs.transition': {
      const document = specs.transition(str(args, 'slug'), str(args, 'status') as SpecMetadata['status'])
      return ok(JSON.stringify({ metadata: document.metadata }))
    }
    case 'specs.link':
      specs.link(str(args, 'slug'), str(args, 'targetSlug'), str(args, 'relationship') as Relationship)
      return ok(JSON.stringify({ linked: true }))
    case 'specs.unlink':
      specs.unlink(str(args, 'slug'), str(args, 'targetSlug'), str(args, 'relationship') as Relationship)
      return ok(JSON.stringify({ unlinked: true }))
    case 'specs.validate':
      return ok(JSON.stringify({ valid: specs.validate().length === 0, errors: specs.validate() }))
    case 'actions.start': {
      const taskId = num(args, 'taskId')
      const agent = str(args, 'agent') as AgentName
      const action = await db.startAction(taskId, agent)
      return ok(JSON.stringify({ actionId: action.id }))
    }

    case 'actions.write': {
      const actionId = num(args, 'actionId')
      const sectionType = str(args, 'sectionType')
      if (sectionType === 'handoff')
        throw new Error('handoff sections must be written with actions.handoff.write')
      const content = str(args, 'content')
      await db.writeSection(actionId, sectionType, content)
      return ok(JSON.stringify({ recorded: true }))
    }

    case 'actions.complete': {
      const actionId = num(args, 'actionId')
      const summary = str(args, 'summary')
      const action = await db.completeAction(actionId, summary)
      return ok(JSON.stringify({ status: action.status, completedAt: action.completed_at }))
    }

    case 'actions.get': {
      const taskId = num(args, 'taskId')
      const actions = await db.getActionsForTask(taskId)
      const full = await Promise.all(
        actions.map(async (a) => {
          const sections = await db.getActionSections(a.id)
          return {
            id: a.id,
            agent: a.agent,
            status: a.status,
            created_at: a.created_at,
            completed_at: a.completed_at,
            summary: a.summary,
            sections: sections.map((s) => ({
              id: s.id,
              section_type: s.section_type,
              content: s.content,
              created_at: s.created_at,
            })),
          }
        })
      )
      return ok(JSON.stringify(full))
    }

    case 'actions.list': {
      const taskId = num(args, 'taskId')
      const limit = boundedInt(args, 'limit', 20, 1, 100)
      const rows = await db.listActionsForTask(taskId, {
        agent: optionalAgent(args, 'agent'),
        status: optionalActionStatus(args, 'status'),
        cursor: decodeActionCursor(optionalStr(args, 'cursor')),
        limit,
      })
      const last = rows.at(-1)
      return ok(
        JSON.stringify({
          items: rows.map((row) => ({
            id: row.id,
            agent: row.agent,
            status: row.status,
            createdAt: row.created_at,
            completedAt: row.completed_at,
            summaryPreview: preview(row.summary),
            sectionCount: Number(row.section_count),
          })),
          nextCursor:
            rows.length === limit && last ? encodeActionCursor(last.created_at, last.id) : null,
        })
      )
    }

    case 'actions.get_by_id': {
      const actionId = num(args, 'actionId')
      const action = await db.getAction(actionId)
      if (!action) return ok(JSON.stringify({ error: 'ACTION_NOT_FOUND', actionId }), true)
      const sections = await db.listActionSections(actionId, { limit: 100 })
      return ok(
        JSON.stringify({
          id: action.id,
          taskId: action.task_id,
          agent: action.agent,
          status: action.status,
          summary: action.summary,
          createdAt: action.created_at,
          completedAt: action.completed_at,
          sections: sections.map(sectionIndex),
        })
      )
    }

    case 'actions.sections.list': {
      const actionId = num(args, 'actionId')
      const limit = boundedInt(args, 'limit', 20, 1, 100)
      const rows = await db.listActionSections(actionId, {
        types: optionalStringArray(args, 'types'),
        cursor: decodeSectionCursor(optionalStr(args, 'cursor')),
        limit,
      })
      const last = rows.at(-1)
      return ok(
        JSON.stringify({
          items: rows.map(sectionIndex),
          nextCursor: rows.length === limit && last ? encodeSectionCursor(last.id) : null,
        })
      )
    }

    case 'actions.sections.get': {
      const sectionId = num(args, 'sectionId')
      const offset = boundedInt(args, 'offset', 0, 0, Number.MAX_SAFE_INTEGER)
      const length = boundedInt(args, 'length', 8000, 1, 12000)
      const section = await db.getActionSection(sectionId)
      if (!section) return ok(JSON.stringify({ error: 'SECTION_NOT_FOUND', sectionId }), true)
      const content = section.content.slice(offset, offset + length)
      const nextOffset = offset + content.length
      return ok(
        JSON.stringify({
          sectionId: section.id,
          type: section.section_type,
          content,
          truncated: nextOffset < section.content.length,
          nextOffset: nextOffset < section.content.length ? nextOffset : null,
        })
      )
    }

    case 'actions.handoff.write': {
      const actionId = num(args, 'actionId')
      const recipient = recipientRole(args['recipient'])
      const handoff = handoffFromArgs(args)
      const serialized = JSON.stringify({ version: 1, recipient, handoff })
      if (Buffer.byteLength(serialized, 'utf8') > 12_000)
        throw new Error('handoff must not exceed 12000 UTF-8 bytes')
      await db.writeSection(actionId, 'handoff', serialized)
      return ok(JSON.stringify({ recorded: true, recipient }))
    }

    case 'actions.handoff.get': {
      const taskId = num(args, 'taskId')
      const recipient = recipientRole(args['recipient'] ?? 'builder')
      for (const candidate of await db.getCompletedHandoffSections(taskId)) {
        const decoded = decodeHandoff(candidate.content)
        if (decoded?.recipient !== recipient) continue
        return ok(
          JSON.stringify({
            found: true,
            taskId,
            sourceActionId: candidate.action_id,
            sourceAgent: candidate.agent,
            recipient,
            createdAt: candidate.created_at,
            handoff: decoded.handoff,
          })
        )
      }
      return ok(JSON.stringify({ found: false, reason: 'HANDOFF_NOT_FOUND' }))
    }

    case 'tasks.get': {
      const status = args['status'] as string | undefined
      const includeArchived = args['includeArchived'] as boolean | undefined
      const tasks = status
        ? await db.getTasks(status as TaskStatus, includeArchived ?? false)
        : await db.getTasks(undefined, includeArchived ?? false)
      return ok(JSON.stringify(tasks))
    }

    case 'tasks.claim': {
      const id = num(args, 'id')
      const agent = str(args, 'agent')
      const task = await db.claimTask(id, agent)
      if (!task) {
        return ok(JSON.stringify({ error: 'task_already_claimed', taskId: id }))
      }
      return ok(JSON.stringify(task))
    }

    case 'tasks.add': {
      const title = str(args, 'title')
      const slug = (args['slug'] as string | undefined) ?? slugify(title)
      const description = args['description'] as string | undefined
      const acceptance = args['acceptance'] as string[] | undefined
      const task = await db.addTask({ slug, title, description, acceptance })
      return ok(JSON.stringify(task))
    }

    case 'tasks.update': {
      const id = num(args, 'id')
      const status = str(args, 'status') as TaskStatus
      if (status === 'done') {
        await db.closeOrphanedActions(id)
      }
      const task = await db.updateTaskStatus(id, status)
      return ok(JSON.stringify(task))
    }

    case 'docs.search': {
      const query = str(args, 'query')
      const results = searchDocs(docsPath, query)
      return ok(JSON.stringify(results))
    }

    case 'actions.record_file': {
      const actionId = num(args, 'actionId')
      const files = nonEmptyArray(args, 'files').map((f) => ({
        filePath: str(f, 'filePath'),
        operation: str(f, 'operation') as ActionFileRow['operation'],
        notes: f['notes'] as string | undefined,
      }))
      const recorded = await db.recordFiles(actionId, files)
      return ok(JSON.stringify({ recorded }))
    }

    case 'tasks.acceptance.update': {
      const criterionId = num(args, 'criterionId')
      await db.markAcceptanceMet(criterionId)
      return ok(JSON.stringify({ criterionId, met: true }))
    }

    case 'tasks.acceptance.get': {
      const taskId = num(args, 'taskId')
      const criteria = await db.getTaskAcceptance(taskId)
      return ok(JSON.stringify(criteria))
    }

    case 'actions.record_tool': {
      const actionId = num(args, 'actionId')
      const calls = nonEmptyArray(args, 'calls').map((c) => ({
        toolName: str(c, 'toolName'),
        argsJson: c['argsJson'] as string | undefined,
        resultSummary: c['resultSummary'] as string | undefined,
      }))
      const recorded = await db.recordTools(actionId, calls)
      return ok(JSON.stringify({ recorded }))
    }

    case 'tasks.edit': {
      const id = num(args, 'id')
      const title = args['title'] as string | undefined
      const description = args['description'] as string | null | undefined
      const acceptance = args['acceptance'] as string[] | null | undefined

      const task = await db.getTaskById(id)
      if (!task) return ok(JSON.stringify({ error: 'Task not found', taskId: id }), true)

      await db.updateTask(id, {
        title,
        description: description !== undefined ? description : undefined,
      })
      if (acceptance !== undefined && acceptance !== null) {
        await db.updateTaskAcceptance(id, acceptance)
      }
      const updated = await db.getTaskById(id)
      return ok(JSON.stringify(updated))
    }

    case 'tasks.archive': {
      const id = num(args, 'id')
      const task = await db.archiveTask(id)
      return ok(JSON.stringify(task))
    }

    case 'tasks.unarchive': {
      const id = num(args, 'id')
      const task = await db.unarchiveTask(id)
      return ok(JSON.stringify(task))
    }

    case 'permissions.check': {
      const result = checkPermissionsSync(cwd, config)
      return ok(JSON.stringify(result))
    }

    case 'deps.snapshot': {
      const pkgPath = join(cwd, 'package.json')
      if (!existsSync(pkgPath)) {
        return ok('package.json not found in project root', true)
      }
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
        dependencies?: Record<string, string>
        devDependencies?: Record<string, string>
      }
      const snapshot = {
        capturedAt: new Date().toISOString(),
        dependencies: pkg.dependencies ?? {},
        devDependencies: pkg.devDependencies ?? {},
      }
      const harnessDir = join(cwd, '.harness')
      mkdirSync(harnessDir, { recursive: true })
      writeFileSync(join(harnessDir, 'deps-lock.json'), JSON.stringify(snapshot, null, 2), 'utf8')
      return ok(
        JSON.stringify({
          message: 'Snapshot saved to .harness/deps-lock.json',
          capturedAt: snapshot.capturedAt,
        })
      )
    }

    case 'deps.check': {
      const pkgPath = join(cwd, 'package.json')
      const lockPath = join(cwd, '.harness', 'deps-lock.json')
      if (!existsSync(pkgPath)) {
        return ok('package.json not found in project root', true)
      }
      if (!existsSync(lockPath)) {
        return ok(
          JSON.stringify({
            status: 'no-snapshot',
            message: 'No deps-lock.json found. Run deps.snapshot first to establish a baseline.',
          })
        )
      }
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
        dependencies?: Record<string, string>
        devDependencies?: Record<string, string>
      }
      const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as {
        capturedAt: string
        dependencies: Record<string, string>
        devDependencies: Record<string, string>
      }
      const current = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }
      const previous = { ...(lock.dependencies ?? {}), ...(lock.devDependencies ?? {}) }

      const added: string[] = []
      const removed: string[] = []
      const majorBumps: Array<{ name: string; from: string; to: string }> = []

      for (const [name, version] of Object.entries(current)) {
        if (!(name in previous)) {
          added.push(`${name}@${version}`)
        } else {
          const prevMajor = parseInt(
            previous[name].replace(/^[\^~>=v]/, '').split('.')[0] ?? '0',
            10
          )
          const curMajor = parseInt(version.replace(/^[\^~>=v]/, '').split('.')[0] ?? '0', 10)
          if (!isNaN(prevMajor) && !isNaN(curMajor) && curMajor > prevMajor) {
            majorBumps.push({ name, from: previous[name], to: version })
          }
        }
      }
      for (const depName of Object.keys(previous)) {
        if (!(depName in current)) {
          removed.push(depName)
        }
      }

      const significant = added.length > 0 || removed.length > 0 || majorBumps.length > 0
      const advisory = significant
        ? 'Significant dependency changes detected. Consider running `pnpx autoskills` (or `npx autoskills` if pnpm is unavailable) to refresh agent skills. Clearing stale skills before re-running is recommended.'
        : 'No significant dependency changes detected.'

      return ok(
        JSON.stringify({
          significant,
          added,
          removed,
          majorBumps,
          advisory,
          snapshotDate: lock.capturedAt,
        })
      )
    }

    case 'ahk.doctor': {
      const status = await getDoctorStatus(cwd)
      const result = {
        lib: {
          current: status.lib.current,
          latest: status.lib.latest,
          outdated: status.lib.outdated,
        },
        // Agents are existence-checked only — there is no `outdated` bucket.
        // Hand-edited agent definitions are supported and must not be flagged.
        agents: {
          missing: status.agents.filter((a) => a.status === 'missing').map((a) => a.name),
          ok: status.agents.filter((a) => a.status === 'ok').map((a) => a.name),
        },
        skills: {
          missing: status.skills.filter((s) => s.status === 'missing').map((s) => s.name),
          outdated: status.skills.filter((s) => s.status === 'outdated').map((s) => s.name),
          ok: status.skills.filter((s) => s.status === 'ok').map((s) => s.name),
        },
      }
      return ok(JSON.stringify(result))
    }

    default:
      return ok(`Unknown tool: ${name}`, true)
  }
}

// ─── docs.search implementation ───────────────────────────────────────────────

interface DocSnippet {
  file: string
  line: number
  text: string
}

function searchDocs(docsPath: string, query: string, maxResults = 10): DocSnippet[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  const results: DocSnippet[] = []

  try {
    const files = collectMarkdownFiles(docsPath)
    for (const file of files) {
      if (results.length >= maxResults) break
      try {
        const content = readFileSync(file, 'utf8')
        const lines = content.split('\n')
        for (let i = 0; i < lines.length; i++) {
          const lower = lines[i].toLowerCase()
          if (terms.every((t) => lower.includes(t))) {
            results.push({
              file: file.replace(docsPath + '/', ''),
              line: i + 1,
              text: lines[i].trim(),
            })
            if (results.length >= maxResults) break
          }
        }
      } catch {
        // skip unreadable files
      }
    }
  } catch {
    return [{ file: '', line: 0, text: `docs path not found: ${docsPath}` }]
  }

  return results
}

function collectMarkdownFiles(dir: string): string[] {
  const files: string[] = []
  try {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      const stat = statSync(full)
      if (stat.isDirectory()) {
        files.push(...collectMarkdownFiles(full))
      } else if (entry.endsWith('.md') || entry.endsWith('.txt')) {
        files.push(full)
      }
    }
  } catch {
    // directory may not exist yet
  }
  return files
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ok(text: string, isError = false): CallToolResult {
  return { content: [{ type: 'text' as const, text }], isError }
}

function str(args: Record<string, unknown>, key: string): string {
  const v = args[key]
  if (typeof v !== 'string') throw new Error(`${key} must be a string`)
  return v
}

function num(args: Record<string, unknown>, key: string): number {
  const v = Number(args[key])
  if (typeof v !== 'number' || Number.isNaN(v)) throw new Error(`${key} must be a number`)
  return v
}

function optionalStr(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new Error(`${key} must be a string`)
  return value
}
function boundedInt(
  args: Record<string, unknown>,
  key: string,
  fallback: number,
  min: number,
  max: number
): number {
  const value = args[key]
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max)
    throw new Error(`${key} must be an integer between ${min} and ${max}`)
  return value
}
function optionalStringArray(args: Record<string, unknown>, key: string): string[] | undefined {
  const value = args[key]
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.length === 0))
    throw new Error(`${key} must be an array of non-empty strings`)
  return value
}

const RECIPIENTS = ['lead', 'explorer', 'consultant', 'builder', 'reviewer'] as const
type HandoffRecipient = (typeof RECIPIENTS)[number]
interface Handoff {
  goal: string
  completed: string[]
  decisions: string[]
  files: string[]
  verification: string[]
  blockers: string[]
  nextStep: string
}
function recipientRole(value: unknown): HandoffRecipient {
  if (typeof value !== 'string' || !RECIPIENTS.includes(value as HandoffRecipient))
    throw new Error(`recipient must be one of: ${RECIPIENTS.join(', ')}`)
  return value as HandoffRecipient
}
function requiredStringArray(args: Record<string, unknown>, key: string): string[] {
  if (!(key in args)) throw new Error(`${key} is required`)
  return optionalStringArray(args, key) ?? []
}
function handoffFromArgs(args: Record<string, unknown>): Handoff {
  const goal = str(args, 'goal')
  const nextStep = str(args, 'nextStep')
  if (!goal.trim() || !nextStep.trim())
    throw new Error('goal and nextStep must be non-empty strings')
  return {
    goal,
    completed: requiredStringArray(args, 'completed'),
    decisions: requiredStringArray(args, 'decisions'),
    files: requiredStringArray(args, 'files'),
    verification: requiredStringArray(args, 'verification'),
    blockers: requiredStringArray(args, 'blockers'),
    nextStep,
  }
}
function decodeHandoff(content: string): { recipient: HandoffRecipient; handoff: Handoff } | null {
  try {
    const value = JSON.parse(content) as {
      version?: unknown
      recipient?: unknown
      handoff?: Record<string, unknown>
    }
    if (value.version !== 1 || !value.handoff) return null
    return { recipient: recipientRole(value.recipient), handoff: handoffFromArgs(value.handoff) }
  } catch {
    return null
  }
}
function optionalAgent(args: Record<string, unknown>, key: string): AgentName | undefined {
  const value = optionalStr(args, key)
  if (value === undefined) return undefined
  if (
    !['lead', 'explorer', 'consultant', 'builder', 'reviewer'].includes(value) &&
    !value.startsWith('custom:')
  )
    throw new Error('agent must be a known role or custom:<name>')
  return value as AgentName
}
function optionalActionStatus(
  args: Record<string, unknown>,
  key: string
): ActionStatus | undefined {
  const value = optionalStr(args, key)
  if (value === undefined) return undefined
  if (!['in_progress', 'completed', 'blocked'].includes(value))
    throw new Error('status must be in_progress, completed, or blocked')
  return value as ActionStatus
}
function encodeActionCursor(createdAt: string, id: number): string {
  return Buffer.from(JSON.stringify({ createdAt, id })).toString('base64url')
}
function decodeActionCursor(
  cursor: string | undefined
): { createdAt: string; id: number } | undefined {
  if (!cursor) return undefined
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      createdAt?: unknown
      id?: unknown
    }
    if (
      typeof value.createdAt !== 'string' ||
      typeof value.id !== 'number' ||
      !Number.isInteger(value.id)
    )
      throw new Error()
    return { createdAt: value.createdAt, id: value.id }
  } catch {
    throw new Error('cursor is invalid')
  }
}
function encodeSectionCursor(id: number): string {
  return Buffer.from(String(id)).toString('base64url')
}
function decodeSectionCursor(cursor: string | undefined): number | undefined {
  if (!cursor) return undefined
  const id = Number(Buffer.from(cursor, 'base64url').toString('utf8'))
  if (!Number.isInteger(id) || id < 1) throw new Error('cursor is invalid')
  return id
}
function preview(summary: string | null): string | null {
  return summary ? summary.slice(0, 240) : null
}
function sectionIndex(section: {
  id: number
  section_type: string
  chars: number
  created_at: string
}) {
  return {
    id: section.id,
    type: section.section_type,
    chars: Number(section.chars),
    createdAt: section.created_at,
  }
}

/** Validates that `args[key]` is a non-empty array of plain objects, as
 *  required by the batch-only shapes of actions.record_file/record_tool
 *  (task #74) — the single-entry top-level shape is no longer accepted, so
 *  every entry must be pulled from this array via str()/num() on each item. */
function nonEmptyArray(args: Record<string, unknown>, key: string): Record<string, unknown>[] {
  const v = args[key]
  if (!Array.isArray(v) || v.length === 0) {
    throw new Error(`${key} must be a non-empty array`)
  }
  for (const item of v) {
    if (typeof item !== 'object' || item === null) {
      throw new Error(`${key} entries must be objects`)
    }
  }
  return v as Record<string, unknown>[]
}
