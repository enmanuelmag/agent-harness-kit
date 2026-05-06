# @cardor/agent-harness-kit

**A provider-agnostic scaffolding kit for running structured multi-agent workflows in your codebase.**

Instead of letting AI agents roam freely through your project with no memory, no coordination, and no audit trail, agent-harness-kit gives them a shared structure: a task backlog, a defined workflow, a persistent log of every action taken, and a health gate that must be green before any work begins.

You stay in control. The agents stay on track.

```bash
npx ahk init
```

---

## Why this exists

If you don't know what is Agent Harness, you can check this blog post: [Introducing Agent Harness](https://aakashgupta.medium.com/2025-was-agents-2026-is-agent-harnesses-heres-why-that-changes-everything-073e9877655e).

Most AI coding tools give you a single agent with a chat window. That works for small tasks. It breaks down when:

- You want multiple specialized agents working in sequence (plan → explore → build → review)
- You need to track what changed, what was tried, and what was blocked — across sessions
- You switch between AI providers (Claude Code today, OpenCode tomorrow) and don't want to re-setup everything
- You want a health check that agents must pass before touching code

agent-harness-kit solves all of this with a thin layer of scaffolding and a local MCP server that any MCP-compatible AI tool can connect to.

---

## How it works

```
ahk init
  └── creates config, agent definitions, task backlog, health check

AI tool opens your project
  └── reads .claude/mcp.json or opencode.json
  └── spawns: npx ahk serve (stdio MCP server)

Agent starts working
  └── tasks.get()         → picks a task from the backlog
  └── tasks.claim(id)     → atomically claims it (no double-work)
  └── actions.start()     → registers its action
  └── actions.write()     → logs sections: result, files, blockers…
  └── actions.complete()  → closes the action

Lead → Explorer → Builder → Reviewer
  └── each role has its own agent definition with clear responsibilities
  └── the harness DB records the full history
```

Everything is stored locally in a SQLite database (`.harness/harness.db`). No cloud, no external services, no API keys required beyond what your AI tool already uses.

---

## Features

- **Provider-agnostic** — works with Claude Code, OpenCode, or any MCP-compatible AI tool. Switch providers without losing your task history or reconfiguring your workflow.
- **Structured 4-agent workflow** — Lead, Explorer, Builder, and Reviewer each have defined responsibilities and can only act within their role.
- **Atomic task claiming** — agents use `tasks.claim()` which uses a SQLite transaction to prevent two agents from picking up the same task at the same time.
- **Full audit trail** — every action, file touched, tool used, and section written is stored in SQLite and queryable.
- **Health gate** — agents must run `health.sh` and get a green exit before starting or closing any task. You define what "healthy" means.
- **Markdown fallback** — `current.md` is always regenerated so agents can understand the session state even without the MCP server.
- **Docs search** — agents can call `docs.search(query)` to find relevant content in your project's docs folder before writing code.
- **Zero native dependencies** — uses `node:sqlite` (Node ≥ 22) or `bun:sqlite` (Bun) built-in. No native compilation, no `node-gyp`.
- **Incremental scaffold** — `ahk init` and `ahk build` never overwrite files you've customized. Agent definitions you've edited are preserved.

---

## Requirements

- Node.js ≥ 22 **or** Bun (any recent version)
- npm ≥ 9

---

## Installation

```bash
# Install in your project as a dev dependency
npm install --save-dev @cardor/agent-harness-kit

# Or globally
npm install -g @cardor/agent-harness-kit
```

Then run the interactive setup inside your project:

```bash
npx ahk init
# or, if installed globally:
ahk init
```

---

## Commands

### `ahk init`

Interactive scaffold. Asks for your project name, AI provider, docs path, task adapter, and an optional first task. Creates all harness files in the current directory.

```bash
ahk init

# Skip prompts with flags
ahk init --name "my-app" --provider claude-code --docs ./docs --tasks local
```

Run this once per project. Safe to re-run — it will not overwrite files you've customized.

---

### `ahk build`

Regenerates `AGENTS.md` and provider-specific files from your `agent-harness-kit.config.ts`. Use this after changing config values.

