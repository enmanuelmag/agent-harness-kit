# AGENTS.md — @cardor/agent-harness-kit

**Read this file first.** It is the navigation map for every AI agent working in this repository.

## Project

**@cardor/agent-harness-kit** — A CLI and MCP tools for LLM providers

## Health check (run before making codebase changes)

```
health.run(taskId)
```

If it is not passed, stop and report the issue. Do not proceed with codebase changes until health is green. Use `health.run(taskId)` through MCP before work and immediately before `tasks.update(taskId, 'done')`; it stores the only evidence accepted for completion. `ahk health` remains available for manual, stateless checks. On a first scaffold, the marked placeholder/dummy check is an exception only for exploration and narrowly-scoped creation or adaptation of the native health script; it never proves health and cannot close a task. If only the opposite-platform script exists, have the builder adapt its checks to the native file instead of blindly translating it. Keep the compact log wrapper: 10 lines on success, 100 on failure.

## Harness data (source of truth)

| File | Purpose |
|------|---------|
| `.harness/harness.db` | SQLite: tasks, actions, and action sections |

## MCP tools (preferred)

The harness exposes tools via MCP server on port 3742. Use these instead of reading files directly.

```
actions.start        taskId agent                           → start an action, returns a numeric actionId
actions.write        actionId section text                  → record a section (result, blockers, ...)
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
health.run           taskId                                 → run and persist task health evidence
tasks.update         id status                              → change task status; done requires fresh health.run
tasks.acceptance.update criterionId                        → mark an acceptance criterion as met
docs.search          query                                  → search ./docs for relevant content
```

## Workflow

```
1. INIT
   - Assess user intent: for changes, select a task and call health.run(taskId) before work
   - tasks.get('in_progress') → resume if something is in progress
   - tasks.get('pending') → pick lowest id

2. WORK  (lead → explorer → consultant → builder → reviewer)
     - Each agent calls actions.start(taskId, agentName) → numeric actionId
     - Closes with actions.complete(actionId, summary)

3. CLOSE
     - health.run(taskId) → must pass immediately before closing
     - tasks.update(taskId, 'done')
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
Always:         MCP tasks.get. If MCP is unavailable, stop and ask the user to restore the MCP connection.
If implementing: ./docs/
If orchestrating: Agent definition files in your provider's agents directory
```

<!-- ahk:generated 1021f6844a5a8776032a744688422e2be45e22a4cb17c0d58f6c8bf2fc510502 -->
