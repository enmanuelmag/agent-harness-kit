# @cardor/agent-harness-kit

**A provider-agnostic scaffolding kit for running structured multi-agent workflows in your codebase.**

![npm version](https://img.shields.io/npm/v/@cardor/agent-harness-kit)
![npm downloads](https://img.shields.io/npm/dm/@cardor/agent-harness-kit)
![license](https://img.shields.io/npm/l/@cardor/agent-harness-kit)
[![Known Vulnerabilities](https://snyk.io/test/npm/@cardor/agent-harness-kit/badge.svg)](https://snyk.io/test/npm/@cardor/agent-harness-kit)

Instead of letting AI agents roam freely through your project with no memory, no coordination, and no audit trail, agent-harness-kit gives them a shared structure: a task backlog, a defined workflow, a persistent log of every action taken, and a health gate that must be green before any work begins.

You stay in control. The agents stay on track.

Visit the [website](https://stack.cardor.dev/ahk) to view a full explanation, examples, and other tools!

<a href='https://ko-fi.com/S6S31ZBGQK' target='_blank'><img height='36' style='border:0px;height:36px;' src='https://storage.ko-fi.com/cdn/kofi6.png?v=6' border='0' alt='Buy Me a Coffee at ko-fi.com' /></a>

```bash
npx ahk init
```

---

## Table of Contents

- [@cardor/agent-harness-kit](#cardoragent-harness-kit)
  - [Table of Contents](#table-of-contents)
  - [Why this exists](#why-this-exists)
  - [How it works](#how-it-works)
  - [Features](#features)
  - [Requirements](#requirements)
  - [Installation](#installation)
  - [MCP command per package manager](#mcp-command-per-package-manager)
  - [Commands](#commands)
    - [`ahk init`](#ahk-init)
    - [`ahk build`](#ahk-build)
    - [`ahk dashboard`](#ahk-dashboard)
    - [`ahk status`](#ahk-status)
    - [`ahk health`](#ahk-health)
    - [`ahk doctor`](#ahk-doctor)
    - [`ahk sync`](#ahk-sync)
    - [`ahk serve`](#ahk-serve)
    - [`ahk task add`](#ahk-task-add)
    - [`ahk task list`](#ahk-task-list)
    - [`ahk task done <id|slug>`](#ahk-task-done-idslug)
    - [`ahk reset`](#ahk-reset)
    - [`ahk migrate`](#ahk-migrate)
    - [`ahk export`](#ahk-export)
  - [Files created by `ahk init`](#files-created-by-ahk-init)
    - [What each file does](#what-each-file-does)
  - [Tasks schema](#tasks-schema)
  - [What you can customize](#what-you-can-customize)
    - [`agent-harness-kit.config.{json|ts|mjs|cjs}`](#agent-harness-kitconfigjsontsmjscjs)
    - [`health.sh`](#healthsh)
    - [Agent definition files](#agent-definition-files)
    - [`.harness/feature_list.json`](#harnessfeature_listjson)
  - [MCP tools (for agents)](#mcp-tools-for-agents)
  - [Agent roles](#agent-roles)
    - [MCP tool permissions by role](#mcp-tool-permissions-by-role)
  - [What to commit](#what-to-commit)
  - [Runtime compatibility](#runtime-compatibility)
  - [Contributing \& local development](#contributing--local-development)
    - [Testing the local build in another project](#testing-the-local-build-in-another-project)
  - [Security Policy](#security-policy)
  - [Roadmap](#roadmap)

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
  └── reads .claude/mcp.json, opencode.json, or .codex/config.toml
  └── spawns: ahk serve (stdio MCP server)
      via your package manager (npx/pnpm exec/yarn run/bunx) when the
      package is a local dependency, or the bare binary when it isn't

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

- **Provider-agnostic** — works with Claude Code, OpenCode, Codex CLI, or any MCP-compatible AI tool. Switch providers without losing your task history or reconfiguring your workflow.
- **Structured 5-agent workflow** — Lead, Explorer, Consultant, Builder, and Reviewer each have defined responsibilities and can only act within their role.
- **Atomic task claiming** — agents use `tasks.claim()` which uses a SQLite transaction to prevent two agents from picking up the same task at the same time.
- **Full audit trail** — every action, file touched, tool used, and section written is stored in SQLite and queryable.
- **Health gate** — agents must run `health.sh` and get a green exit before starting or closing any task. You define what "healthy" means.
- **Markdown fallback** — `current.md` is always regenerated so agents can understand the session state even without the MCP server.
- **Docs search** — agents can call `docs.search(query)` to find relevant content in your project's docs folder before writing code.
- **Multi-database support** — SQLite by default (uses `better-sqlite3` on Node ≥ 22 or `bun:sqlite` on Bun). Switch to PostgreSQL or MySQL with a single config line — same schema, same MCP tools, same workflow.
- **Incremental scaffold** — `ahk init` preserves files you've already customized (agent definitions you've edited are kept). `ahk build` does too: it creates missing agent files and never touches existing ones. Use `ahk build --force` to regenerate them from the latest templates, discarding your edits (a backup is written first).
- **Global installation** — `ahk init` can scaffold the harness into your home directory (`~/.claude` or `~/.config/opencode`) to share it across all projects.
- **Input validation** — CLI prompts validate all inputs (name length, path format, task title, etc.) and retry with the error message instead of silently accepting bad values.

---

## Requirements

- Node.js ≥ 22.5 **or** Bun (any recent version)
- npm ≥ 9

---

## Installation

```bash
# Install in your project as a dev dependency (recommended)
npm install --save-dev @cardor/agent-harness-kit
```

Then run the interactive setup inside your project:

```bash
npx ahk init
```

> **The config file format depends on whether the package is installed locally.** `ahk init` checks that first, before anything else:
>
> | Local install | Generated config | Why |
> | --- | --- | --- |
> | **Not installed** (global-only CLI) | `agent-harness-kit.config.json` | Your project cannot resolve `@cardor/agent-harness-kit`, so a TypeScript config's `import type` would red-underline in your editor and fail `tsc --noEmit` on a package that isn't there. JSON has no imports and no types — nothing to resolve, zero editor errors. |
> | **Installed** (`npm install --save-dev @cardor/agent-harness-kit`) | `.ts`, `.mjs` or `.cjs` | The package resolves, so you get the full typed config with editor autocompletion. Which of the three is picked is unchanged: `.ts` when a `tsconfig.json` is present, otherwise `.mjs`/`.cjs` based on `package.json` `type`. |
>
> The trade-off is autocompletion: a JSON config has no type information behind it, so your editor cannot suggest fields. Installing the package locally and switching to a `.ts` config gets that back. There is no `$schema` key in the generated JSON — no JSON Schema for `HarnessConfig` is published yet, and pointing at a URL that doesn't resolve would only swap a type error for a fetch error.
>
> **Existing projects are never converted.** If a config of any extension already exists, it keeps working and keeps its format — installing or removing the package locally will not silently rewrite it. `loadConfig()` reads all five formats, and `ahk init` stops when it finds any of them.
>
> **A local install is still recommended** even though it is no longer required: it pins the CLI version so behavior stays reproducible across your team and CI instead of drifting with whatever is installed globally on each machine. On a global-only install `ahk` prints a non-blocking warning suggesting it — the command runs and exits normally either way.
>
> This check also works with **Yarn Berry (PnP)** projects, which never create a `node_modules` folder — `ahk` detects `.pnp.cjs`/`.pnp.loader.mjs` and falls back to checking that the package is declared in `package.json` instead of requiring a `node_modules` entry.

---

## MCP command per package manager

`ahk init` and `ahk build` detect which package manager your project uses and generate the MCP server launch command (`.mcp.json`, `opencode.json`, or `.codex/config.toml`) accordingly, instead of hardcoding `npx`:

| Package manager           | Detected via                                                              | Generated command                             |
| -------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------- |
| npm                        | `packageManager` field, `package-lock.json`, or fallback                    | `npx --no ahk serve --port <port>`             |
| pnpm                       | `packageManager` field or `pnpm-lock.yaml`                                  | `pnpm exec ahk serve --port <port>`            |
| yarn classic (v1)          | `packageManager` field (major 1) or `yarn.lock` without `.yarnrc.yml`       | `yarn run ahk serve --port <port>`             |
| yarn berry (v2+, PnP or node-modules) | `packageManager` field (major ≥ 2) or `yarn.lock` + `.yarnrc.yml` | `yarn run ahk serve --port <port>`             |
| bun                        | `packageManager` field or `bun.lockb`/`bun.lock`                            | `bunx --no-install ahk serve --port <port>`    |
| **any — no local install** | `@cardor/agent-harness-kit` is not a dependency of your project             | `ahk serve --port <port>`                      |

Detection order: the `packageManager` field in your `package.json` (e.g. `"packageManager": "pnpm@8.15.0"`) takes priority when present; otherwise `ahk` falls back to lockfile heuristics; if nothing is detected, it defaults to npm.

**Global installs bypass the package manager entirely.** Every command in the table above asks your package manager to resolve a *locally installed* `ahk` binary — `npx --no` deliberately refuses to download one, and `pnpm exec`/`yarn run`/`bunx --no-install` have nothing to point at. If you installed the CLI globally and never added it to the project, all five of those commands fail. So `ahk` checks for the local install first (the same check that decides your config file format, above) and, when there is none, generates the bare `ahk serve --port <port>` — resolved from your `PATH` like any other global binary. The package-manager-specific commands are used only when a local install actually exists.

Working inside the `agent-harness-kit` repository itself counts as a local install: the package manager can resolve the workspace binary, so the `pnpm exec` form is generated rather than the bare one.

**Existing projects:** if you initialized your project before this change, your `.mcp.json`/`opencode.json`/`.codex/config.toml` may still have a hardcoded `npx` command. No migration step is needed — `ahk build` always regenerates (merges) these files from scratch on every run, so the command self-corrects the next time you run `ahk build` (or `ahk build --sync`), including if you've since switched package managers.

---

## Commands

### `ahk init`

Interactive scaffold. Asks for your project name, description, AI provider, docs path, storage scope, task adapter, and an optional first task. Creates all harness files in the current directory.

For Claude Code and Codex CLI (not OpenCode), you'll also be asked whether to personalize the model per agent (lead/explorer/consultant/builder/reviewer):

- Claude Code: pick from `inherit` (default), `haiku`, `sonnet`, `opus`, `fable` per agent.
- Codex CLI: free-text model name per agent — Codex does not validate this value; leaving it blank or under 3 characters means no override is written to that agent's TOML file.

**Storage scope** — where the harness DB (and its `current.md` fallback) physically lives:

- `local` (default) — `.harness/harness.db`, inside the project.
- `global` — `~/.harness/dbs/<projectId>/harness.db`, outside the project tree (useful to keep the DB out of version control entirely, or to centralize storage for many projects). `<projectId>` is a UUID generated once at init and persisted in `agent-harness-kit.config.ts` — it's never regenerated on subsequent runs.

Regardless of scope, `.harness/storage-state.json` is always written to the project — it records the *actual* current storage state (`scope`, `projectId`, `dbType`, `migratedAt`), separate from the *desired* state declared in the config file.

Agent and skill files always live in the project tree, regardless of storage scope — `--storage-scope` only affects where the harness DB lives.

```bash
ahk init

# Skip prompts with flags
ahk init --name "my-app" --provider claude-code --docs ./docs --tasks local --storage-scope local
ahk init --name "my-app" --provider codex-cli   --docs ./docs --tasks local --storage-scope global
```

Run this once per project. If the project is already initialized, the command prints an 'already initialized' message with suggested next-step commands (`ahk build`, `ahk build --sync`, `ahk reset`, `ahk serve`) and exits without overwriting anything.

The config file extension is chosen automatically: `.ts` if a `tsconfig.json` is present, `.mjs` for ESM-only projects (`"type": "module"` in `package.json`), or `.mjs` otherwise.

---

### `ahk build`

Regenerates `AGENTS.md` and provider-specific files from your `agent-harness-kit.config.ts`. Use this after changing config values.

```bash
ahk build
ahk build --watch    # watch mode: rebuilds automatically on config changes
ahk build --force    # DESTRUCTIVE: regenerate agent files, discarding your edits
ahk build --sync     # kept for backwards compatibility — now a no-op on every provider
```

### Agent files are yours

`ahk build` **creates agent files that are missing and never modifies ones that already exist.** Edit `.claude/agents/<role>.md` (or `.opencode/agents/<role>.md`, or `.codex/agents/<role>.toml`) freely — change the role prompt, set a `model:` line, adjust the restriction fields. Rebuilding will not revert your work. `ahk doctor` does not report hand-edited files either; it checks existence only.

Everything else `build` writes — `AGENTS.md`, `CLAUDE.md`, MCP config, skills — is derived from your config and **is** regenerated on every run.

> **If you use OpenCode or Codex CLI, your agent files may be out of date right now.** Those two providers have always preserved existing agent files on build, which means they have never picked up template improvements shipped in newer versions of this package. Claude Code, by contrast, used to overwrite them on every build — that inconsistency was a bug, and it is now fixed in favour of preserving your edits. To pull in the current templates, run `ahk build --force` (read the warning below first).

### `--force`

Because `build` no longer overwrites agent files on any provider, `--force` is the **only** way to regenerate them from the packaged templates. It is destructive:

```bash
ahk build --force
```

- **It discards your customizations.** Every agent file is rewritten from the template. Prompt edits, `model:` lines, and restriction tweaks are all lost.
- **It backs up first.** Before overwriting anything, the current content of every affected file is copied to `.harness/backups/agents-<timestamp>/`. If that backup cannot be written, the command aborts and **no file is modified** — the same fail-safe as [`ahk migrate storage --force`](#storage-migration).
- **It names what it touched.** The command prints every file it overwrote and the backup location, so you can diff or restore.

`--watch` never forces, even if you pass both flags: an automatic rebuild triggered by a file change must not destroy your edits in the background.

`--sync` used to rewrite the `tools:` frontmatter of agent files so it matched a canonical allowlist. Agent files no longer declare an allowlist at all — they inherit every tool and declare only restrictions — so there is nothing left to synchronise. Use `ahk build --force` to regenerate agent files.

---

### `ahk dashboard`

Opens a local web dashboard to visualize everything stored in the harness database — tasks, agent actions, file operations, tool usage, and live timelines. Updates in real time via WebSocket as agents work.

```bash
ahk dashboard                  # opens http://localhost:4242 in your browser
ahk dashboard --port 8080      # custom port
ahk dashboard --no-open        # start server without opening browser
```

If the requested port (default `4242`) is already in use, `ahk dashboard` automatically tries up to 10 sequential ports (e.g. `4242 → 4243 → … → 4251`). The actual port opened is printed to the console. If all 10 ports are exhausted, the command exits with a clear error message showing which port range was attempted.

The dashboard includes:

| View            | What it shows                                                               |
| --------------- | --------------------------------------------------------------------------- |
| **Overview**    | Status counts, active tasks with acceptance progress, recent agent activity |
| **Tasks**       | Full task list, filterable by status, with acceptance progress bars         |
| **Task detail** | Acceptance criteria, action timeline per agent, files touched, tools used   |
| **Agents**      | Per-role breakdown: actions, tasks worked, files touched, completion rate   |
| **Tools**       | Top tools bar chart + full log of recent tool calls with args and results   |
| **Files**       | Most-touched files with operation breakdown + recent file operation log     |

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

### `ahk doctor`

Checks the installed lib version, that every agent file is present, and that the harness skills are in sync.

```bash
ahk doctor
```

Reports three categories:

- **lib version** — compares installed version against the latest on npm. Shows `[✓]` if up to date, `[!]` if an update is available, or `[~]` if the registry could not be reached.
- **agent files** — checks only that a definition file exists for every role. Reports `[!]` with the file name if one is missing. The contents are never read, so **editing an agent file by hand is a fully supported state and is never reported** — customise the body, the description, or the restrictions freely and `ahk doctor` stays green.
- **harness skills** — checks that `ahk-ask`, `ahk-consultant`, `ahk-triage`, and `ahk-review` skills exist and match the bundled source. Reports `[!]` if missing or outdated.

Run `ahk build` to fix any reported issues.

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

### `ahk reset`

Clears harness data interactively. Only SQLite databases are managed by this command — remote Postgres/MySQL databases are intentionally skipped.

```bash
ahk reset                          # interactive — asks before deleting each item
ahk reset --force                  # skip all confirmation prompts
ahk reset --provider claude-code   # also delete agent files for this provider
ahk reset --provider opencode
ahk reset --provider codex-cli
```

What it can reset:

- The SQLite `.db` file (plus WAL and SHM files if present)
- `.harness/feature_list.json`
- Agent definition files in `.claude/agents/`, `.opencode/agents/`, or `.codex/agents/`

After a reset, run `ahk init` to scaffold a fresh harness.

---

### `ahk migrate`

`ahk migrate` has two subcommands: `provider` (migrate scaffold files to a different AI provider) and `storage` (migrate the harness database between storage backends). `ahk migrate --to <provider>` (no subcommand) is kept as a backward-compatible alias for `ahk migrate provider --to <provider>` — existing scripts/CI using the old form keep working unchanged.

#### `ahk migrate provider`

Migrates provider-specific files from one AI provider to another. Useful when switching from Claude Code to OpenCode or vice versa.

```bash
ahk migrate provider --to opencode
ahk migrate provider --to claude-code
ahk migrate provider --to codex-cli

# Backward-compatible alias (identical behavior):
ahk migrate --to opencode
```

#### `ahk migrate storage` — ⚠️ sensitive, reads/writes real harness data

Migrates the harness database between storage backends: **local↔global scope** (moving `.harness/harness.db` in/out of `~/.harness/dbs/<projectId>/`) and **sqlite↔postgres/mysql** (dumping and reloading all 6 tables — tasks, task_acceptance, actions, action_sections, action_files, action_tools — inside a single transaction). It is **not interactive** — `agent-harness-kit.config.ts` (`storage.scope`, `storage.sqlitePath` (local scope only), `database.type`/`connectionString`) is the only source of truth for the desired target, compared against the real current state recorded in `.harness/storage-state.json`.

```bash
ahk migrate storage             # migrate to whatever agent-harness-kit.config.ts declares
ahk migrate storage --dry-run   # preview what would happen, without touching anything
ahk migrate storage --force     # required whenever the destination already has data
```

What it does, case by case:

| Situation | Behavior |
|---|---|
| Config and real storage state already match | No-op — reports "nothing to migrate" |
| Only `storage.scope` differs (same DB engine) | Copies the `.db` file (+ WAL/SHM) and `current.md` directly to the new location, verifies the copy, then removes the original |
| Only `database.type` differs (sqlite → postgres/mysql) | Full export/import of all 6 tables inside one transaction; on failure, the destination is rolled back exactly as it was found |
| Destination already has data | **Requires `--force`.** Without it, the command aborts and touches nothing. With it, the destination's current content is backed up to `.harness/backups/pre-migrate-<timestamp>.json` **before** anything is overwritten — if the backup can't be written, the whole command aborts |
| Both source and destination have diverging data (not just empty vs. full) | Same as above (`--force` + backup required) — the command never attempts to auto-merge two independent histories |
| `.harness/storage-state.json` is missing | Never assumed to mean "safe, empty destination." Both the local and global sqlite candidate locations are inspected for real data first; if both have data, the command refuses to guess and asks for manual resolution |

**Limitations (by design, matches the current scope):**
- No connection pooling or incremental/partial migrations — always a full dump/load.
- After inserting rows with their original ids, the destination's internal id sequence is explicitly re-synced (`setval` on Postgres, `sqlite_sequence` update on SQLite; MySQL's `AUTO_INCREMENT` advances on its own) so that the next normal task/action created after migrating never collides with an imported id.
- Migrating *away from* a previously remote (postgres/mysql) database isn't supported automatically — `storage-state.json` intentionally never stores connection credentials, so there's nothing to reconnect to. Export manually with `ahk export --json` while still connected to the old database first.
- The original sqlite file is **not** deleted after a sqlite→remote migration — remove it manually once you've verified the migrated data.

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

**Claude Code** (`provider: 'claude-code'`):

```
your-project/
├── agent-harness-kit.config.{json|ts|mjs|cjs}
├── AGENTS.md
├── CLAUDE.md
├── health.sh
├── .harness/
│   ├── harness.db                 ← gitignored (local scope only — absent when scope: 'global')
│   ├── current.md                 ← gitignored (local scope only — absent when scope: 'global')
│   ├── storage-state.json         ← always present, reflects the REAL current storage scope/projectId
│   └── feature_list.json
└── .claude/
    ├── agents/
    │   ├── lead.md
    │   ├── explorer.md
    │   ├── builder.md
    │   └── reviewer.md
    ├── mcp.json                   ← MCP server registration
    └── settings.json              ← sets `agent: "lead"` as the default session agent
```

**OpenCode** (`provider: 'opencode'`):

```
your-project/
├── agent-harness-kit.config.{json|ts|mjs|cjs}
├── AGENTS.md
├── health.sh
├── opencode.json                  ← MCP server + default_agent + compaction config
├── .harness/
└── .opencode/
    └── agents/
        ├── lead.md
        ├── explorer.md
        ├── builder.md
        └── reviewer.md
```

**Codex CLI** (`provider: 'codex-cli'`):

```
your-project/
├── agent-harness-kit.config.{json|ts|mjs|cjs}
├── AGENTS.md
├── health.sh
├── .harness/
└── .codex/
    ├── config.toml                ← MCP server registration
    └── agents/
        ├── lead.toml
        ├── explorer.toml
        ├── builder.toml
        ├── reviewer.toml
        └── default.toml           ← overrides Codex's built-in default agent → routes to lead
```

### What each file does

| File                          | Purpose                                                                               | Edit it?                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `agent-harness-kit.config.{json\|ts\|mjs\|cjs}` | Defines project metadata, provider, storage paths, MCP port. JSON when the package isn't installed locally, otherwise `.ts`/`.mjs`/`.cjs` | Yes — it's yours                                            |
| `AGENTS.md`                   | Navigation map agents read first. Regenerated by `ahk build`                          | No — changes will be overwritten                            |
| `health.sh`                   | Shell script agents run before starting work. Must exit 0                             | **Yes — implement your checks here**                        |
| `.harness/feature_list.json`  | Task backlog in JSON. Humans edit this, `ahk sync` loads it into SQLite               | Yes — add tasks here                                        |
| `.harness/harness.db`         | SQLite database (local scope only). Source of truth for tasks, actions, sections      | No — managed by the harness                                 |
| `.harness/current.md`         | Auto-generated session snapshot for agents without MCP access (local scope only)      | No — regenerated automatically                              |
| `.harness/storage-state.json` | Always project-local. Records the REAL current storage state (`scope`, `projectId`, `dbType`, `migratedAt`) — used by migration tooling | No — managed by the harness |
| `.claude/agents/*.md`         | Agent role definitions (Claude Code). Created once, never overwritten (`ahk build --force` regenerates)                 | **Yes — customize agent behavior**                          |
| `.claude/mcp.json`            | MCP server registration for Claude Code. Merged by `ahk build`                        | Yes, carefully — don't remove the `agent-harness-kit` entry |
| `.claude/settings.json`       | Sets `agent: "lead"` so lead runs as the default session agent. Merged by `ahk build` | Yes, carefully                                              |
| `.opencode/agents/*.md`       | Agent role definitions (OpenCode). Created once, never overwritten (`ahk build --force` regenerates)                    | **Yes — customize agent behavior**                          |
| `opencode.json`               | MCP server + `default_agent` + compaction config for OpenCode. Merged by `ahk build`  | Yes, carefully                                              |
| `.codex/agents/*.toml`        | Agent role definitions (Codex CLI). Created once, never overwritten (`ahk build --force` regenerates)                   | **Yes — customize agent behavior**                          |
| `.codex/config.toml`          | MCP server registration for Codex CLI. Merged by `ahk build`                          | Yes, carefully                                              |

---

## Tasks schema

The `tasks` table includes an `updated_at` timestamp column, set on creation and automatically updated on every status change. On first run after upgrading from an older version, existing rows are backfilled with `COALESCE(completed_at, started_at, created_at)`. Tasks returned by `tasks.get` are ordered by status priority (pending → in_progress → blocked → done) then by `updated_at` descending.

---

## What you can customize

### `agent-harness-kit.config.{json|ts|mjs|cjs}`

Everything in the config file is yours to change. The example below is the TypeScript form, generated when the package is installed locally in your project:

```ts
import type { HarnessConfig } from '@cardor/agent-harness-kit'

const config: HarnessConfig = {
  project: {
    name: 'My App',
    description: 'What this project does',
    docsPath: './docs', // where agents search for documentation
  },

  provider: 'claude-code', // 'claude-code' | 'opencode' | 'codex-cli'

  // There is no `agents` key. Per-agent settings live in the generated agent
  // file itself, which is yours to edit — see "Agent files are yours" below.

  // ── Database ──────────────────────────────────────────────────────────────
  // SQLite (default — zero native deps, Node 22+ or Bun). Note: `database`
  // never carries a file path — where the .db file physically lives is a
  // `storage` concern (see `storage.sqlitePath` below), not a `database` one.
  database: { type: 'sqlite' },

  // PostgreSQL — uncomment to use instead:
  // database: { type: 'postgres', connectionString: process.env.DATABASE_URL },

  // MySQL — uncomment to use instead:
  // database: { type: 'mysql', connectionString: process.env.DATABASE_URL },

  // ── Storage — scope: 'local' (default) ─────────────────────────────────────
  // DB and current.md live project-relative, in .harness/. `sqlitePath` and
  // `markdownFallback.path` are only valid (and only exist on the type) when
  // `scope: 'local'`.
  storage: {
    dir: '.harness',
    tasks: { adapter: 'local' }, // 'local' | 'jira' | 'linear' | 'mcp'
    sections: {
      toolsUsed: true, // log which tools agents used
      filesModified: true, // log which files were touched
      result: true, // log action results
      blockers: true, // log blockers agents hit
      nextSteps: false, // optional next steps field
    },
    markdownFallback: { enabled: true, path: '.harness/current.md' },
    scope: 'local',
    projectId: '5f2c...', // UUID, generated once at init, never regenerated
    // sqlitePath: '.harness/harness.db', // optional — defaults to '.harness/harness.db' when omitted
  },

  health: {
    scriptPath: './health.sh',
    required: true, // set to false to skip health checks
  },

  tools: {
    mcp: { enabled: true, port: 3742 },
    scripts: { enabled: true, outputDir: './.harness/scripts' },
  },
}

export default config
```

**The JSON form** (`agent-harness-kit.config.json`, generated when the package is *not* installed locally) holds exactly the same values, minus the comments and the type annotation:

```json
{
  "project": {
    "name": "My App",
    "description": "What this project does",
    "docsPath": "./docs"
  },
  "provider": "claude-code",
  "database": { "type": "sqlite" },
  "storage": {
    "dir": ".harness",
    "tasks": { "adapter": "local" },
    "sections": {
      "toolsUsed": true,
      "filesModified": true,
      "result": true,
      "blockers": true,
      "nextSteps": false
    },
    "markdownFallback": { "enabled": true, "path": ".harness/current.md" },
    "scope": "local",
    "projectId": "5f2c..."
  },
  "health": { "scriptPath": "./health.sh", "required": true },
  "tools": {
    "mcp": { "enabled": true, "port": 3742 },
    "scripts": { "enabled": true, "outputDir": "./.harness/scripts" }
  }
}
```

Every option documented below applies to both forms — the same keys, the same defaults, the same runtime normalization. The only difference is that the JSON form has no type checking or autocompletion behind it, since there is no package to resolve them from. To switch a JSON config to TypeScript, install the package locally (`npm install --save-dev @cardor/agent-harness-kit`) and rename the file to `agent-harness-kit.config.ts`, wrapping the object as shown above. `ahk` will not convert it for you — an existing config always keeps its format.

**`scope: 'global'`** — DB and current.md live under `~/.harness/dbs/<projectId>/`, outside the project tree. Under this scope, `sqlitePath` and `markdownFallback.path` don't exist on the type at all (a type error, not just a no-op) — there's nothing local to declare a path for:

```ts
storage: {
  dir: '.harness',
  tasks: { adapter: 'local' },
  sections: { toolsUsed: true, filesModified: true, result: true, blockers: true, nextSteps: false },
  markdownFallback: { enabled: true }, // no `path` — auto-managed under ~/.harness/dbs/<projectId>/
  scope: 'global',
  projectId: '5f2c...',
  // sqlitePath is NOT a valid field here — omit it entirely
},
```

> `StorageConfig` is a discriminated union on `scope` (`LocalStorageConfig | GlobalStorageConfig`, see `src/types.ts`) — this is what makes declaring `sqlitePath`/`markdownFallback.path` under `scope: 'global'` a compile-time error instead of a silently-ignored field. If you're loading a config file at runtime (via `loadConfig()`, which uses `jiti` and does not type-check), an existing `scope: 'global'` config that still has these fields set gets normalized automatically with a `console.warn` rather than crashing — see `applyDefaults()` in `src/core/config.ts`.

> `defineHarness()` is still exported for anyone who prefers the value-import form (`import { defineHarness } from '@cardor/agent-harness-kit'` + `export default defineHarness({ ... })`) — it's an identity function kept for backward compatibility, and `loadConfig()` supports both shapes.

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

### Agent definition files

**These files belong to you.** `ahk init` and `ahk build` both create them when missing and **never modify them once they exist**. Customise them freely: rewrite the role prompt, add a `model:` line, adjust the restriction fields. Nothing in the normal workflow will revert your edits, and `ahk doctor` never reports a hand-edited file as drift — it checks existence only.

The trade-off is that you do not automatically receive template improvements from new versions of this package. `ahk build --force` is the only way to pull them in, and it **discards your customisations** (writing a backup to `.harness/backups/agents-<timestamp>/` first). Keep customisations in source control so you can diff against a forced regeneration.

There is no `agents` key in `agent-harness-kit.config.ts`. Per-agent settings live here, in the file itself — set the model on the `model:` frontmatter line (`model = "..."` for Codex CLI) and write role instructions in the body. When no model line is present, the provider applies its own default.

Agent files do not declare a tool allowlist. Each agent inherits the full tool set of the session — including `Task` and every MCP tool — and the file declares only what the role is *not* allowed to do. Each provider expresses that restriction in its own syntax.

**Claude Code** (`.claude/agents/*.md`) uses a `disallowedTools` YAML block sequence:

```markdown
---
name: explorer
description: Explorer agent — reads and maps the codebase, never writes
disallowedTools:
  - Write
  - Edit
---

# Explorer Agent

You are the explorer agent for MyApp. Follow these rules:

- Map the modules relevant to the task and report where each concern lives
- Never modify files — record every file you read
- Prefer the existing patterns in `src/lib/` when describing conventions
```

**OpenCode** (`.opencode/agents/*.md`) uses a `permission` mapping instead. OpenCode has no separate `write` permission — its `edit` key is defined as "file modifications including write/patch", so a single `edit: deny` covers Write, Edit, and patch:

```markdown
---
name: explorer
description: Explorer agent — reads and maps the codebase, never writes
permission:
  edit: deny
---

# Explorer Agent

You are the explorer agent for MyApp. Follow these rules:

- Map the modules relevant to the task and report where each concern lives
- Never modify files — record every file you read
```

> The legacy OpenCode `tools: { write: false }` dict is deprecated upstream in favour of `permission` and is no longer emitted.

For the **builder**, which has no restrictions, the key is omitted entirely — no `disallowedTools` under Claude Code, no `permission` under OpenCode.

**Codex CLI** (`.codex/agents/*.toml`) uses TOML format:

```toml
name = "builder"
sandbox_mode = "workspace-write"

description = """
Builder agent — implements the plan produced by explorer and lead.
"""

developer_instructions = """
# Builder Agent

You are the builder agent for MyApp. Follow these rules:

- All API endpoints must be defined in `src/routes/`
- Never modify `src/core/` without lead approval
- Run `npm test` after every change and fix failures before completing
"""
```

Codex CLI has no per-agent tool denylist, so `sandbox_mode` is the only real mechanism: `"read-only"` for lead, explorer, consultant, and reviewer; `"workspace-write"` for builder. Because Codex keeps the write tools *visible* to the model even under a read-only sandbox, the restriction is additionally restated in prose inside `developer_instructions` — without it the model burns turns on calls the sandbox will reject.

The equivalent constraint under Claude Code is expressed as `disallowedTools: [Write, Edit]`, and under OpenCode as `permission: { edit: deny }`.

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

| Tool                      | Parameters                                      | Description                                                                                                                                                                         |
| ------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tasks.get`               | `status?`                                       | List tasks, optionally filtered by `pending \| in_progress \| done \| blocked`                                                                                                      |
| `tasks.claim`             | `id, agent`                                     | Atomically claim a pending task. Returns `task_already_claimed` if another agent got it first                                                                                       |
| `tasks.update`            | `id, status`                                    | Change task status                                                                                                                                                                  |
| `tasks.add`               | `title, slug?, description?, acceptance?`       | Create a new task directly from MCP (agents can queue work on the fly)                                                                                                              |
| `tasks.acceptance.update` | `criterionId`                                   | Mark an acceptance criterion as met. Criterion IDs come from `tasks.acceptance_get`                                                                                                 |
| `actions.start`           | `taskId, agent`                                 | Start a new action, returns `actionId`                                                                                                                                              |
| `actions.write`           | `actionId, sectionType, content`                | Record a text section: `result \| tools_used \| blockers \| next_steps`. Does **not** populate the Files dashboard — use `actions.record_file` for that                             |
| `actions.complete`        | `actionId, summary`                             | Close an action with a one-line summary                                                                                                                                             |
| `actions.get`             | `taskId`                                        | Full action history for a task (all agents, all sections)                                                                                                                           |
| `actions.record_file`     | `actionId, filePath, operation, notes?`         | Register a file touch. The **only** way to populate the Files dashboard. `operation`: `read \| created \| modified \| deleted`                                                      |
| `actions.record_tool`     | `actionId, toolName, argsJson?, resultSummary?` | Register a tool call. The **only** way to populate the Tools dashboard                                                                                                              |
| `docs.search`             | `query`                                         | Search the `docsPath` folder for content matching the query                                                                                                                         |
| `tasks.acceptance_get`    | `taskId`                                        | Returns all acceptance criteria for a task with their `id`, `task_id`, `criterion` text, and `met` status. Use the returned `id` values with `tasks.acceptance.update`              |
| `deps.snapshot`           | _(none)_                                        | Snapshot current `package.json` dependencies to `.harness/deps-lock.json`                                                                                                           |
| `deps.check`              | _(none)_                                        | Compare current `package.json` against `.harness/deps-lock.json`. Returns `{ significant, added, removed, majorBumps, advisory }`                                                   |
| `ahk.doctor`              | _(none)_                                        | Check lib version, agent file presence, and harness skills sync status. Returns `{ lib: { current, latest, outdated }, agents: { missing, ok }, skills: { missing, outdated, ok } }`. Agents are existence-checked only, so there is no `outdated` bucket for them; `skills` still has all three. The `lib` version lookup (npm registry check) is cached in-memory with a 5-minute TTL — repeated calls within that window do not hit the network again. |

---

## Agent roles

| Role           | Responsibility                                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **lead**       | Decomposes the task into a plan, assigns sub-agents. Does not write code or read source files.                                              |
| **explorer**   | Reads and maps the codebase. Never writes files. Records every file read.                                                                   |
| **consultant** | Provides structured technical advisory after explorer. Runs conditionally. Never writes code. Writes advisory to harness via actions.write. |
| **builder**    | Implements the plan. The only role that writes — its write tools are enabled where every other role's are disabled. Records every file modified. |
| **reviewer**   | Verifies all acceptance criteria are met. Approves or blocks. Runs health check before approving.                                           |

> **Scope note.** What a role may not do is enforced **per tool, not per path**. There is no per-agent path scoping and it is not configurable: the `allowedPaths` / `writablePaths` fields were removed because they were only interpolated into prompt text and no provider ever enforced them — they looked like a security control without being one. The real restriction lives in `src/core/materializer/agent-restrictions.ts`, which each provider translates natively: `disallowedTools` in Claude Code, `permission.edit` in OpenCode, `sandbox_mode` in Codex CLI. If a config still declares the removed fields they are stripped at load time with a warning.
>
> **The entire `agents` config key has since been removed too**, for the same underlying reason: everything left in it was either dead or better expressed elsewhere. `instructionsPath`, `context` and `custom` were written by the generator and never read by anything; `model` was the only field with an effect, and it now belongs in the agent file's frontmatter alongside the role prompt, since that file is user-owned. A config that still declares `agents` loads normally — the key is ignored, with one aggregated warning pointing at the agent file.
>
> **Breaking change for library consumers (compile time).** The `AgentConfig`, `AgentsConfig` and `CustomAgentConfig` types are no longer exported from the package, and `HarnessConfig` no longer has an `agents` property. If you import those types, remove the import; if you construct a `HarnessConfig` in TypeScript, drop the `agents` property. This is separate from the runtime tolerance above: existing config *files* keep loading, but code that references the removed types will not compile. The `AgentName` type is unrelated and unaffected.

### MCP tool permissions by role

> **Scope note.** This table describes the *intended* division of labour between roles, not a restriction enforced by the agent files. Agent definitions no longer declare a tool allowlist, so every role inherits **all** MCP tools. The per-role `MCP_CLAUDE_PERMISSIONS_*` arrays still exist, but they are only unioned together to populate the allow list in `.claude/settings.local.json` — they are not applied per agent. Treat the table as the convention each role's prompt asks it to follow.

| Tool                          | lead | explorer | consultant | builder | reviewer |
| ----------------------------- | :--: | :------: | :--------: | :-----: | :------: |
| `tasks.get`                   |  ✅  |    ✅    |     ✅     |   ✅    |    ✅    |
| `tasks.claim`                 |  ✅  |    ✅    |     ✅     |   ✅    |    ✅    |
| `tasks.add`                   |  ✅  |    ❌    |     ❌     |   ✅    |    ✅    |
| `tasks.update`                |  ✅  |    ❌    |     ❌     |   ✅    |    ✅    |
| `tasks.edit`                  |  ✅  |    ❌    |     ❌     |   ✅    |    ✅    |
| `tasks.archive` / `unarchive` |  ✅  |    ❌    |     ❌     |   ✅    |    ✅    |
| `tasks.acceptance_get`        |  ✅  |    ✅    |     ✅     |   ✅    |    ✅    |
| `tasks.acceptance.update`     |  ❌  |    ❌    |     ❌     |   ❌    |    ✅    |
| `actions.*` (all 6)           |  ✅  |    ✅    |     ✅     |   ✅    |    ✅    |
| `docs.search`                 |  ✅  |    ✅    |     ✅     |   ✅    |    ✅    |
| `permissions.check`           |  ✅  |    ✅    |     ❌     |   ✅    |    ✅    |
| `deps.snapshot`               |  ❌  |    ❌    |     ✅     |   ❌    |    ❌    |
| `deps.check`                  |  ❌  |    ❌    |     ✅     |   ❌    |    ❌    |
| `ahk.doctor`                  |  ✅  |    ✅    |     ✅     |   ✅    |    ✅    |

**explorer** is read-only for task state — can query but cannot mutate status or mark criteria.  
**reviewer** is the only role that can mark acceptance criteria as met (`tasks.acceptance.update`).  
**lead** and **builder** have identical access, both excluding `tasks.acceptance.update`.  
**consultant** is advisory-only — reads code, writes to harness, and can call deps tools. Never modifies the codebase.

`permissions.check` verifies only that a `.claude/agents/*.md` definition file **exists** for every role. Returns `{ in_sync: bool, agents: { lead, explorer, consultant, builder, reviewer } }` where each agent is `{ ok: true }` or `{ ok: false, reason: 'missing_file' }`. Agent file contents are never inspected — they are meant to be customised freely — so this never reports drift, only absence. Run `ahk build` to restore a missing file.

---

## What to commit

| File                          | Commit?             |
| ----------------------------- | ------------------- |
| `agent-harness-kit.config.{json\|ts\|mjs\|cjs}` | Yes                 |
| `AGENTS.md`                   | Yes                 |
| `CLAUDE.md`                   | Yes                 |
| `health.sh`                   | Yes                 |
| `.harness/feature_list.json`  | Yes                 |
| `.claude/agents/*.md`         | Yes                 |
| `.claude/mcp.json`            | Yes                 |
| `.claude/settings.json`       | Yes                 |
| `.opencode/agents/*.md`       | Yes                 |
| `opencode.json`               | Yes                 |
| `.codex/agents/*.toml`        | Yes                 |
| `.codex/config.toml`          | Yes                 |
| `.harness/harness.db`         | **No** (gitignored, local scope only) |
| `.harness/current.md`         | **No** (gitignored, local scope only) |
| `.harness/storage-state.json` | Yes (metadata, not gitignored — always present regardless of scope) |

The rule: commit inputs (config, task definitions, agent instructions). Ignore outputs (DB, auto-generated snapshots). `storage-state.json` is metadata about *where* those outputs live, not an output itself — it's committed so the harness can detect storage drift.

---

## Runtime compatibility

| Runtime          | SQLite                         | PostgreSQL                | MySQL                   |
| ---------------- | ------------------------------ | ------------------------- | ----------------------- |
| Node.js ≥ 22     | ✅ uses `better-sqlite3` package | ✅ via `postgres` package | ✅ via `mysql2` package |
| Bun (any recent) | ✅ uses `bun:sqlite` built-in    | ✅ via `postgres` package | ✅ via `mysql2` package |
| Node.js < 22     | ❌ blocked by `engines.node` (not by the SQLite driver) | ✅ | ✅ |

SQLite is included via the `better-sqlite3` dependency (installed automatically). For PostgreSQL install `postgres`, for MySQL install `mysql2`:

```bash
npm install postgres    # for PostgreSQL
npm install mysql2      # for MySQL
```

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
```

### Testing the local build in another project

Use the helper script to build the package and link it into any local project in one step:

```bash
# Build + link into a specific project
./scripts/link-local.sh /path/to/your-other-project

# Build + register globally only (then link manually wherever you need)
./scripts/link-local.sh
```

What the script does:

1. Runs `npm run build` (full build including dashboard assets)
2. Runs `npm link` to register the package globally on your machine
3. Runs `npm link @cardor/agent-harness-kit` inside the target project
4. Smoke-tests the `ahk` binary with `--version`

After linking, `npx ahk` inside the target project will use your local build. To unlink when you're done:

```bash
# Inside the target project
npm unlink @cardor/agent-harness-kit

# Optionally remove the global registration
npm uninstall -g @cardor/agent-harness-kit
```

> **Tip:** If you're iterating quickly, run `npm run build` in this repo after each change — the link picks up the new `dist/` immediately without re-running the script.

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

## Security Policy

See [SECURITY.md](./SECURITY.md) for the vulnerability reporting process, supported versions, and coordinated-disclosure policy.

---

## Roadmap

- ✅ **`ahk dashboard`** — local web UI with real-time WebSocket updates. Shows tasks, action timelines, file activity, tool usage, and per-agent breakdowns.
- ✅ **`ahk reset`** — interactively clear the SQLite DB, feature list, and agent files to start a project fresh.
- ✅ **PostgreSQL + MySQL drivers** — remote database support via `postgres` and `mysql2` packages. Configure with `database: { type: 'postgres', connectionString: '...' }`.
- ✅ **`actions.record_file` + `actions.record_tool`** — dedicated MCP tools for populating the Files and Tools dashboard views.
- ✅ **`tasks.add` via MCP** — agents can create new tasks on the fly without leaving the conversation.
- ✅ **Global installation** — `ahk init` can install the harness to your home directory, shared across projects.
- ✅ **Input validation** — all CLI prompts validate and retry on bad values.
- ✅ **Codex CLI provider** — full support for OpenAI Codex CLI. Generates `.codex/agents/*.toml` files with proper `sandbox_mode` per role and merges `.codex/config.toml` for MCP registration. Overrides the built-in `default` agent so the harness lead runs by default.
- **Graphify integration** — connect the harness to Graphify to visualize agent workflows, task dependencies, and action timelines as interactive graphs.
- **Open Telemetry integration** — emit OpenTelemetry spans for all agent actions, file operations, and tool calls.
- **Jira task adapter** — pull tasks directly from Jira instead of maintaining `feature_list.json` manually.
- **Linear task adapter** — same as Jira, for Linear.
- **GitHub Issues adapter** — same, for GitHub Issues.
- **Remote MCP adapter** — connect to a hosted MCP server instead of a local SQLite file. Enables shared task state across machines and team members without syncing a DB file.