```bash
ahk build
ahk build --watch    # watch mode: rebuilds automatically on config changes
```

---

### `ahk dashboard`

Opens a local web dashboard to visualize everything stored in the harness database — tasks, agent actions, file operations, tool usage, and live timelines. Updates in real time via WebSocket as agents work.

```bash
ahk dashboard                  # opens http://localhost:4242 in your browser
ahk dashboard --port 8080      # custom port
ahk dashboard --no-open        # start server without opening browser
```

The dashboard includes:

| View | What it shows |
|------|--------------|
| **Overview** | Status counts, active tasks with acceptance progress, recent agent activity |
| **Tasks** | Full task list, filterable by status, with acceptance progress bars |
| **Task detail** | Acceptance criteria, action timeline per agent, files touched, tools used |
| **Agents** | Per-role breakdown: actions, tasks worked, files touched, completion rate |
| **Tools** | Top tools bar chart + full log of recent tool calls with args and results |
| **Files** | Most-touched files with operation breakdown + recent file operation log |

![Dashboard](./assets/ahk-dashboard.png)


---

### `ahk status`

Shows the current task table and any active agent actions in the terminal.

```bash
ahk status
ahk status --json    # machine-readable output
```

---

### `ahk health`

Runs `health.sh` and reports the result. Exit 0 = healthy, exit 1 = something is wrong.

```bash
ahk health
```

---

### `ahk sync`

Syncs `.harness/feature_list.json` ↔ SQLite. Tasks already in the DB are skipped by slug. Use this to seed the backlog from the JSON file without duplicating existing tasks.

```bash
ahk sync                         # both directions (default)
ahk sync --direction in          # JSON → SQLite only
ahk sync --direction out         # SQLite → JSON only
ahk sync --dry-run               # preview changes without applying them
ahk sync --dry-run --direction in
```

---

### `ahk serve`

Starts the MCP server on stdio. **You never need to call this manually.** After `ahk init`, the generated `.claude/mcp.json` (Claude Code) or `opencode.json` (OpenCode) tells the AI tool to spawn it automatically when you open the project.

```bash
ahk serve
ahk serve --port 3456    # store a port hint in config (stdio transport only)
```

---

### `ahk task add`

Interactively adds a new task to the backlog (SQLite + `feature_list.json`).

```bash
ahk task add
```

---

### `ahk task list`

Lists all tasks. Optionally filter by status.

```bash
ahk task list
ahk task list --status pending
ahk task list --status in_progress
ahk task list --status done
ahk task list --status blocked
ahk task list --json             # machine-readable output
```

---

### `ahk task done <id|slug>`

Marks a task as done. Runs the health check first if health is required — if it fails, the task is not closed.

```bash
ahk task done 3
ahk task done add-auth-flow
```

---

### `ahk migrate`

Migrates provider-specific files from one AI provider to another. Useful when switching from Claude Code to OpenCode or vice versa.

```bash
ahk migrate --to opencode
ahk migrate --to claude-code
```

---

### `ahk export`

Exports the full database as JSON or SQL. Useful for backups, external reporting, or migrating data.

```bash
ahk export --json                        # JSON to stdout
ahk export --json --output snapshot.json # JSON to file
ahk export --sql                         # SQL dump to stdout
ahk export --sql --output dump.sql       # SQL dump to file
```

---

## Files created by `ahk init`

```
your-project/
├── agent-harness-kit.config.ts    ← main config (edit freely)
├── AGENTS.md                      ← navigation map regenerated from config
├── health.sh                      ← implement your health checks here
├── .harness/
│   ├── harness.db                 ← SQLite source of truth (gitignored)
│   ├── current.md                 ← auto-generated session snapshot (gitignored)
│   └── feature_list.json          ← human-editable task backlog (commit this)
└── .claude/                       ← or .opencode/ depending on your provider
    ├── agents/
    │   ├── lead.md
    │   ├── explorer.md
    │   ├── builder.md
    │   └── reviewer.md
    └── mcp.json                   ← tells Claude Code to spawn ahk serve
```

### What each file does

