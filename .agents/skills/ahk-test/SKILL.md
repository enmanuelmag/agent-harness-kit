---
name: ahk-test
description: Design, write, and run behavior-focused tests for an objective or existing code. Writes test files only and reports evidence. No tasks created, no harness tracking.
---

You are in **lightweight test mode**. The testing objective: $ARGUMENTS

> If `$ARGUMENTS` is empty, ask the user what behavior they want tested before doing anything else.

## Rules
- NO MCP calls — no tasks.*, no actions.*, no tasks.acceptance.update
- NO harness task creation or state changes
- Production files are READ-ONLY unless the user explicitly authorizes production changes
- Do not install dependencies or change test configuration without explicit authorization
- Run health.sh only when the user requests full harness verification or it is the repository's relevant test entrypoint; never use it instead of the focused test
- Do not delete, weaken, skip, or rewrite existing expectations to make the suite pass
- Do not add `.only`, `.skip`, `.todo`, or snapshots by default
- A test file is not evidence until its command has run

## Process

1. Invoke **Explorer** as a subagent with this instruction:
   > "Read-only test investigation — no MCP harness and no task creation. Testing objective: `$ARGUMENTS`. Read the complete unit under test, its relevant types and imports, the project's test scripts/configuration, and one or two nearby tests. Identify: observable behaviors, the source of each expected result, project conventions, likely test level, files a test would touch, and genuine ambiguities. Do not write files."

2. Build a concise test matrix with these columns:
   - Behavior
   - Input or action
   - Expected observable result
   - Test level
   - Source of expectation

3. Stop and ask the user before any write when the expected behavior is missing, contradictory, or would require a production or dependency change that was not authorized. Do not invent an oracle from the current implementation.

4. If the matrix is unambiguous, invoke **Builder** in direct test mode:
> "Direct test implementation — no MCP harness and no task creation. Implement only the resolved test matrix. Follow the repository's existing runner, naming, and assertion style. Place every test file and every test-only fixture, builder, factory, mock, stub, snapshot, or helper inside the `__tests__/` directory of the area under test. You may create or modify only the paths listed in the resolved scope. Do not edit production, dependencies, configuration, or unrelated tests. Prefer observable behavior over implementation details, real deterministic code over mocks, and one behavior per test. Return files changed and the focused command to run."

5. Invoke **Reviewer** in direct verification mode:
    > "Direct test verification — no MCP harness, no task state changes, and no file edits. Review the new tests against the objective and matrix. Run the narrowest focused test command first, then the relevant existing suite or static check when proportional. Report every command with exit status, failures, and what the evidence does not prove."

6. Synthesize the required output. Do not hide a failing test or convert it into a passing claim.

## Required output format

---

**Test matrix**
Behavior, input/action, expected result, level, and source.

**Files changed**
Test files created or modified. State explicitly when no files were written.

**Verification**
Commands run, exit status, and relevant result.

**Evidence boundary**
What these tests prove and what still requires typecheck, build, browser, network, deployment, or manual verification.

**Blocked or next step**
Omit when nothing remains. If production appears wrong, describe the separate change needed without making it.

---
