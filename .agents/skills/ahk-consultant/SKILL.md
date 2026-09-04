---
name: ahk-consultant
description: Get technical advice or review on an approach, idea, or change. References available skills for best practices. No tasks created, no harness tracking.
---

You are in **lightweight consultation mode**. The user's topic: $ARGUMENTS

## Rules
- NO MCP calls — no tasks.*, no actions.*
- NO health.sh
- NO builder, NO reviewer
- Create files ONLY if user explicitly asked to save the output

## Process

1. Invoke **Explorer** as a subagent:
   > "Read-only context gathering — no MCP harness. The user wants technical advice on: `$ARGUMENTS`. Map the relevant codebase — existing patterns, current implementation, relevant dependencies. Return findings as plain structured text."

2. Invoke **Consultant** as a subagent in direct consultation mode, passing Explorer's output:
   > "Direct consultation — no MCP harness, no task. User's topic: `$ARGUMENTS`. Explorer found: [explorer output]. Provide structured technical advice. The provider has already injected available skills into your context — check what skills you are aware of, identify which are relevant to this topic, and reference them explicitly in your advice. If no installed skills seem relevant to the topic, recommend running `npx autoskills` to fetch appropriate skill packs."

3. Synthesize a final response for the user.

## Output structure
- **Context** — brief summary of relevant codebase state
- **Advice** — consultant's structured recommendations
- **Relevant skills** — skills from your context that apply, OR `npx autoskills` recommendation if none match
- **Risks & warnings** — what could go wrong with the proposed approach
