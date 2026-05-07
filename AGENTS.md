# AGENTS.md — agent-harness-kit

> **Read this file first.** It is the navigation map for every AI agent working in this repository.

## Project

**agent-harness-kit** — A CLI tool to setup agent harness scafollding

## Health check (run before starting)

```bash
bash health.sh
```

If it exits non-zero, stop and report the issue. Do not proceed with tasks until health is green.

## Harness data (source of truth)

| File | Purpose |
|------|---------|
| `.harness/harness.db` | SQLite: all tasks, actions, file changes, tool calls |
| `.harness/current.md` | Markdown fallback — read this if MCP server is unavailable |
| `.harness/feature_list.json` | Human-editable task seed list |

## MCP tools (preferred)

The harness exposes tools via MCP server on port 3742. Use these instead of reading files directly.

```
actions.start        taskId agent            → start an action, returns actionId
actions.write        actionId section text   → record a section (result, tools_used, ...)
actions.complete     actionId summary        → close the action
actions.get          taskId                  → full action history for a task
actions.record_tool  actionId toolName       → record a tool call (populates Tools dashboard)
actions.record_file  actionId filePath op    → record a file touched (populates Files dashboard)
tasks.get            [status]               → list tasks (pending | in_progress | done | blocked)
tasks.claim          id                     → atomically claim a pending task
tasks.update         id status              → change task status
docs.search          query                  → search ./docs for relevant content
```

> **Important:** `actions.record_tool` and `actions.record_file` are the **only** ways to populate
> the Tools and Files dashboards. Call `record_tool` for every significant tool invocation and
> `record_file` for every file you read, create, modify, or delete.

## Workflow

```
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
```

## Agent roles

| Agent | Responsibility |
|-------|---------------|
| lead | Decomposes the task into a plan, assigns sub-agents |
| explorer | Reads and maps relevant code, never writes |
| builder | Implements the plan, writes files |
| reviewer | Verifies acceptance criteria, approves or blocks |

## What to read

```
Always:         .harness/current.md (or MCP tasks.get)
If implementing: ./docs/
If orchestrating: Agent definition files in your provider's agents directory
```
