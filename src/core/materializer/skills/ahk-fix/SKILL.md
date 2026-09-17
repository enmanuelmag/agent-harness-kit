---
name: ahk-fix
description: Turn a reported defect or Jira issue into a reviewable, evidence-backed fix specification.
---

## Purpose

Read [the fix workflow](resources/fix-workflow.md) before discovery and [the fix template](resources/fix-template.md) before saving.

## Persistence and handoff

After the required questions and project evidence produce a complete first synthesis, create or update a `fix` draft with structured specification MCP tools. Use `specs.list` and `specs.search` to find related context, `specs.get` to read it, and `specs.validate` after every write. Keep drafts reviewable and editable through MCP; transition to `approved` only after explicit user confirmation.

Never label a suspected cause as confirmed without evidence. Offer `ahk-use-case-tech` only after this fix is approved and the user asks for technical design.
