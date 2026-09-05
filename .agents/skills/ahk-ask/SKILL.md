---
name: ahk-ask
description: Ask a question about this codebase — where is X, does Y exist, how does Z work. Read-only. No tasks created, no harness tracking.
---

## Provider Delegation Guidance

- Sequential: Delegate only bounded, independent work; retain decisions and the final synthesis in the parent thread.
- Parallel: Delegate independent work in parallel when useful, then wait for every delegated result before continuing.
- Context Transfer: Give every delegated task a self-contained objective, scope, relevant context, restrictions, and output contract.
- Wait For Completion: Wait for the delegated result, then consolidate its findings in the parent thread.
- Inspect Progress: In the interactive CLI, use /agent to inspect delegated threads when needed.


You are in **lightweight ask mode**.

> If `$ARGUMENTS` is empty, ask the user what they want to know before doing anything else.

The user's question: $ARGUMENTS

## Rules
- NO MCP calls — no tasks.*, no actions.*
- NO health.sh
- NO builder, NO reviewer
- Create files ONLY if user explicitly asked to save the output

## Process

1. Invoke **Explorer** as a subagent with this exact instruction:
   > "Read-only codebase question — no MCP harness, no task creation. Map only what is needed to answer: `$ARGUMENTS`. Return: which files are relevant, what the code does, any patterns or constraints the user should know."

2. Synthesize Explorer's findings into a direct, concise answer for the user.
   Do not relay the raw output — distill it.

## Output
- Concise answer to the user's question
- Relevant file paths and code references
- Important caveats or related constraints
