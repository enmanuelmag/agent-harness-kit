import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  MCP_CLAUDE_PERMISSIONS,
  MCP_CLAUDE_PERMISSIONS_BUILDER,
  MCP_CLAUDE_PERMISSIONS_CONSULTANT,
  MCP_CLAUDE_PERMISSIONS_EXPLORER,
  MCP_CLAUDE_PERMISSIONS_LEAD,
  MCP_CLAUDE_PERMISSIONS_REVIEWER,
} from './mcp-merge'

import type { HarnessConfig } from '@/types'

// ─── Agent template loader ────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url))
const TEMPLATES_DIR = join(__dirname, 'agent-templates')

/**
 * Load an agent template file and interpolate {{variables}}.
 * Variables are replaced using a simple {{key}} pattern.
 */
function loadAgentTemplate(
  name: 'lead' | 'explorer' | 'consultant' | 'builder' | 'reviewer',
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

2. WORK  (lead → explorer → consultant → builder → reviewer)
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
| consultant | Technical advisor, runs after explorer, before builder. Never writes code. |
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

2. WORK  (lead → explorer → consultant → builder → reviewer)
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
| consultant | Technical advisor, runs after explorer, before builder. Never writes code. |
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

export interface AgentModelOverrides {
  lead?: string
  explorer?: string
  consultant?: string
  builder?: string
  reviewer?: string
}

function modelField(model: string | undefined): string {
  return model ? `, model: ${JSON.stringify(model)}` : ''
}

interface ConfigTemplateParams {
  name: string
  description: string
  provider: string
  docsPath: string
  tasksAdapter: string
  port: number
  models?: AgentModelOverrides
  scope: 'local' | 'global'
  projectId: string
}

/**
 * Shared body of the config object literal, reused across the .ts/.mjs/.cjs
 * templates below. Returns the inner fields only (no wrapping braces) so
 * each variant can control its own import/export shape around it.
 */
function configObjectBody(params: ConfigTemplateParams): string {
  const models = params.models ?? {}
  const isGlobal = params.scope === 'global'

  // scope='global' — the sqlite file and current.md fallback both live under
  // ~/.harness/dbs/<projectId>/ (see resolveGlobalStorageDir in db.ts), so
  // there is no local path to declare for either. Emitting a `sqlitePath`
  // (local-only field) or `markdownFallback.path` for this scope would be
  // silently ignored at runtime — omit them entirely for this scope.
  const markdownFallbackLine = isGlobal
    ? `markdownFallback: { enabled: true },`
    : `markdownFallback: { enabled: true, path: '.harness/current.md' },`

  return `  project: {
    name: ${JSON.stringify(params.name)},
    description: ${JSON.stringify(params.description)},
    docsPath: '${params.docsPath}',
  },

  provider: '${params.provider}',

  agents: {
    lead:     { instructionsPath: null${modelField(models.lead)} },
    explorer: { instructionsPath: null, allowedPaths: ['${params.docsPath}', './src']${modelField(models.explorer)} },
    builder:  { instructionsPath: null, writablePaths: ['./src', './tests']${modelField(models.builder)} },
    reviewer: { instructionsPath: null${modelField(models.reviewer)} },
    ${models.consultant ? `consultant: { instructionsPath: null${modelField(models.consultant)} },\n    ` : ''}custom:   [],
  },

  // SQLite (default). Switch to postgres/mysql by changing database.type.
  // database: { type: 'postgres', connectionString: process.env.DATABASE_URL },
  // database: { type: 'mysql',    connectionString: process.env.DATABASE_URL },
  database: { type: 'sqlite' },

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
    ${markdownFallbackLine}
    // 'local' — DB lives in .harness/ (project-relative). 'global' — DB lives
    // under ~/.harness/dbs/<projectId>/, outside the project tree.
    scope:     '${params.scope}',
    projectId: '${params.projectId}',
  },

  health: {
    scriptPath: './health.sh',
    required:   true,
  },

  tools: {
    mcp:     { enabled: true, port: ${params.port} },
    scripts: { enabled: true, outputDir: './.harness/scripts' },
  },
`
}

/**
 * TypeScript config: uses `import type` (type-only, erased at compile time)
 * instead of a value import of `defineHarness`. This means `loadConfig()`
 * (via jiti) never needs to resolve `@cardor/agent-harness-kit` as a real
 * module at runtime just to load the config — only the type is referenced,
 * which TypeScript strips entirely. `defineHarness()` itself is unaffected
 * and remains available for anyone who prefers to import and call it
 * manually; `loadConfig()` supports both shapes (see config.ts).
 */
export function configTs(params: ConfigTemplateParams): string {
  return `import type { HarnessConfig } from '@cardor/agent-harness-kit'

const config: HarnessConfig = {
${configObjectBody(params)}}

export default config
`
}

/**
 * .mjs config: plain JavaScript has no compile-time type checking, so there
 * is no benefit to importing anything from the package here — not even a
 * type. The object is exported as-is via ESM `export default`.
 */
export function configMjs(params: ConfigTemplateParams): string {
  return `const config = {
${configObjectBody(params)}}

export default config
`
}

/**
 * .cjs config: same reasoning as configMjs — plain JS, no types to import.
 * Exported via CommonJS `module.exports`, which `loadConfig()` already
 * handles through its `mod.default ?? mod` fallback.
 */
export function configCjs(params: ConfigTemplateParams): string {
  return `const config = {
${configObjectBody(params)}}

module.exports = config
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

export function agentConsultant(vars: { projectName: string }): string {
  return loadAgentTemplate('consultant', vars)
}

export function agentReviewer(vars: { projectName: string }): string {
  return loadAgentTemplate('reviewer', vars)
}

// Note: agentLead/agentExplorer/agentConsultant/agentBuilder/agentReviewer above produce the
// raw markdown template (frontmatter without `model:`). The `model:` line is injected downstream
// by translateFrontmatterForClaudeCode() (Claude Code) — never injected for OpenCode.

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
      .map((l) => l.trim())
      .filter(Boolean)
      .join(' ')
  } else {
    const inlineMatch = frontmatter.match(/^description:\s*(.+)$/m)
    if (inlineMatch) description = inlineMatch[1].trim()
  }

  return { description, body }
}

/**
 * Codex CLI does not validate the `model` value client-side (free text, resolved
 * at invocation time). Per explicit product rule: if the value is null/undefined/
 * empty, or its trimmed length is < 3 chars, omit the `model` line entirely —
 * never emit a placeholder or an 'inherit'-like value.
 */
function toCodexToml(
  name: string,
  description: string,
  body: string,
  sandboxMode: 'workspace-write' | 'read-only',
  model?: string
): string {
  // TOML multiline basic strings end at `"""` — escape any that appear in content
  const safe = (s: string) => s.replace(/"""/g, '""\\u0022')
  const trimmedModel = model?.trim() ?? ''
  const modelLine = trimmedModel.length >= 3 ? `model = "${trimmedModel}"\n` : ''
  return `name = "${name}"
sandbox_mode = "${sandboxMode}"
${modelLine}
description = """
${safe(description)}
"""

developer_instructions = """
${safe(body.trimEnd())}
"""
`
}

