# AGENTS.md — @cardor/agent-harness-kit

**Read this file first.** It is the navigation map for every AI agent working in this repository.

## Project

**@cardor/agent-harness-kit** — A CLI and MCP tools for LLM providers

## Health check and repair mode

`tasks.claim` runs native health automatically and returns the health result and execution mode. A green result enters `normal`; a failed result enters `blocked`, where diagnostic actions remain available but builder/custom implementation is denied. If the change itself repairs the failure, call `tasks.repair.begin(taskId, actor, reason, scope)` with a bounded audit trail before implementation. `tasks.update(taskId, 'done')` runs final health automatically and closes only on a fresh pass. `health.run(taskId)` remains available for diagnostic reruns; `ahk health` is manual and stateless.

## Harness data (source of truth)

| File | Purpose |
|------|---------|
| `.harness/harness.db` | SQLite: tasks, actions, and action sections |

## MCP tools (preferred)

The harness exposes tools via MCP server on port 3742. Use these instead of reading files directly.

Lifecycle responses may include an additive operational-notices block. Briefly relay relevant actionable notices to the developer; a suggested command is information, not authorization to run it.

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
tasks.claim          id                                     → claim and run health automatically
tasks.repair.begin   taskId actor reason scope              → audited repair after failed health
health.run           taskId                                 → diagnostic server-owned health rerun
tasks.update         id status                              → done runs final health automatically
tasks.acceptance.update criterionId                        → mark an acceptance criterion as met
docs.search          query                                  → search ./docs for relevant content
```

## Workflow

```
1. INIT
   - Assess user intent: for changes, select a task and call tasks.claim(id); inspect its execution mode
   - tasks.get('in_progress') → resume if something is in progress
   - tasks.get('pending') → pick lowest id

2. WORK  (lead → explorer → consultant → builder → reviewer)
     - Each agent calls actions.start(taskId, agentName) → numeric actionId
     - Closes with actions.complete(actionId, summary)

3. CLOSE
     - tasks.update(taskId, 'done') → runs and records final health automatically
```

## Agent roles

| Agent | Responsibility |
|-------|---------------|
| lead | Decomposes the task into a plan, assigns sub-agents |
| explorer | Reads and maps relevant code, never writes |
| consultant | Technical advisor, runs after explorer, before builder. Never writes code. |
| builder | Implements the plan, writes files |
| reviewer | Verifies acceptance criteria, approves or blocks |

## Code quality guidance

For implementation tasks, the lead asks the builder and reviewer to check whether the `engineering-code-review` skill is available. When available, read and apply it in the role's scope, following the project's instructions and conventions. If unavailable, recommend the skill name and its source once per task without blocking work or installing it automatically: https://github.com/agentara/skills/tree/main/skills/engineering/engineering-code-review.

The builder evaluates the changed code for clear names, understandable conditions and flow, unnecessary nesting, mixed responsibilities, speculative abstractions, duplicated rules, and hidden effects. Make only in-scope improvements that preserve behavior; no change is required when the code is already clear. The reviewer checks concrete findings against requirements and evidence, and does not block solely on personal style preferences.

## What to read

```
Always:         MCP tasks.get. If MCP is unavailable, stop and ask the user to restore the MCP connection.
If implementing: ./docs/
If orchestrating: Agent definition files in your provider's agents directory
```

<!-- ahk:generated 217c67953733f29220fc7ea84e73b5b6a076ca4c22233f36293496dec5a576ca -->
