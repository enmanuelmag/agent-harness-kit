import type { HarnessConfig } from '../../types.js'

// ─── health.sh — exits 1 until the dev implements it ─────────────────────────

export const HEALTH_SH = `#!/usr/bin/env bash
# health.sh — project health check for agent-harness-kit
#
# This script must exit 0 when the project is healthy.
# Agents will run this before starting work.
#
# TODO: implement your project's health checks below.
# Examples:
#   npm test
#   docker compose ps | grep -q "running"
#   psql -c "SELECT 1" > /dev/null 2>&1
#
# Until you implement it, this script intentionally exits 1
# so agents know the environment is not verified.

echo "health.sh not implemented yet."
echo "Edit this file with your project's health checks."
echo "It must exit 0 for agents to start working."
exit 1
`

// ─── AGENTS.md template ───────────────────────────────────────────────────────

export function agentsMd(config: HarnessConfig): string {
  const { name, description, docsPath } = config.project
  const port = config.tools.mcp.port

  return `# AGENTS.md — ${name}

> **Read this file first.** It is the navigation map for every AI agent working in this repository.

## Project

**${name}** — ${description}

## Health check (run before starting)

\`\`\`bash
bash health.sh
\`\`\`

If it exits non-zero, stop and report the issue. Do not proceed with tasks until health is green.

## Harness data (source of truth)

| File | Purpose |
|------|---------|
| \`.harness/harness.db\` | SQLite: all tasks, actions, file changes, tool calls |
| \`.harness/current.md\` | Markdown fallback — read this if MCP server is unavailable |
| \`.harness/feature_list.json\` | Human-editable task seed list |

## MCP tools (preferred)

The harness exposes tools via MCP server on port ${port}. Use these instead of reading files directly.

\`\`\`
actions.start      taskId agent          → start an action, returns actionId
actions.write      actionId section text → record a section (result, tools_used, ...)
actions.complete   actionId summary      → close the action
actions.get        taskId               → full action history for a task
tasks.get          [status]             → list tasks (pending | in_progress | done | blocked)
tasks.claim        id                   → atomically claim a pending task
tasks.update       id status            → change task status
docs.search        query                → search ${docsPath} for relevant content
\`\`\`

## Workflow

\`\`\`
1. INIT
   - Run health.sh → exit 1 means stop
   - tasks.get('in_progress') → resume if something is in progress
   - tasks.get('pending') → pick lowest id

2. WORK  (lead → explorer → builder → reviewer)
   - Each agent calls actions.start(taskId, agentName) → actionId
   - Records work with actions.write(actionId, section, content)
   - Closes with actions.complete(actionId, summary)

3. CLOSE
   - tasks.update(taskId, 'done')
   - Run health.sh → must be green before closing
\`\`\`

## Agent roles

| Agent | Responsibility |
|-------|---------------|
| lead | Decomposes the task into a plan, assigns sub-agents |
| explorer | Reads and maps relevant code, never writes |
| builder | Implements the plan, writes files |
| reviewer | Verifies acceptance criteria, approves or blocks |

## What to read

\`\`\`
Always:         .harness/current.md (or MCP tasks.get)
If implementing: ${docsPath}/
If orchestrating: Agent definition files in your provider's agents directory
\`\`\`
`
}

// ─── agent-harness-kit.config.ts template ───────────────────────────────────────────

export function configTs(params: {
  name: string
  description: string
  provider: string
  docsPath: string
  tasksAdapter: string
  port: number
}): string {
  return `import { defineHarness } from 'agent-harness-kit'

export default defineHarness({
  project: {
    name: '${params.name}',
    description: '${params.description}',
    docsPath: '${params.docsPath}',
  },

  provider: '${params.provider}',

  agents: {
    lead:     { instructionsPath: null },
    explorer: { instructionsPath: null, allowedPaths: ['${params.docsPath}', './src'] },
    builder:  { instructionsPath: null, writablePaths: ['./src', './tests'] },
    reviewer: { instructionsPath: null },
    custom:   [],
  },

  storage: {
    dir:    '.harness',
    dbPath: '.harness/harness.db',
    tasks:  { adapter: '${params.tasksAdapter}' },
    sections: {
      toolsUsed:     true,
      filesModified: true,
      result:        true,
      blockers:      true,
      nextSteps:     false,
    },
    markdownFallback: { enabled: true, path: '.harness/current.md' },
  },

  health: {
    scriptPath: './health.sh',
    required:   true,
  },

  tools: {
    mcp:     { enabled: true, port: ${params.port} },
    scripts: { enabled: true, outputDir: './.harness/scripts' },
  },
})
`
}

// ─── Agent definition templates ───────────────────────────────────────────────

export const AGENT_LEAD = `---
description: Lead agent — orchestrates the harness workflow for a single task
---

# Lead Agent

You are the **lead agent** in the agent-harness-kit harness. Your job is to decompose a task into a plan and coordinate the other agents.

## Your workflow

1. Read \`.harness/current.md\` (or call \`tasks.get('in_progress')\`) to orient yourself.
2. Call \`actions.start(taskId, 'lead')\` to register your action.
3. Decompose the task:
   - What needs to be explored first?
   - What needs to be built?
   - What are the acceptance criteria?
4. Call \`actions.write(actionId, 'result', plan)\` with your decomposition.
5. Call \`actions.complete(actionId, 'Plan defined')\`.
6. Delegate to explorer, then builder, then reviewer — in that order.

## Rules

- Do NOT write code yourself. Delegate to builder.
- Do NOT read source files yourself. Delegate to explorer.
- One task at a time. Check \`tasks.get('in_progress')\` before picking a new one.
- If the reviewer blocks, coordinate a fix with builder and re-review.
`

