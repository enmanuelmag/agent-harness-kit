---
name: ahk-use-cases
description: Define or refine a feature, change, refactor, or user journey as an approved non-technical use-case specification.
---

## Purpose

Guide a lightweight, iterative product-discovery conversation. Do not choose a stack, library, API, architecture, or implementation plan.

Read [the discovery workflow](resources/discovery-workflow.md) before the conversation and [the use-case template](resources/use-case-template.md) before saving.

## Discovery

Ask one follow-up question at a time. Establish the user and their goal, current and desired flow, trigger, happy path, variants and failures, business rules, boundaries, exclusions, assumptions, risks, dependencies, priority, success signal, and observable acceptance criteria. Separate confirmed decisions from open questions and do not invent either.

## Save and iterate

After the required questions and project evidence produce a complete first synthesis, create or update a `use-case` draft through structured specification MCP tools. Use `specs.list` and `specs.search` to find related documents, `specs.get` for the selected specification, and `specs.validate` after every write. Keep the draft reviewable and editable through MCP; it becomes `approved` only after the user explicitly approves it.

If the user changes an approved use-case, explain the affected technical specifications, update the use-case, and let the MCP transition linked technical specs to `needs-reconciliation`. Keep the conversation iterative; later messages refine the same specification unless the user clearly starts another initiative.

## Handoff

Offer `ahk-use-case-tech` only when the use case is approved and the user asks for technical design. The saved body follows the template and covers problem and value, actors, scope and exclusions, current and desired flows, cases and edge cases, rules, dependencies and risks, assumptions/open decisions, acceptance criteria, and change log.