export function agentLeadToml(vars: { projectName: string; model?: string }): string {
  const { description, body } = stripFrontmatter(loadAgentTemplate('lead', vars))
  return toCodexToml('lead', description, body, 'read-only', vars.model)
}

export function agentLeadAsDefaultToml(vars: { projectName: string; model?: string }): string {
  const { description, body } = stripFrontmatter(loadAgentTemplate('lead', vars))
  return toCodexToml('default', description, body, 'read-only', vars.model)
}

export function agentExplorerToml(vars: { projectName: string; allowedPaths: string; model?: string }): string {
  const { description, body } = stripFrontmatter(loadAgentTemplate('explorer', vars))
  return toCodexToml('explorer', description, body, 'read-only', vars.model)
}

export function agentBuilderToml(vars: { projectName: string; writablePaths: string; model?: string }): string {
  const { description, body } = stripFrontmatter(loadAgentTemplate('builder', vars))
  return toCodexToml('builder', description, body, 'workspace-write', vars.model)
}

export function agentReviewerToml(vars: { projectName: string; model?: string }): string {
  const { description, body } = stripFrontmatter(loadAgentTemplate('reviewer', vars))
  return toCodexToml('reviewer', description, body, 'read-only', vars.model)
}

export function agentConsultantToml(vars: { projectName: string; model?: string }): string {
  const { description, body } = stripFrontmatter(loadAgentTemplate('consultant', vars))
  return toCodexToml('consultant', description, body, 'read-only', vars.model)
}

