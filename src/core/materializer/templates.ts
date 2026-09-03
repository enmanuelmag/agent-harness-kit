import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  claudeDisallowedTools,
  codexRestrictionNotice,
  codexSandboxMode,
  grokToolsAllowlist,
  opencodePermissions,
} from './agent-restrictions'

import type { AgentName } from './agent-restrictions'
import type { CodexAgentModelChoice, HarnessConfig } from '@/types'

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

// ─── Shared AGENTS.md / CLAUDE.md body ────────────────────────────────────────

/**
 * Shared body for AGENTS.md and CLAUDE.md provider templates.
 *
 * @param fileName       — e.g. 'AGENTS.md' or 'CLAUDE.md'
 * @param extraInitLines — additional INIT bullets (empty for AGENTS.md)
 * @param orchestratingOverride — optional replacement for the "What to read"
 *                                orchestration line; falls back to a generic
 *                                path when omitted.
 */
function agentsMdBody(
  config: HarnessConfig,
  fileName: string,
  extraInitLines: string = '',
  orchestratingOverride?: string
): string {
  const { name, description, docsPath } = config.project
  const port = config.tools.mcp.port

  let body = `# ${fileName} — ${name}

**Read this file first.** It is the navigation map for every AI agent working in this repository.

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
actions.start        taskId agent                           → start an action, returns a numeric actionId
actions.write        actionId section text                  → record a section (result, blockers, ...)
actions.record_tool  actionId calls[]                        → batch-log tool calls to the Tools dashboard (array, min 1)
actions.record_file  actionId files[]                        → batch-log file touches to the Files dashboard (array, min 1)
actions.complete     actionId summary                       → close the action
actions.list         taskId [agent] [status] [limit] [cursor] → compact newest-first action index with pagination
actions.get_by_id    actionId                               → single action with section index (no content)
actions.sections_list actionId [types] [limit] [cursor]      → compact section index with type filtering
actions.sections_get sectionId [length] [offset]             → ranged section content reader
actions.handoff.get    taskId [recipient]                     → newest completed canonical handoff
actions.handoff.write  actionId recipient ...                 → recipient-directed bounded handoff
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
${extraInitLines ? '\n' : ''}${extraInitLines}
2. WORK  (lead → explorer → consultant → builder → reviewer)
     - Each agent calls actions.start(taskId, agentName) → numeric actionId
     - Accumulate tool calls / file touches as you work; flush periodically (every few calls or at a phase boundary) via actions.record_tool(actionId, calls: [...]) and actions.record_file(actionId, files: [...]) — both are batch-only, even a single entry goes through as a one-element array
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
If orchestrating: ${orchestratingOverride ?? "Agent definition files in your provider's agents directory"}
\`\`\`
`

  // Insert extra INIT bullets after the "pick lowest id" line
  if (extraInitLines) {
    body = body.replace(
      "   - tasks.get('pending') → pick lowest id\n",
      `   - tasks.get('pending') → pick lowest id\n${extraInitLines}\n`
    )
  }

  return body
}

// ─── AGENTS.md template ───────────────────────────────────────────────────────

export function agentsMd(config: HarnessConfig, capabilityHints = ''): string {
  const capabilityBlock = capabilityHints
    ? `## Available Research Tools\n\n${capabilityHints}\n\n`
    : ''

  return `${capabilityBlock}${agentsMdBody(config, 'AGENTS.md')}`
}

// ─── CLAUDE.md template (Claude Code provider) ───────────────────────────────

export function claudeMd(config: HarnessConfig, capabilityHints = ''): string {
  const capabilityBlock = capabilityHints
    ? `## Available Research Tools\n\n${capabilityHints}\n\n`
    : ''

  return `${capabilityBlock}${agentsMdBody(
    config,
    'CLAUDE.md',
    '    - No pending tasks? → ask user, infer fields, call tasks.add, then tasks.claim',
    'Agent definition files in .claude/agents/'
  )}`
}

// ─── agent-harness-kit.config.ts template ───────────────────────────────────────────

interface ConfigTemplateParams {
  name: string
  description: string
  provider: string
  docsPath: string
  tasksAdapter: string
  port: number
  scope: 'local' | 'global'
  projectId: string
}

/**
 * Shared body of the config object literal, reused across the .ts/.mjs/.cjs
 * templates below. Returns the inner fields only (no wrapping braces) so
 * each variant can control its own import/export shape around it.
 */
