# AGENTS.md — @cardor/agent-harness-kit

> **Read this file first.** It is the navigation map for every AI agent working in this repository.

## Project

**@cardor/agent-harness-kit** — A CLI tool to manage agnets

## Health check (run before making codebase changes)

```bash
bash health.sh
```

If it exits non-zero, stop and report the issue. Do not proceed with codebase changes until health is green.

## Harness data (source of truth)

| File | Purpose |
|------|---------|
| `.harness/harness.db` | SQLite: all tasks, actions, file changes, tool calls |
| `.harness/current.md` | Markdown fallback — read this if MCP server is unavailable |
| `.harness/feature_list.json` | Human-editable task seed list |

## MCP tools (preferred)

The harness exposes tools via MCP server on port 3742. Use these instead of reading files directly.

```
actions.start        taskId agent                           → start an action, returns a numeric actionId
actions.write        actionId section text                  → record a section (result, blockers, ...)
actions.record_tool  actionId calls[]                        → batch-log tool calls to the Tools dashboard (array, min 1)
actions.record_file  actionId files[]                        → batch-log file touches to the Files dashboard (array, min 1)
actions.complete     actionId summary                       → close the action
actions.get          taskId                                 → full action history for a task
tasks.add            title [slug] [description] [acceptance] → create a new task from natural language
tasks.get            [status]                               → list tasks (pending | in_progress | done | blocked)
tasks.claim          id                                     → atomically claim a pending task
tasks.update         id status                              → change task status
tasks.acceptance.update criterionId                        → mark an acceptance criterion as met
docs.search          query                                  → search ./docs for relevant content
```

## Workflow

```
1. INIT
   - Assess user intent: only run health.sh if changes are needed
   - tasks.get('in_progress') → resume if something is in progress
   - tasks.get('pending') → pick lowest id

2. WORK  (lead → explorer → consultant → builder → reviewer)
   - Each agent calls actions.start(taskId, agentName) → numeric actionId
   - Accumulate tool calls / file touches as you work; flush periodically (every few calls or at a phase boundary) via actions.record_tool(actionId, calls: [...]) and actions.record_file(actionId, files: [...]) — both are batch-only, even a single entry goes through as a one-element array
   - Closes with actions.complete(actionId, summary)

3. CLOSE
   - tasks.update(taskId, 'done')
   - Run health.sh (if changes were made) → must be green before closing
```

## Agent roles

| Agent | Responsibility |
|-------|---------------|
| lead | Decomposes the task into a plan, assigns sub-agents |
| explorer | Reads and maps relevant code, never writes |
| consultant | Technical advisor, runs after explorer, before builder. Never writes code. |
| builder | Implements the plan, writes files |
| reviewer | Verifies acceptance criteria, approves or blocks |

## What to read

```
Always:         .harness/current.md (or MCP tasks.get)
If implementing: ./docs/
If orchestrating: Agent definition files in your provider's agents directory
```

<!-- ahk:generated d18f0349742d6a2c30f342991cad0365afcf0aa1f13efa067b234ffd1b2c136e -->
