# Provider delegation guidance plan

## Objective

Keep one behavioral contract for the five Harness roles while translating the mechanics of agent delegation for Claude Code, OpenCode, Codex CLI, and Grok Build.

The implementation must preserve one canonical role body. Provider materializers may add native metadata, permissions, default-agent configuration, and a short delegation guide. They must not maintain separate copies of the complete prompts.

## Current problems

The current architecture already separates shared role templates from provider-native output, but the generated instructions have drifted:

- `agentsMd()` and `claudeMd()` duplicate most of their contents and already differ in behavior.
- Some lead and builder descriptions omit the consultant even though the workflow has five roles.
- The consultant's provider list omits Grok Build.
- The generated tool inventory does not describe the current compact action reads and recipient-directed handoffs.
- Some instructions use stale tool names such as `tasks.acceptance_update` instead of `tasks.acceptance.update`.
- Explorer requires an audit of read files without instructing agents to record file reads.
- The generated index says to prefer MCP over direct file reads too broadly. MCP should replace direct reads of Harness state, not source-code inspection.
- Lightweight skills bypass Harness tracking, but the top-level workflow does not state that exception clearly.
- Claude's preapproved MCP list does not cover every compact-read and handoff tool used by current prompts.
- Some documentation and tests still describe four roles or omit Grok.

## Architecture

### Canonical layer

Keep one source template per role under `src/core/materializer/agent-templates/`.

The shared body owns:

- role responsibility;
- workflow order;
- Harness state and handoff contracts;
- read/write boundaries;
- required inputs and outputs;
- completion and blocking conditions;
- rules for sequential and parallel work.

Shared instructions must describe delegation semantically. They may say "delegate to the explorer subagent" but must not depend on internal tool names such as `Agent`, `Task`, or `spawn_agent`.

### Provider adapter layer

Add a small centralized provider registry. A possible shape is:

```ts
type DelegationAudience = 'lead' | 'coordination-skill'

type ProviderDelegationGuidance = {
  invoke: readonly string[]
  sequential: string
  parallel: string
  contextTransfer: string
  waitForCompletion: string
  inspectProgress?: string
}

const PROVIDER_DELEGATION_GUIDANCE = {
  'claude-code': { /* natural-language name and @mention guidance */ },
  opencode: { /* @mention and fresh-child-context guidance */ },
  'codex-cli': { /* explicit spawn/delegate/wait/summarize guidance */ },
  'grok-cli': { /* explicit project subagent and /tasks guidance */ },
} satisfies Record<Provider, ProviderDelegationGuidance>
```

Expose it through one renderer:

```ts
renderDelegationGuidance(provider, audience)
```

Do not interpolate free-form provider guidance in multiple materializers. The registry must remain the only source for this text.

### Injection points

Inject provider delegation guidance into:

- the generated lead/default-agent instructions;
- coordination skills that directly launch subagents: `ahk-ask`, `ahk-consultant`, `ahk-triage`, `ahk-review`, and `ahk-test`.

Do not inject it into explorer, consultant, builder, or reviewer unless that role is explicitly allowed to coordinate child agents.

Keep `AGENTS.md` provider-neutral. It may explain that the active materializer supplies invocation guidance, but it must not list provider-specific internal tools.

### Index files

Generate `AGENTS.md` from one canonical index template.

For Claude Code, make `CLAUDE.md` a small overlay that points to `AGENTS.md` and contains only Claude-specific behavior. Do not maintain a second full copy of the workflow.

The generated index must distinguish:

- Harness-state navigation through MCP;
- normal source-code reads through provider file tools;
- tracked Harness work;
- lightweight skill workflows that do not create tasks or actions.

## Provider behavior to encode

### Claude Code

- Natural-language naming asks Claude to select a subagent.
- `@<agent>` is the explicit one-task selection mechanism.
- Keep native frontmatter, model selection, deny lists, and default lead configuration in the Claude materializer.

### OpenCode

- Document `@<agent>` as the explicit selection mechanism.
- State that child sessions need a self-contained objective, scope, known context, restrictions, and output contract.
- Set native agent modes deliberately if upstream behavior and tests confirm the desired `primary` and `subagent` distinction.

### Codex CLI

- Use direct language such as spawn, delegate, parallel, wait, and summarize.
- Keep the default lead shim and TOML conversion in the Codex materializer.
- State that current read-only role restrictions are prompt-level because the project config uses `danger-full-access`.