| File | Purpose | Edit it? |
|------|---------|----------|
| `agent-harness-kit.config.ts` | Defines project metadata, provider, storage paths, MCP port | Yes — it's yours |
| `AGENTS.md` | Navigation map agents read first. Regenerated by `ahk build` | No — changes will be overwritten |
| `health.sh` | Shell script agents run before starting work. Must exit 0 | **Yes — implement your checks here** |
| `.harness/feature_list.json` | Task backlog in JSON. Humans edit this, `ahk sync` loads it into SQLite | Yes — add tasks here |
| `.harness/harness.db` | SQLite database. Source of truth for tasks, actions, sections | No — managed by the harness |
| `.harness/current.md` | Auto-generated session snapshot for agents without MCP access | No — regenerated automatically |
| `.claude/agents/*.md` | Agent role definitions. Created once, never overwritten | **Yes — customize agent behavior** |
| `.claude/mcp.json` | MCP server config. Merged (not overwritten) by `ahk build` | Yes, carefully — don't remove the `agent-harness-kit` entry |

---

## What you can customize

### `agent-harness-kit.config.ts`

Everything in the config file is yours to change:

```ts
import { defineHarness } from '@cardor/agent-harness-kit'

export default defineHarness({
  project: {
    name: 'My App',
    description: 'What this project does',
    docsPath: './docs',           // where agents search for documentation
  },

  provider: 'claude-code',        // 'claude-code' | 'opencode'

  agents: {
    lead:     { instructionsPath: null },
    explorer: { instructionsPath: null, allowedPaths: ['./docs', './src'] },
    builder:  { instructionsPath: null, writablePaths: ['./src', './tests'] },
    reviewer: { instructionsPath: null },
    custom:   [],                 // define extra agents here
  },

  storage: {
    dir:    '.harness',
    dbPath: '.harness/harness.db',
    tasks:  { adapter: 'local' },
    sections: {
      toolsUsed:     true,        // log which tools agents used
      filesModified: true,        // log which files were touched
      result:        true,        // log action results
      blockers:      true,        // log blockers agents hit
      nextSteps:     false,       // optional next steps field
    },
    markdownFallback: { enabled: true, path: '.harness/current.md' },
  },

  health: {
    scriptPath: './health.sh',
    required:   true,             // set to false to skip health checks
  },

  tools: {
    mcp:     { enabled: true, port: 3456 },
    scripts: { enabled: true, outputDir: './.harness/scripts' },
  },
})
```

### `health.sh`

This is the most important file to implement. Agents will not start or close tasks until this script exits 0. Examples:

```bash
#!/usr/bin/env bash

# Check the dev server is up
curl -sf http://localhost:3000/health > /dev/null || exit 1

# Run unit tests
npm test || exit 1

# Check DB connection
psql "$DATABASE_URL" -c "SELECT 1" > /dev/null 2>&1 || exit 1

echo "All checks passed."
```

### Agent definition files (`.claude/agents/*.md` or `.opencode/agents/*.md`)

These are Markdown files with a YAML frontmatter and free-form instructions. They are created once and **never overwritten** by `ahk build` — so any edits you make are permanent.

You can:
- Add domain-specific context (e.g. "this project uses hexagonal architecture")
- Restrict what the agent is allowed to do
- Add project-specific conventions the agent must follow
- Reference specific files or docs the agent should read first

```markdown
---
description: Builder agent — implements the plan produced by explorer and lead
---

# Builder Agent

You are the builder agent for MyApp. Follow these rules:

- All API endpoints must be defined in `src/routes/`
- Never modify `src/core/` without lead approval
- Run `npm test` after every change and fix failures before completing
- Use the existing error handling pattern from `src/lib/errors.ts`
```

### `.harness/feature_list.json`

The human-editable task backlog. Add tasks here, then run `ahk sync` to load them into SQLite.

```json
[
  {
    "slug": "add-auth-flow",
    "title": "Add JWT authentication flow",
    "description": "Implement login, refresh token, and logout endpoints",
    "acceptance": [
      "POST /auth/login returns a signed JWT",
      "POST /auth/refresh validates and rotates the token",
      "All protected routes return 401 without a valid token",
      "Tests cover happy path and token expiry"
    ]
  }
]
```