function configObjectBody(params: ConfigTemplateParams): string {
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

  // There is no 'agents' key. Agent files are yours: edit the role prompt and
  // the 'model:' frontmatter line directly in the generated file. 'ahk build'
  // creates them when missing and never overwrites them — use
  // 'ahk build --force' to regenerate them from the packaged templates.
  // What each role may NOT do is enforced per-tool inside those files
  // (disallowedTools / permission.edit / sandbox_mode); see
  // src/core/materializer/agent-restrictions.ts.

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
 * Structural twin of `configObjectBody()` above, as a real object instead of a
 * source string. `configObjectBody` has to stay a hand-formatted string because
 * its explanatory comments are part of what makes the generated .ts/.mjs/.cjs
 * config readable — JSON has no comments, so the JSON variant cannot reuse it.
 *
 * The two are therefore maintained in parallel, and the drift that invites is
 * pinned by a test asserting that the parsed .ts body and this object are
 * deep-equal. Any field added to one and not the other fails that test.
 *
 * Deliberately contains no `$schema` key: no JSON Schema for HarnessConfig is
 * published or shipped with the package today, and pointing at a URL that does
 * not resolve would trade a type error for a fetch error.
 */
function configObject(params: ConfigTemplateParams): Record<string, unknown> {
  const isGlobal = params.scope === 'global'

  return {
    project: {
      name: params.name,
      description: params.description,
      docsPath: params.docsPath,
    },
    provider: params.provider,
    // There is no 'agents' key here either — it was removed from the config
    // entirely, so the JSON variant must not reintroduce it.
    database: { type: 'sqlite' },
    storage: {
      dir: '.harness',
      tasks: { adapter: params.tasksAdapter },
      sections: {
        toolsUsed: true,
        filesModified: true,
        result: true,
        blockers: true,
        nextSteps: false,
      },
      // Same scope rule as configObjectBody(): 'global' has no local path to
      // declare, so markdownFallback.path is omitted for it.
      markdownFallback: isGlobal
        ? { enabled: true }
        : { enabled: true, path: '.harness/current.md' },
      scope: params.scope,
      projectId: params.projectId,
    },
    health: {
      scriptPath: './health.sh',
      required: true,
    },
    tools: {
      mcp: { enabled: true, port: params.port },
      scripts: { enabled: true, outputDir: './.harness/scripts' },
    },
  }
}

/**
 * JSON config: emitted when the package is NOT installed locally in the project
 * (see detectConfigExtension). Plain data — no import, no type annotation, no
 * reference to '@cardor/agent-harness-kit' of any kind — so an editor and a
 * `tsc --noEmit` have nothing to resolve and report zero errors. That is the
 * whole point of this variant: the .ts template's `import type` is erased at
 * runtime, but it still red-underlines in an editor that cannot resolve the
 * package.
 *
 * Cost of the trade: no autocompletion. JSON.stringify handles all quoting and
 * escaping, so descriptions containing quotes or apostrophes are safe by
 * construction rather than by careful template authoring.
 */
export function configJson(params: ConfigTemplateParams): string {
  return JSON.stringify(configObject(params), null, 2) + '\n'
}

/** Exported for the drift test that compares this shape against the parsed
 *  .ts/.mjs/.cjs config body. Not part of the public API. */
export const __configObjectForTests = configObject

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

/**
 * Inject provider-specific research capability hints into an agent template
 * body. The hints are inserted after the main `# Agent Name` heading so they
 * appear early in the instructions but after the role declaration.
 */
function injectCapabilityHints(md: string, capabilityHints: string): string {
  if (!capabilityHints) return md
  // Find the main H1 heading line and insert after it (and any blank line following).
  const headingMatch = md.match(/^(#\s+.*?\n\n)/m)
  if (!headingMatch) return md
  return `${headingMatch[1]}## Available Research Tools\n\n${capabilityHints}\n\n${md.slice(headingMatch[1].length)}`
}

export function injectDelegationGuidance(md: string, delegationGuidance: string): string {
  if (!delegationGuidance) return md
  // Try to find the existing "Available Research Tools" section and insert
  // after its closing blank line; otherwise fall back to right after H1.
  const researchSection = md.match(/(## Available Research Tools\n\n[\s\S]*?)\n\n/m)
  if (researchSection) {
    const insertionPoint = researchSection[1].length + '## Available Research Tools\n\n'.length
    const afterResearch = md.slice(insertionPoint)
    return (
      md.slice(0, insertionPoint) +
      `\n## Provider Delegation Guidance\n\n${delegationGuidance}\n\n${afterResearch}`
    )
  }
  // Fallback: insert after H1 heading block.
  const headingMatch = md.match(/^(#\s+.*?\n\n)/m)
  if (!headingMatch) return md
  return `${headingMatch[1]}## Provider Delegation Guidance\n\n${delegationGuidance}\n\n${md.slice(headingMatch[1].length)}`
}

export function agentLead(
  opts: { projectName: string },
  capabilityHints = '',
  delegationGuidance = ''
): string {
  let result = loadAgentTemplate('lead', opts)
  result = injectCapabilityHints(result, capabilityHints)
  result = injectDelegationGuidance(result, delegationGuidance)
  return result
}

export function agentExplorer(opts: { projectName: string }, capabilityHints = ''): string {
  return injectCapabilityHints(loadAgentTemplate('explorer', opts), capabilityHints)
}

export function agentBuilder(opts: { projectName: string }, capabilityHints = ''): string {
  return injectCapabilityHints(loadAgentTemplate('builder', opts), capabilityHints)
}

export function agentConsultant(opts: { projectName: string }, capabilityHints = ''): string {
  return injectCapabilityHints(loadAgentTemplate('consultant', opts), capabilityHints)
}

export function agentReviewer(opts: { projectName: string }, capabilityHints = ''): string {
  return injectCapabilityHints(loadAgentTemplate('reviewer', opts), capabilityHints)
}

// Note: agentLead/agentExplorer/agentConsultant/agentBuilder/agentReviewer above produce the
// raw markdown template (frontmatter without `model:` and without any permission fields).
// No `model:` line is ever injected, by any provider: the per-agent `model` config was removed
// along with the whole `agents` key, and the generated agent file is user-owned, so the model is
// set by editing the file's frontmatter directly. Each provider applies its own default when no
// model line is present. Permission/restriction fields ARE added downstream by each provider's
// translator, driven by AGENT_RESTRICTIONS in ./agent-restrictions.ts, which is the single source
// of truth for what a role may not do.

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
 * No `model` / `model_reasoning_effort` line is emitted unless `opts` supplies
 * one. The generated file is user-owned, so by default the model is set by
 * editing those lines directly in `.codex/agents/<role>.toml`; omitting them
 * here lets Codex apply its own default, which is what the old 'inherit'
 * option meant. `opts` is the one caller-controlled exception — it is how
 * `ahk init`'s per-role Codex model+effort prompt (`promptCodexAgentModels`)
 * applies a user's actual answer, mirroring `translateFrontmatterForClaudeCode`'s
 * `opts.model` for Claude Code.
 *
 * Both fields are guarded against empty strings: Codex's per-agent-role file
 * format uses `#[serde(deny_unknown_fields)]`, so a malformed key takes the
 * WHOLE role file offline, and its reasoning-effort parser explicitly rejects
 * an empty string (every other unrecognized value is silently accepted as a
 * custom effort, but `""` is the one hard error) — so a line is only ever
 * emitted for a genuinely non-empty value.
 */
function toCodexToml(
  tomlName: string,
  agentName: AgentName,
  description: string,
  body: string,
  opts?: CodexAgentModelChoice
): string {
  // TOML multiline basic strings end at `"""` — escape any that appear in content
  const safe = (s: string) => s.replace(/"""/g, '""\\u0022')

  // Codex has no per-agent tool denylist. As of task #83, all roles run with
  // sandbox_mode = "danger-full-access" (deliberate, user-chosen project
  // configuration) — sandbox_mode is no longer an enforcement mechanism for
  // the no-write roles, so the restriction is restated in prose inside
  // developer_instructions, which is now the ONLY enforcement for those roles.
  const sandboxMode = codexSandboxMode(agentName)
  const notice = codexRestrictionNotice(agentName)
  const instructions = notice ? `${body.trimEnd()}\n\n---\n\n${notice}` : body.trimEnd()

  const modelLines: string[] = []
  if (opts?.model) modelLines.push(`model = "${opts.model}"`)
  if (opts?.effort) modelLines.push(`model_reasoning_effort = "${opts.effort}"`)
  const modelBlock = modelLines.length > 0 ? `${modelLines.join('\n')}\n` : ''

  return `name = "${tomlName}"
sandbox_mode = "${sandboxMode}"
${modelBlock}
description = """
${safe(description)}
"""

developer_instructions = """
${safe(instructions)}
"""
`
}

export function agentLeadToml(
  vars: { projectName: string },
  opts?: CodexAgentModelChoice,
  delegationGuidance = ''
): string {
  const { description, body } = stripFrontmatter(loadAgentTemplate('lead', vars))
  const bodyWithDelegation = delegationGuidance
    ? `${body}\n\n## Provider Delegation Guidance\n\n${delegationGuidance}`
    : body
  return toCodexToml('lead', 'lead', description, bodyWithDelegation, opts)
}

export function agentLeadAsDefaultToml(
  vars: { projectName: string },
  opts?: CodexAgentModelChoice,
  delegationGuidance = ''
): string {
  const { description, body } = stripFrontmatter(loadAgentTemplate('lead', vars))
  const bodyWithDelegation = delegationGuidance
    ? `${body}\n\n## Provider Delegation Guidance\n\n${delegationGuidance}`
    : body
  return toCodexToml('default', 'lead', description, bodyWithDelegation, opts)
}

export function agentExplorerToml(
  vars: { projectName: string },
  opts?: CodexAgentModelChoice
): string {
  const { description, body } = stripFrontmatter(loadAgentTemplate('explorer', vars))
  return toCodexToml('explorer', 'explorer', description, body, opts)
}

export function agentBuilderToml(
  vars: { projectName: string },
  opts?: CodexAgentModelChoice
): string {
  const { description, body } = stripFrontmatter(loadAgentTemplate('builder', vars))
  return toCodexToml('builder', 'builder', description, body, opts)
}

export function agentReviewerToml(
  vars: { projectName: string },
  opts?: CodexAgentModelChoice
): string {
  const { description, body } = stripFrontmatter(loadAgentTemplate('reviewer', vars))
  return toCodexToml('reviewer', 'reviewer', description, body, opts)
}

export function agentConsultantToml(
  vars: { projectName: string },
  opts?: CodexAgentModelChoice
): string {
  const { description, body } = stripFrontmatter(loadAgentTemplate('consultant', vars))
  return toCodexToml('consultant', 'consultant', description, body, opts)
}

// ─── Claude Code frontmatter translation ─────────────────────────────────────

/**
 * Removes a `tools:` (or `disallowedTools:`) YAML block sequence from the
 * frontmatter, if present. Used to normalise a template before re-emitting the
 * provider-native permission shape, so translation stays idempotent even when
 * fed already-translated content.
 */
function stripFrontmatterBlockSequence(md: string, key: string): string {
  const re = new RegExp(`^${key}:\\n(?:  - [^\\n]+\\n)+`, 'm')
  return md.replace(re, '')
}

/**
 * Appends a YAML block sequence (one `  - value` per line) to the end of the
 * frontmatter, just before its closing `---`. Block sequence — not the inline
 * comma form shown in some upstream docs — for consistency with the rest of the
 * agent files in this repo.
 */
function appendFrontmatterBlockSequence(md: string, key: string, values: string[]): string {
  if (values.length === 0) return md
  const block = `${key}:\n${values.map((v) => `  - ${v}`).join('\n')}\n`
  return md.replace(/^---\n([\s\S]*?)^---\n/m, (_m, body: string) => `---\n${body}${block}---\n`)
}

/**
 * Appends a single scalar key (e.g. `model: opus`) to the end of the
 * frontmatter, just before its closing `---`. Only used where the caller has
 * already guarded that the frontmatter does not carry a hand-authored value
 * for this key — this function does not check for an existing line itself.
 */
function appendFrontmatterScalar(md: string, key: string, value: string): string {
  const block = `${key}: ${value}\n`
  return md.replace(/^---\n([\s\S]*?)^---\n/m, (_m, body: string) => `---\n${body}${block}---\n`)
}

/**
 * Appends a nested YAML mapping (e.g. `permission:\n  edit: deny`) to the end of
 * the frontmatter, just before its closing `---`.
 */
function appendFrontmatterMapping(
  md: string,
  key: string,
  entries: Record<string, string>
): string {
  const keys = Object.keys(entries)
  if (keys.length === 0) return md
  const block = `${key}:\n${keys.map((k) => `  ${k}: ${entries[k]}`).join('\n')}\n`
  return md.replace(/^---\n([\s\S]*?)^---\n/m, (_m, body: string) => `---\n${body}${block}---\n`)
}

/**
 * Translates a template's frontmatter into the Claude Code agent shape.
 *
 * `tools` is deliberately OMITTED: a Claude Code sub-agent with no `tools` key
 * inherits the full tool set, which includes `Task` and every `mcp__*` tool from
 * the connected servers. That inheritance replaces the explicit Task + MCP tool
 * injection this function used to perform — enumerating them was both redundant
 * and the reason `ahk doctor` reported hand-edited agent files as "outdated".
 *
 * Restrictions are expressed as a denylist via `disallowedTools`, which Claude
 * Code applies before `tools`.
 *
 * No `model:` line is emitted by default. Those generated files are
 * user-owned, so their model is normally set by editing the frontmatter
 * directly; with no line emitted, Claude Code applies its own default — the
 * behaviour the old 'inherit' option described.
 *
 * `opts.model` is the one caller-controlled exception: when the value is
 * provided and is not 'inherit', a `model: <value>` line is injected for
 * whichever `agentName` is passed in. This is how `ahk init`'s per-role model
 * prompt (Claude Code only) applies a user's choice to a role's generated
 * `.claude/agents/<role>.md` at scaffold time — it writes straight into this
 * function's output, never into config. Omitting `opts` (or passing 'inherit')
 * keeps the contract byte-identical to the no-model-line default.
 */
export function translateFrontmatterForClaudeCode(
  md: string,
  agentName: AgentName,
  opts?: { model?: string }
): string {
  let result = stripFrontmatterBlockSequence(md, 'tools')
  result = stripFrontmatterBlockSequence(result, 'disallowedTools')
  if (opts?.model && opts.model !== 'inherit') {
    result = appendFrontmatterScalar(result, 'model', opts.model)
  }
  return appendFrontmatterBlockSequence(result, 'disallowedTools', claudeDisallowedTools(agentName))
}

// ─── OpenCode frontmatter translation ────────────────────────────────────────

/**
 * Translates a template's frontmatter into the OpenCode agent shape.
 *
 * The `tools: { read: true, ... }` dict this function used to emit is
 * deprecated upstream in favour of `permission`, so no `tools` key is written
 * at all — the agent inherits the default tool set. Restrictions are expressed
 * as `permission` entries with `allow | ask | deny` values.
 *
 * Only ONE key is emitted for the no-write case: OpenCode has no separate
 * `write` permission — `edit` already covers write/patch/edit.
 *
 * Note on MCP tools: under OpenCode they are named `<server>_<tool>` with no
 * `mcp__` prefix, so Claude Code patterns must never be ported here verbatim.
 * Nothing in the current restriction set targets MCP tools, so none are emitted.
 */
export function translateFrontmatterForOpenCode(md: string, agentName: AgentName): string {
  let result = stripFrontmatterBlockSequence(md, 'tools')
  result = stripFrontmatterBlockSequence(result, 'disallowedTools')
  return appendFrontmatterMapping(result, 'permission', opencodePermissions(agentName))
}

// ─── Grok Build frontmatter translation ──────────────────────────────────────

/**
 * Translates a template's frontmatter into the Grok Build agent shape.
 *
 * Grok Build's format is markdown + YAML frontmatter, like Claude Code and
 * OpenCode (unlike Codex's TOML), so this reuses the same generic
 * block-sequence helpers `translateFrontmatterForClaudeCode` uses — structural
 * twin to `translateFrontmatterForOpenCode` above.
 *
 * Unlike Claude's `disallowedTools` (a denylist), Grok's `tools:` field is an
 * ALLOWLIST: `grokToolsAllowlist()` returns the full set of permitted tool
 * names for 'no-write' roles, or `[]` for the unrestricted 'none' role (which
 * `appendFrontmatterBlockSequence` turns into an omitted `tools:` key,
 * inheriting every tool — matching Claude/OpenCode's "inherit all" behaviour
 * for `builder`).
 */
export function translateFrontmatterForGrok(md: string, agentName: AgentName): string {
  let result = stripFrontmatterBlockSequence(md, 'tools')
  result = stripFrontmatterBlockSequence(result, 'disallowedTools')
  return appendFrontmatterBlockSequence(result, 'tools', grokToolsAllowlist(agentName))
}

// ─── .gitignore additions ─────────────────────────────────────────────────────

export const GITIGNORE_ENTRIES = `
# agent-harness-kit
.harness/harness.db
.harness/harness.db-shm
.harness/harness.db-wal
.harness/current.md
`
