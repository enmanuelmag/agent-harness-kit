# AGENTS.md — @cardor/agent-harness-kit

> **Read this file first.** It is the navigation map for every AI agent working in this repository.

## Project

**@cardor/agent-harness-kit** — A CLI and MCP tools for LLM providers

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

## Documentation Research Policy

### Terminology

- **Context7**: version-aware documentation retrieval for libraries and frameworks. Resolve a library ID first, then query one concept at a time.
- **Mintlify Index**: technical search across publisher-maintained Mintlify documentation with web fallback. This is the correct product name.
- **Web search**: broader current research for release notes, provider behavior, standards, cloud services, and information outside indexed documentation.
- **Graphify**: local codebase and project-structure understanding. It does not replace current dependency documentation.
- **Autoskills**: discovery of missing reusable agent skills. It does not prove library APIs or version compatibility.

Context7, Mintlify Index, and web search provide external evidence. Package manifests, lockfiles, generated clients, source imports, and configuration provide local version and usage evidence. Plans need both when the request depends on installed software.

### Trigger Policy

Lead must initiate current-documentation research when any of these conditions applies:

- the user asks to research, search, verify, compare, or find current information;
- the task concerns a library, framework, SDK, API, CLI, cloud service, LLM provider, or model capability;
- a proposed plan depends on behavior that may differ by version;
- the task spans a whole codebase and requires external technical context;
- the plan may require installing, removing, or upgrading dependencies.

Lead should delegate bounded research when the work can run independently. The delegated prompt must specify sources, installed versions, scope, expected citations, and the dependency-impact conclusion.

Lead must not invoke external research for isolated business-logic debugging, mechanical refactors, or questions answered completely by current project code and tests.

### Source Order

Use this order for dependency-bound technical questions:

1. Current project evidence: manifest, lockfile, generated contracts, imports, configuration, and tests.
2. Context7 with the exact library and relevant version when available.
3. Mintlify Index for publisher-maintained technical documentation and cross-product retrieval.
4. Official documentation, repositories, specifications, and release notes through web search.
5. Secondary sources only when primary sources do not answer the question. Label them as secondary.

For non-library current research, start with official web sources. Context7 should not be forced onto topics it does not cover.

### Required Dependency-Impact Conclusion

Every affected consultant report, plan, or implementation handoff must include:

```text
Dependency impact
- Installed version(s): ...
- Required capability: ...
- Compatibility: supported | unsupported | uncertain
- Upgrade required: yes | no
- New dependency required: yes | no
- Proposed version or package: ... | none
- Evidence: local files plus documentation sources
```

If evidence is unavailable, use `uncertain`. Do not convert uncertainty into an upgrade recommendation.

When an upgrade is required, the report must include:

- minimum compatible version;
- relevant breaking changes;
- affected project consumers;
- migration work;
- verification needed;
- whether the upgrade belongs in the current task or a separate task.

When no upgrade is required, say so directly and cite the installed-version evidence.

### Agent Responsibilities Summary

- **Lead**: Detect research triggers. Decide which questions can be researched in parallel. Require official or version-aware sources. Pass research evidence into consultant and builder handoffs. Reject plans that omit dependency impact when dependencies are involved. Keep research bounded to the task.
- **Explorer**: Identify manifests, lockfiles, generated clients, imports, configuration, and existing patterns. Report exact local versions and relevant file references. Separate local proof from external documentation. Do not choose upgrades unless the delegated task requests compatibility analysis.
- **Consultant**: Use Context7 as the primary documentation source for dependency-bound advice. Use Mintlify Index or web search to close coverage gaps and verify current provider behavior. Align recommendations with installed versions. Identify upgrade and new-dependency requirements. Distinguish confirmed behavior, inference, and uncertainty. Provide the builder with source-backed constraints rather than generic best practices.
- **Builder**: Implement only the dependency decision approved in the plan or handoff. Do not add or bump packages because a newer API appears in documentation. Record manifest and lockfile changes explicitly. Run version-appropriate verification.
- **Reviewer**: Check that dependency-related claims have local and external evidence. Block code that uses APIs unavailable in the installed version. Verify declared upgrades, lockfile changes, migrations, and documentation. Require the dependency-impact conclusion when the task touches external packages.

### Tool Availability and Fallback

Instructions must describe capabilities, then use the available provider-native tool names.

- If Context7 is available, resolve the library ID before querying docs.
- If the user supplies an exact Context7 ID, query it directly.
- If Context7 cannot resolve the library or lacks the needed version, record that limitation and continue with Mintlify Index or official web sources.
- If Mintlify Index is unavailable, use official web documentation.
- If web access is unavailable, report the proof boundary and do not describe remembered behavior as current.
- Never invent a tool call, source result, installed version, or compatibility conclusion.

The generated instructions should not assume every provider exposes identical MCP names. Provider materializers may inject the available tool aliases, but the research contract stays common.

### Context and Cost Control

External research must remain scoped:

- resolve one library once per task;
- query one concept per documentation request;
- avoid loading full documentation sites when focused pages answer the question;
- send summaries and source links through handoffs instead of raw outputs;
- parallelize independent documentation questions, not dependent planning stages;
- reuse verified version evidence within the same task;
- prefer local generated contracts over broad upstream examples when the project already has authoritative declarations.

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

<!-- ahk:generated 34e3acc1bf60927852da25e19947512ee1638f071034fdd366b09410bd0409fe -->
