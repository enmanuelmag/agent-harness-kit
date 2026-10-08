# Health gating with audited repair mode

## Goal

Remove the agent's responsibility to remember the initial and final health
checks, while preserving a safe path for tasks whose purpose is to repair a
red health result.

## Decisions

- `tasks.claim` atomically claims the task, then runs the native health check
  through the existing server-owned health runner. Its response includes the
  claim, the health result, and the resulting execution mode.
- A failed claim does not relinquish ownership. It enters a restricted mode so
  another agent cannot claim the task while the original agent diagnoses it.
- `tasks.update(done)` runs health itself. It completes only after that fresh
  same-task run passes; an existing pass never substitutes for it.
- Execution mode is independent from backlog status. The modes are
  `checking`, `normal`, `blocked`, `repair`, and `verifying`.
- `normal` permits ordinary implementation. `blocked` still permits reads,
  diagnostic actions, health reruns, action records, and handoffs. It does not
  permit ordinary builder implementation.
- `tasks.repair.begin` is an explicit server-recorded transition. It requires
  a failed server-owned health run plus a reason and a bounded repair scope.
  It never authorizes completion with failing health.
- `actions.start` authorizes work from the task mode and agent role but does
  not rerun the suite for every agent action. Repeated suite execution would
  make exploration and consultation needlessly expensive and can block the
  diagnosis required to repair the failure.
- The enforcement point is a shared policy used by MCP, CLI, and dashboard
  task mutation paths. Provider permissions and prompt text are supplemental,
  not the security boundary.

## Data and audit model

Persist task execution mode and a repair-session record containing the task,
the failed health-run ID, reason, scope, actor, creation/exit timestamps, and
the final health-run ID. Health evidence remains server-owned and scoped to
the active claim. A claim generation is checked when changing modes or
closing, so evidence from an earlier claim cannot authorize a later one.

## Flow

1. Claim → `checking` → run health.
2. Pass → `normal`; fail → `blocked` with diagnostic operations available.
3. A repair that is needed enters `repair` through the audited API.
4. The agent repairs and reruns health as needed.
5. Done request → `verifying` → fresh health. Pass closes the task; fail
   restores `blocked` (or `repair` when its active repair session remains).

## Error handling and concurrency

No database transaction remains open while the health script runs. The server
reserves the transition, runs health, then conditionally persists the result
only if the task claim/mode generation still matches. Existing run-token
invalidation remains in use for overlapping health runs. Failed final health
must leave task and action state open and return the structured result.

## Test coverage

Tests cover passing and failing automatic claims, allowed diagnostics while
blocked, refusal of normal builder work while blocked, repair entry rejection
without failed evidence, audited repair entry, final health execution at
completion, final failure preserving the task, stale/previous-claim evidence,
and concurrent claim/health transitions.

## Boundary

This policy protects harness-controlled MCP, CLI, and dashboard operations.
It cannot prevent direct filesystem writes through `exec`, an editor, or an
unrelated MCP. Blocking those paths requires provider-level tool mediation or
workspace isolation and is intentionally outside this change.
