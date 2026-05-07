# AGENTS.md — agnet-harness-kit

> **Read this file first.** It is the navigation map for every AI agent working in this repository.

## Project

**agnet-harness-kit** — CLI Tool to setup agnet harness scaffolding

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
actions.start        taskId agent                           → start an action, returns actionId
actions.write        actionId section text                  → record a section (result, blockers, ...)
actions.record_tool  actionId toolName [argsJson] [summary] → log a tool call to the Tools dashboard
actions.record_file  actionId filePath operation [notes]   → log a file touch to the Files dashboard
actions.complete     actionId summary                       → close the action
actions.get          taskId                                 → full action history for a task
tasks.get            [status]                               → list tasks (pending | in_progress | done | blocked)
tasks.claim          id                                     → atomically claim a pending task
tasks.update         id status                              → change task status
tasks.acceptance.update criterionId                        → mark an acceptance criterion as met
docs.search          query                                  → search ./docs for relevant content
```

## Workflow

```
1. INIT
   - Run health.sh → exit 1 means stop
   - tasks.get('in_progress') → resume if something is in progress
   - tasks.get('pending') → pick lowest id

2. WORK  (lead → explorer → builder → reviewer)
   - Each agent calls actions.start(taskId, agentName) → actionId
   - After EVERY tool call: actions.record_tool(actionId, toolName, args, summary)
   - After EVERY file change: actions.record_file(actionId, filePath, operation, notes)
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
