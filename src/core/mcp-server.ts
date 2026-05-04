import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { HarnessConfig, AgentName } from '../types.js'
import { openDB, type HarnessDB } from './db.js'

const VERSION = '0.1.0'

// ─── Tool schemas ─────────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'actions.start',
    description: 'Start a new action for a task. Returns an actionId (UUID).',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'number', description: 'The task ID from tasks.get' },
        agent: {
          type: 'string',
          description: 'Agent name: lead | explorer | builder | reviewer | custom:<name>',
        },
      },
      required: ['taskId', 'agent'],
    },
  },
  {
    name: 'actions.write',
    description:
      'Record a section in an action. Standard sections: result, tools_used, files_modified, blockers, next_steps.',
    inputSchema: {
      type: 'object',
      properties: {
        actionId: { type: 'string', description: 'UUID returned by actions.start' },
        sectionType: {
          type: 'string',
          description: 'Section name: result | tools_used | files_modified | blockers | next_steps | <custom>',
        },
        content: { type: 'string', description: 'Content for this section' },
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
        actionId: { type: 'string', description: 'UUID of the action to close' },
        summary: { type: 'string', description: 'One-line summary of what was done' },
      },
      required: ['actionId', 'summary'],
    },
  },
  {
    name: 'actions.get',
    description: 'Get the full action history for a task (all agents, all sections).',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'number', description: 'Task ID' },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'tasks.get',
    description: 'List tasks, optionally filtered by status.',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['pending', 'in_progress', 'done', 'blocked'],
          description: 'Filter by status (omit for all tasks)',
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
] as const

// ─── Server ───────────────────────────────────────────────────────────────────

export async function startMcpServer(config: HarnessConfig, cwd: string): Promise<void> {
  const db = openDB(config, cwd)
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
      const result = await dispatch(name, a, db, docsPath)
      return result
    } catch (err) {
      return ok(`Error: ${err instanceof Error ? err.message : String(err)}`, true)
    }
  })

  const transport = new StdioServerTransport()
  await server.connect(transport)
}

// ─── Dispatch ─────────────────────────────────────────────────────────────────

async function dispatch(
  name: string,
  args: Record<string, unknown>,
  db: HarnessDB,
  docsPath: string
): Promise<CallToolResult> {
  switch (name) {
    case 'actions.start': {
      const taskId = num(args, 'taskId')
      const agent = str(args, 'agent') as AgentName
      const action = db.startAction(taskId, agent)
      return ok(JSON.stringify({ actionId: action.id, taskId, agent, status: 'in_progress' }))
    }

    case 'actions.write': {
      const actionId = str(args, 'actionId')
      const sectionType = str(args, 'sectionType')
      const content = str(args, 'content')
      db.writeSection(actionId, sectionType, content)
      return ok(JSON.stringify({ actionId, sectionType, recorded: true }))
    }

    case 'actions.complete': {
      const actionId = str(args, 'actionId')
      const summary = str(args, 'summary')
      const action = db.completeAction(actionId, summary)
      return ok(JSON.stringify({ actionId, status: action.status, completedAt: action.completed_at }))
    }

    case 'actions.get': {
      const taskId = num(args, 'taskId')
      const actions = db.getActionsForTask(taskId)
      const full = actions.map((a) => ({
        ...a,
        sections: db.getActionSections(a.id),
      }))
      return ok(JSON.stringify(full, null, 2))
    }

    case 'tasks.get': {
      const status = args['status'] as string | undefined
      const tasks = status
        ? db.getTasks(status as import('../types.js').TaskStatus)
        : db.getTasks()
      return ok(JSON.stringify(tasks, null, 2))
    }

    case 'tasks.claim': {
      const id = num(args, 'id')
      const agent = str(args, 'agent')
      const task = db.claimTask(id, agent)
      if (!task) {
        return ok(JSON.stringify({ error: 'task_already_claimed', taskId: id }))
      }
      return ok(JSON.stringify(task))
    }

    case 'tasks.update': {
      const id = num(args, 'id')
      const status = str(args, 'status') as import('../types.js').TaskStatus
      const task = db.updateTaskStatus(id, status)
      return ok(JSON.stringify(task))
    }

    case 'docs.search': {
      const query = str(args, 'query')
      const results = searchDocs(docsPath, query)
      return ok(JSON.stringify(results, null, 2))
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
            results.push({ file: file.replace(docsPath + '/', ''), line: i + 1, text: lines[i].trim() })
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
  const v = args[key]
  if (typeof v !== 'number') throw new Error(`${key} must be a number`)
  return v
}
