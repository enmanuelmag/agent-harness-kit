import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { HarnessConfig } from '@/types'

// ─── Agent template loader ────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url))
const TEMPLATES_DIR = join(__dirname, 'agent-templates')

/**
 * Load an agent template file and interpolate {{variables}}.
 * Variables are replaced using a simple {{key}} pattern.
 */
function loadAgentTemplate(
  name: 'lead' | 'explorer' | 'builder' | 'reviewer',
  vars: Record<string, string> = {}
): string {
  const raw = readFileSync(join(TEMPLATES_DIR, `${name}.md`), 'utf8')
  return raw.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? `{{${key}}}`)
}

// ─── health.sh — exits 1 until the dev implements it ─────────────────────────

export const HEALTH_SH = `#!/usr/bin/env bash
# health.sh — project health check for agent-harness-kit
#
# This script must exit 0 when the project is healthy.
# Agents will run this before making codebase changes.
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

## Health check (run before making codebase changes)

\`\`\`bash
bash health.sh
\`\`\`

If it exits non-zero, stop and report the issue. Do not proceed with codebase changes until health is green.

## Harness data (source of truth)

| File | Purpose |
|------|---------|
| \`.harness/harness.db\` | SQLite: all tasks, actions, file changes, tool calls |
| \`.harness/current.md\` | Markdown fallback — read this if MCP server is unavailable |
| \`.harness/feature_list.json\` | Human-editable task seed list |

## MCP tools (preferred)

The harness exposes tools via MCP server on port ${port}. Use these instead of reading files directly.

\`\`\`
actions.start        taskId agent                           → start an action, returns actionId
actions.write        actionId section text                  → record a section (result, blockers, ...)
actions.record_tool  actionId toolName [argsJson] [summary] → log a tool call to the Tools dashboard
actions.record_file  actionId filePath operation [notes]   → log a file touch to the Files dashboard
actions.complete     actionId summary                       → close the action
actions.get          taskId                                 → full action history for a task
tasks.add            title [slug] [description] [acceptance] → create a new task from natural language
tasks.get            [status]                               → list tasks (pending | in_progress | done | blocked)
tasks.claim          id                                     → atomically claim a pending task
tasks.update         id status                              → change task status
tasks.acceptance.update criterionId                        → mark an acceptance criterion as met
docs.search          query                                  → search ${docsPath} for relevant content
\`\`\`

## Workflow

\`\`\`
1. INIT
   - Assess user intent: only run health.sh if changes are needed
   - tasks.get('in_progress') → resume if something is in progress
   - tasks.get('pending') → pick lowest id

2. WORK  (lead → explorer → builder → reviewer)
   - Each agent calls actions.start(taskId, agentName) → actionId
   - After EVERY tool call: actions.record_tool(actionId, toolName, args, summary)
   - After EVERY file change: actions.record_file(actionId, filePath, operation, notes)
   - Closes with actions.complete(actionId, summary)

3. CLOSE
   - tasks.update(taskId, 'done')
   - Run health.sh (if changes were made) → must be green before closing
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

// ─── CLAUDE.md template (Claude Code provider) ───────────────────────────────

export function claudeMd(config: HarnessConfig): string {
  const { name, description, docsPath } = config.project
  const port = config.tools.mcp.port

  return `# CLAUDE.md — ${name}

> **Read this file first.** It is the navigation map for every AI agent working in this repository.

## Project

**${name}** — ${description}

## Health check (run before making codebase changes)

