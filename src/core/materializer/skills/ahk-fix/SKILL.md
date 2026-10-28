---
name: ahk-fix
description: Turn a reported defect or Jira issue into a reviewable, evidence-backed fix specification.
---

## Purpose

Read [the fix workflow](resources/fix-workflow.md) before discovery and [the fix template](resources/fix-template.md) before saving.

## Persistence and handoff

After the required questions and project evidence produce a complete first synthesis, create or update a `fix` draft with structured specification MCP tools. Use `specs.list` and `specs.search` to find related context, `specs.get` to read it, and `specs.validate` after every write. Keep drafts reviewable and editable through MCP; transition to `approved` only after explicit user confirmation.

Never label a suspected cause as confirmed without evidence. Offer `ahk-spec-tech` only after this fix is approved and the user asks for technical design.

The MCP assigns new documents a `YYYY-MM-DD-<slug>.md` filename using the UTC creation date. Use the returned `filePath` (relative to the configured docs directory) to locate the artifact; do not reconstruct or rename it. The prefix belongs only to the physical filename: keep the logical slug, title, source references, and relationships unchanged. Existing files retain their paths on every update.