// ─── Claude Code frontmatter translation ─────────────────────────────────────

/**
 * Takes a template markdown string (with simple tools list) and injects
 * `Task` + the agent-specific `mcp__agent-harness-kit__*` tools into the
 * frontmatter `tools:` section for Claude Code.
 *
 * Inserts `Task` after the last non-mcp tool entry, then appends mcp tools.
 */
export function translateFrontmatterForClaudeCode(
  md: string,
  agentName: 'lead' | 'explorer' | 'consultant' | 'builder' | 'reviewer',
  model?: string
): string {
  const permissionsMap: Record<string, string[]> = {
    lead: [...MCP_CLAUDE_PERMISSIONS_LEAD],
    explorer: [...MCP_CLAUDE_PERMISSIONS_EXPLORER],
    consultant: [...MCP_CLAUDE_PERMISSIONS_CONSULTANT],
    builder: [...MCP_CLAUDE_PERMISSIONS_BUILDER],
    reviewer: [...MCP_CLAUDE_PERMISSIONS_REVIEWER],
  }
  const permissions = permissionsMap[agentName] ?? MCP_CLAUDE_PERMISSIONS
  const mcpLines = permissions.map((t) => `  - ${t}`).join('\n')

  // Find the tools: block in frontmatter and append Task + mcp tools after last tool entry
  // We look for the pattern: a line with `  - SomeTool` followed by either `---` or a non-tool line
  let result = md.replace(/(tools:\n(?:  - (?!mcp__)[^\n]+\n)+)/, (match) => {
    const trimmed = match.trimEnd()
    return `${trimmed}\n  - Task\n${mcpLines}\n`
  })

  // Inject a `model:` frontmatter line, independent of the tools: regex above.
  // Placed right after `name: <agentName>` — matches the shape used when a model
  // is manually configured today. No model configured → leave frontmatter untouched.
  if (model) {
    result = injectModelFrontmatterLine(result, model)
  }

  return result
}

/**
 * Inserts (or replaces) a `model: <value>` line right after the `name:` line
 * in a template's YAML frontmatter. Never touches the `tools:` block.
 */
function injectModelFrontmatterLine(md: string, model: string): string {
  // Replace an existing `model:` line if present (idempotent re-generation)...
  if (/^model:\s*.*$/m.test(md)) {
    return md.replace(/^model:\s*.*$/m, `model: ${model}`)
  }
  // ...otherwise insert a new `model:` line right after `name:`.
  return md.replace(/^(name:.*)$/m, `$1\nmodel: ${model}`)
}

// ─── OpenCode frontmatter translation ────────────────────────────────────────

/**
 * Converts the `tools:` YAML list in a template's frontmatter to the
 * dictionary format expected by OpenCode (e.g. `read: true`, `bash: true`).
 *
 * Only transforms the tools: block — all other frontmatter fields and
 * body content are left exactly as-is.
 */
export function translateFrontmatterForOpenCode(md: string): string {
  return md.replace(/(tools:\n(?:  - [^\n]+\n)+)/, (match) => {
    const tools = [...match.matchAll(/  - ([^\n]+)/g)].map((m) => m[1].trim())
    return 'tools:\n' + tools.map((t) => `  ${t.toLocaleLowerCase()}: true`).join('\n') + '\n'
  })
}

// ─── .gitignore additions ─────────────────────────────────────────────────────

export const GITIGNORE_ENTRIES = `
# agent-harness-kit
.harness/harness.db
.harness/harness.db-shm
.harness/harness.db-wal
.harness/current.md
`