\`\`\`bash
bash health.sh
\`\`\`

If it exits non-zero, stop and report the issue. Do not proceed with codebase changes until health is green.

## Harness data (source of truth)

| File | Purpose |
|------|---------|
| \`.harness/harness.db\` | SQLite: all tasks, actions, file changes, tool calls |
| \`.harness/current.md\` | Markdown fallback — read this if MCP server is unavailable |
| \`.harness/feature_list.json\` | Human-editable task seed list |

## MCP tools (preferred)

The harness exposes tools via MCP server on port ${port}. Use these instead of reading files directly.

\`\`\`
actions.start        taskId agent                           → start an action, returns actionId
actions.write        actionId section text                  → record a section (result, blockers, ...)
actions.record_tool  actionId toolName [argsJson] [summary] → log a tool call to the Tools dashboard
actions.record_file  actionId filePath operation [notes]   → log a file touch to the Files dashboard
actions.complete     actionId summary                       → close the action
actions.get          taskId                                 → full action history for a task
tasks.add            title [slug] [description] [acceptance] → create a new task from natural language
tasks.get            [status]                               → list tasks (pending | in_progress | done | blocked)
tasks.claim          id                                     → atomically claim a pending task
tasks.update         id status                              → change task status
tasks.acceptance.update criterionId                        → mark an acceptance criterion as met
docs.search          query                                  → search ${docsPath} for relevant content
\`\`\`

## Workflow

\`\`\`
1. INIT
   - Assess user intent: only run health.sh if changes are needed
   - tasks.get('in_progress') → resume if something is in progress
   - tasks.get('pending') → pick lowest id
   - No pending tasks? → ask user, infer fields, call tasks.add, then tasks.claim

2. WORK  (lead → explorer → builder → reviewer)
   - Each agent calls actions.start(taskId, agentName) → actionId
   - After EVERY tool call: actions.record_tool(actionId, toolName, args, summary)
   - After EVERY file change: actions.record_file(actionId, filePath, operation, notes)
   - Closes with actions.complete(actionId, summary)

3. CLOSE
   - tasks.update(taskId, 'done')
   - Run health.sh (if changes were made) → must be green before closing
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
If orchestrating: Agent definition files in .claude/agents/
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
  return `import { defineHarness } from '@cardor/agent-harness-kit'

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

  // SQLite (default). Switch to postgres/mysql by changing database.type.
  // database: { type: 'postgres', connectionString: process.env.DATABASE_URL },
  // database: { type: 'mysql',    connectionString: process.env.DATABASE_URL },
  database: { type: 'sqlite', path: '.harness/harness.db' },

  storage: {
    dir:    '.harness',
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

// ─── Agent definition templates (loaded from agent-templates/*.md) ─────────────

export function agentLead(vars: { projectName: string }): string {
  return loadAgentTemplate('lead', vars)
}

export function agentExplorer(vars: { projectName: string; allowedPaths: string }): string {
  return loadAgentTemplate('explorer', vars)
}

export function agentBuilder(vars: { projectName: string; writablePaths: string }): string {
  return loadAgentTemplate('builder', vars)
}

export function agentReviewer(vars: { projectName: string }): string {
  return loadAgentTemplate('reviewer', vars)
}

// ─── feature_list.json initial seed ──────────────────────────────────────────

export function featureListJson(
  tasks: { slug: string; title: string; description?: string; acceptance?: string[] }[]
): string {
  return JSON.stringify(tasks, null, 2) + '\n'
}

// ─── Codex CLI agent TOML helpers ────────────────────────────────────────────

function stripFrontmatter(md: string): { description: string; body: string } {
  const parts = md.split(/^---\s*$/m)
  if (parts.length < 3) return { description: '', body: md }

  const frontmatter = parts[1]
  const body = parts.slice(2).join('---').replace(/^\n/, '')

  let description = ''
  // YAML folded scalar: `description: >\n  line1\n  line2`
  const foldedMatch = frontmatter.match(/^description:\s*[>|]\s*\n((?:[ \t]+[^\n]*\n?)*)/m)
  if (foldedMatch) {
    description = foldedMatch[1]
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean)
      .join(' ')
  } else {
    const inlineMatch = frontmatter.match(/^description:\s*(.+)$/m)
    if (inlineMatch) description = inlineMatch[1].trim()
  }

  return { description, body }
}