Good acceptance criteria make the difference — the reviewer agent uses them to decide whether to approve or block a task.

---

## MCP tools (for agents)

The harness exposes these tools via MCP. Agents use them instead of reading files directly.

| Tool | Parameters | Description |
|------|-----------|-------------|
| `tasks.get` | `status?` | List tasks, optionally filtered by `pending \| in_progress \| done \| blocked` |
| `tasks.claim` | `id, agent` | Atomically claim a pending task. Returns `task_already_claimed` if another agent got it first |
| `tasks.update` | `id, status` | Change task status |
| `actions.start` | `taskId, agent` | Start a new action, returns `actionId` |
| `actions.write` | `actionId, sectionType, content` | Record a section: `result \| tools_used \| files_modified \| blockers \| next_steps` |
| `actions.complete` | `actionId, summary` | Close an action with a one-line summary |
| `actions.get` | `taskId` | Full action history for a task (all agents, all sections) |
| `docs.search` | `query` | Search the `docsPath` folder for content matching the query |

---

## Agent roles

| Role | Responsibility |
|------|---------------|
| **lead** | Decomposes the task into a plan, assigns sub-agents. Does not write code or read source files. |
| **explorer** | Reads and maps the codebase. Never writes files. Records every file read. |
| **builder** | Implements the plan. Only writes to `writablePaths`. Records every file modified. |
| **reviewer** | Verifies all acceptance criteria are met. Approves or blocks. Runs health check before approving. |

---

## What to commit

| File | Commit? |
|------|---------|
| `agent-harness-kit.config.ts` | Yes |
| `AGENTS.md` | Yes |
| `health.sh` | Yes |
| `.harness/feature_list.json` | Yes |
| `.claude/agents/*.md` | Yes |
| `.claude/mcp.json` / `opencode.json` | Yes |
| `.harness/harness.db` | **No** (gitignored) |
| `.harness/current.md` | **No** (gitignored) |

The rule: commit inputs (config, task definitions, agent instructions). Ignore outputs (DB, auto-generated snapshots).

---

## Runtime compatibility

| Runtime | Support |
|---------|---------|
| Node.js ≥ 22 | ✅ uses `node:sqlite` built-in |
| Bun (any recent) | ✅ uses `bun:sqlite` built-in |
| Node.js < 22 | ❌ `node:sqlite` not available |

---

## Contributing & local development

```bash
git clone <repo-url>
cd agent-harness-kit
npm install

npm run build:ui    # build the dashboard SPA (dashboard/ → src/dashboard-dist/)
npm run build       # build:ui + tsc + copy-assets
npm run dev         # watch mode (CLI TypeScript only)
npm test            # run tests
npm link            # register ahk globally from local source
```

To work on the dashboard UI with hot reload:

```bash
# Terminal 1 — CLI server (no browser open)
cd your-test-project && ahk dashboard --no-open --port 4242

# Terminal 2 — Vite dev server with HMR
cd dashboard && npm run dev   # http://localhost:5173, proxies /api and /ws → :4242
```

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) with a required scope:

```
feat(cli): add export command
fix(db): prevent race condition in claimTask
chore(ci): update Node version to 22
```

Types: `feat fix chore refactor docs test perf style build ci revert`

---

## Roadmap

- ✅ **`ahk dashboard`** — local web UI with real-time WebSocket updates. Shows tasks, action timelines, file activity, tool usage, and per-agent breakdowns. Run `ahk dashboard` in any initialized project.
- **Open Telemetry integration** — emit OpenTelemetry spans for all agent actions, file operations, and tool calls. Enables distributed tracing and integration with any OT-compatible observability platform.
- **Jira task adapter** — pull tasks directly from Jira instead of maintaining `feature_list.json` manually. The `tasks.adapter` config key is already wired for this.
- **Linear task adapter** — same as Jira, for Linear.
- **GitHub Issues adapter** — same, for GitHub Issues.
- **Remote MCP adapter** — connect to a hosted MCP server instead of a local SQLite file. Enables shared task state across machines and team members without syncing a DB file.