export const AGENT_EXPLORER = `---
description: Explorer agent — reads and maps the codebase, never writes files
---

# Explorer Agent

You are the **explorer agent** in the agent-harness-kit harness. Your job is to read and understand the relevant parts of the codebase for the current task. You never write or modify files.

## Your workflow

1. Call \`actions.start(taskId, 'explorer')\` to register your action.
2. Read only the files relevant to the current task. Use \`docs.search(query)\` first.
3. Record what you find:
   - \`actions.write(actionId, 'tools_used', list_of_tools)\`
   - \`actions.write(actionId, 'result', analysis)\`
4. Call \`actions.complete(actionId, 'Analysis done')\`.

## Rules

- Never modify files. You are read-only.
- Use progressive disclosure — read AGENTS.md, then navigate to specific files.
- Record every file you read via \`actions.write(actionId, 'tools_used', ...)\`.
`

export const AGENT_BUILDER = `---
description: Builder agent — implements the plan produced by explorer and lead
---

# Builder Agent

You are the **builder agent** in the agent-harness-kit harness. Your job is to implement the plan from lead, using the analysis from explorer.

## Your workflow

1. Read the lead's plan from \`actions.get(taskId)\`.
2. Call \`actions.start(taskId, 'builder')\` to register your action.
3. Implement the task. Record every file you touch:
   - \`actions.write(actionId, 'files_modified', list)\`
4. Record the result:
   - \`actions.write(actionId, 'result', summary_of_changes)\`
5. If you hit a blocker: \`actions.write(actionId, 'blockers', description)\`
6. Call \`actions.complete(actionId, 'Implementation done')\`.

## Rules

- Only write to the paths allowed by your config (writablePaths).
- If something is unclear, record a blocker and surface it to lead — don't guess.
- Run tests after implementing if the project has a test suite.
`

export const AGENT_REVIEWER = `---
description: Reviewer agent — verifies acceptance criteria before marking a task done
---

# Reviewer Agent

You are the **reviewer agent** in the agent-harness-kit harness. Your job is to verify that the builder's work meets all acceptance criteria before the task is marked done.

## Your workflow

1. Call \`actions.get(taskId)\` to read the full history (lead plan + explorer analysis + builder changes).
2. Call \`actions.start(taskId, 'reviewer')\` to register your action.
3. Verify each acceptance criterion:
   - \`actions.write(actionId, 'result', 'APPROVED' or 'BLOCKED: reason')\`
4. If approved:
   - \`actions.complete(actionId, 'Task approved')\`
   - \`tasks.update(taskId, 'done')\`
5. If blocked:
   - \`actions.write(actionId, 'blockers', what_is_missing)\`
   - \`actions.complete(actionId, 'Task blocked: reason')\`
   - Notify lead to re-assign to builder.

## Rules

- Never approve unless ALL acceptance criteria are met.
- Check that health.sh is green before approving.
- Be specific about what is missing when blocking.
`

// ─── feature_list.json initial seed ──────────────────────────────────────────

export function featureListJson(
  tasks: { slug: string; title: string; description?: string; acceptance?: string[] }[]
): string {
  return JSON.stringify(tasks, null, 2) + '\n'
}

// ─── MCP JSON merge helpers ───────────────────────────────────────────────────
// These do a deep merge so existing provider config is preserved.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export function mergeClaudeMcpJson(filePath: string, port: number): void {
  let existing: Record<string, unknown> = {}
  if (existsSync(filePath)) {
    try {
      existing = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>
    } catch {
      // Unreadable JSON — start fresh to avoid corrupt state
    }
  }

  const merged = {
    ...existing,
    mcpServers: {
      ...((existing.mcpServers as Record<string, unknown>) ?? {}),
      'agent-harness-kit': {
        command: 'npx',
        args: ['ahk', 'serve', '--port', String(port)],
        type: 'stdio',
      },
    },
  }

  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(merged, null, 2) + '\n', 'utf8')
}

export function mergeOpencodeJson(filePath: string, port: number): void {
  let existing: Record<string, unknown> = {}
  if (existsSync(filePath)) {
    try {
      existing = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>
    } catch {
      // start fresh
    }
  }

  const existingMcp = (existing.mcp as Record<string, unknown>) ?? {}
  const existingServers = (existingMcp.servers as Record<string, unknown>) ?? {}

  const merged = {
    ...existing,
    mcp: {
      ...existingMcp,
      servers: {
        ...existingServers,
        'agent-harness-kit': {
          command: 'npx',
          args: ['ahk', 'serve', '--port', String(port)],
          type: 'stdio',
        },
      },
    },
  }

  writeFileSync(filePath, JSON.stringify(merged, null, 2) + '\n', 'utf8')
}

// ─── .gitignore additions ─────────────────────────────────────────────────────

export const GITIGNORE_ENTRIES = `
# agent-harness-kit
.harness/harness.db
.harness/harness.db-shm
.harness/harness.db-wal
.harness/current.md
`