function toCodexToml(
  name: string,
  description: string,
  body: string,
  sandboxMode: 'workspace-write' | 'read-only'
): string {
  // TOML multiline basic strings end at `"""` — escape any that appear in content
  const safe = (s: string) => s.replace(/"""/g, '""\\u0022')
  return `name = "${name}"
sandbox_mode = "${sandboxMode}"

description = """
${safe(description)}
"""

developer_instructions = """
${safe(body.trimEnd())}
"""
`
}

export function agentLeadToml(vars: { projectName: string }): string {
  const { description, body } = stripFrontmatter(loadAgentTemplate('lead', vars))
  return toCodexToml('lead', description, body, 'read-only')
}

export function agentLeadAsDefaultToml(vars: { projectName: string }): string {
  const { description, body } = stripFrontmatter(loadAgentTemplate('lead', vars))
  return toCodexToml('default', description, body, 'read-only')
}

export function agentExplorerToml(vars: { projectName: string; allowedPaths: string }): string {
  const { description, body } = stripFrontmatter(loadAgentTemplate('explorer', vars))
  return toCodexToml('explorer', description, body, 'read-only')
}

export function agentBuilderToml(vars: { projectName: string; writablePaths: string }): string {
  const { description, body } = stripFrontmatter(loadAgentTemplate('builder', vars))
  return toCodexToml('builder', description, body, 'workspace-write')
}

export function agentReviewerToml(vars: { projectName: string }): string {
  const { description, body } = stripFrontmatter(loadAgentTemplate('reviewer', vars))
  return toCodexToml('reviewer', description, body, 'read-only')
}

// ─── Claude Code frontmatter translation ─────────────────────────────────────

const CLAUDE_CODE_MCP_TOOLS: Record<string, string[]> = {
  lead: [
    'mcp__agent-harness-kit__actions.start',
    'mcp__agent-harness-kit__actions.write',
    'mcp__agent-harness-kit__actions.complete',
    'mcp__agent-harness-kit__actions.get',
    'mcp__agent-harness-kit__actions.record_tool',
    'mcp__agent-harness-kit__tasks.get',
    'mcp__agent-harness-kit__tasks.claim',
    'mcp__agent-harness-kit__tasks.update',
    'mcp__agent-harness-kit__tasks.add',
  ],
  explorer: [
    'mcp__agent-harness-kit__actions.start',
    'mcp__agent-harness-kit__actions.write',
    'mcp__agent-harness-kit__actions.complete',
    'mcp__agent-harness-kit__actions.get',
    'mcp__agent-harness-kit__actions.record_tool',
    'mcp__agent-harness-kit__docs.search',
  ],
  builder: [
    'mcp__agent-harness-kit__actions.start',
    'mcp__agent-harness-kit__actions.write',
    'mcp__agent-harness-kit__actions.complete',
    'mcp__agent-harness-kit__actions.get',
    'mcp__agent-harness-kit__actions.record_tool',
    'mcp__agent-harness-kit__actions.record_file',
  ],
  reviewer: [
    'mcp__agent-harness-kit__actions.start',
    'mcp__agent-harness-kit__actions.write',
    'mcp__agent-harness-kit__actions.complete',
    'mcp__agent-harness-kit__actions.get',
    'mcp__agent-harness-kit__actions.record_tool',
    'mcp__agent-harness-kit__tasks.acceptance.update',
    'mcp__agent-harness-kit__tasks.update',
  ],
}

/**
 * Takes a template markdown string (with simple tools list) and injects
 * `Task` + the agent-specific `mcp__agent-harness-kit__*` tools into the
 * frontmatter `tools:` section for Claude Code.
 *
 * Inserts `Task` after the last non-mcp tool entry, then appends mcp tools.
 */
export function translateFrontmatterForClaudeCode(
  md: string,
  agentName: 'lead' | 'explorer' | 'builder' | 'reviewer'
): string {
  const mcpTools = CLAUDE_CODE_MCP_TOOLS[agentName] ?? []
  const mcpLines = mcpTools.map(t => `  - ${t}`).join('\n')

  // Find the tools: block in frontmatter and append Task + mcp tools after last tool entry
  // We look for the pattern: a line with `  - SomeTool` followed by either `---` or a non-tool line
  return md.replace(
    /(tools:\n(?:  - (?!mcp__)[^\n]+\n)+)/,
    (match) => {
      const trimmed = match.trimEnd()
      return `${trimmed}\n  - Task\n${mcpLines}\n`
    }
  )
}

// ─── .gitignore additions ─────────────────────────────────────────────────────

export const GITIGNORE_ENTRIES = `
# agent-harness-kit
.harness/harness.db
.harness/harness.db-shm
.harness/harness.db-wal
.harness/current.md
`