### Grok Build

- Refer to project-defined subagents by role.
- Include `/tasks` only as a progress-inspection hint.
- Do not claim automatic lead selection until the materializer configures it and runtime verification proves it.

## Implementation phases

### Phase 1: Repair the shared contract

1. Correct all current MCP names and required arguments.
2. Add compact reads, sections, and handoff tools to the workflow inventory.
3. Align lead, consultant, builder, and reviewer text with the five-role pipeline.
4. Add Grok where provider support is enumerated.
5. Correct file-read audit instructions.
6. Clarify the tracked-work and lightweight-workflow boundary.
7. Update Claude MCP preapprovals for every workflow-critical tool.

### Phase 2: Remove index duplication

1. Extract a common `AGENTS.md` body.
2. Replace the duplicated `CLAUDE.md` body with a Claude overlay.
3. Preserve provenance markers and the existing ownership contract.

### Phase 3: Add delegation adapters

1. Add the typed provider guidance registry.
2. Add the renderer with the two supported audiences.
3. Inject one bounded block into lead/default-agent output.
4. Render provider-aware coordination skills without duplicating their semantic bodies.

### Phase 4: Documentation and adoption

1. Update README provider trees and the five-role workflow.
2. Update secondary docs that still describe four roles.
3. Explain how existing user-owned agent files receive new templates.
4. Add safe drift visibility without overwriting user edits.

## Existing installations

Agent files are user-owned. A normal build creates missing files but preserves existing content. The implementation must not silently overwrite them.

Add an adoption path that:

- associates generated agent files with a template version;
- reports older templates through doctor or build output;
- offers a preview or diff;
- keeps updates explicit;
- creates a backup before replacement;
- uses the same renderer for `init`, `build --force`, and provider migration.

Managed skills and derived index files follow their existing reconciliation policies. Document those policies separately from user-owned agent files.

## Tests

Add tests that prove:

- all four providers produce all five roles;
- all roles share the same semantic body after removing native wrappers and the delegation adapter;
- provider-specific internal tool names never leak into the shared body;
- each provider receives exactly one expected delegation block;
- `AGENTS.md` and the semantic portion of `CLAUDE.md` cannot drift;
- every workflow-critical MCP tool name matches the server schema;
- Claude preapprovals include the current compact-read and handoff tools;
- Grok participates in derived-file ownership tests;
- `init`, `build --force`, and migration render equivalent agent definitions;
- user-owned files remain untouched without an explicit destructive update.

## Acceptance criteria

- One canonical semantic template exists for each role.
- One centralized provider delegation registry exists.
- Provider materializers inject only native configuration and the bounded adapter.
- The five-role sequence is consistent across templates and docs.
- Generated indexes describe the current MCP contract accurately.
- `CLAUDE.md` no longer duplicates the complete generic index.
- Existing customized agents are not overwritten silently.
- Tests cover every provider, role, adapter, ownership path, and generation entry point.
- README and `docs/` explain the provider-neutral contract and provider-specific invocation hints.
- The full health check exits successfully.

## Out of scope

- Replacing the Harness workflow.
- Adding new providers.
- Building a general-purpose prompt framework.
- Enforcing per-path permissions that providers do not support.
- Changing model catalogs except where a verified provider contract requires it.

## Kickoff prompt

```text
Implement the plan in docs/provider-delegation-guidance-plan.md.

Start by reading AGENTS.md and the plan. Run bash health.sh before making changes and stop if it fails. Use the Harness workflow and its canonical lead -> explorer -> consultant -> builder -> reviewer sequence. Do not create parallel write scopes; the stages depend on one another.

First repair the shared role and MCP contract. Then remove AGENTS.md/CLAUDE.md duplication. After that, add one centralized provider delegation registry and inject its bounded output only into the lead/default agent and coordination skills. Keep the semantic role bodies provider-neutral and do not place Agent, Task, spawn_agent, or other provider-internal tool names in shared instructions.

Preserve user-owned agent files. Do not overwrite customized agents silently. Cover Claude Code, OpenCode, Codex CLI, and Grok Build across init, build --force, and provider migration. Add the parity, adapter, ownership, MCP-name, and documentation tests required by the plan.

Do not commit. Finish by running focused tests, bash health.sh, and git diff --check. Report changed files, verification with exit codes, migration behavior, remaining risks, and whether README or docs required updates.
```
