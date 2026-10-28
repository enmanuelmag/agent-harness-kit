---
name: ahk-spec
description: Turn approved use cases or a product request into a linked functional specification.
---

Locate relevant context with `specs.list`, `specs.search`, and `specs.get`. A functional spec defines the product scope, rules, exclusions, acceptance criteria, decisions, and unresolved questions. It does not select implementation details.

Read [the workflow](resources/workflow.md) and [the template](resources/template.md) before saving.

When based on use cases, reference every approved upstream use case with `sourceUseCases`. Create a `spec` draft in `docs/specs/`, save a coherent draft before approval, validate after every write, and transition only after the user explicitly approves it. A changed approved upstream use case sends this spec to `needs-decision` and derived technical work to `needs-reconciliation`.

Use `feature` or `fix` only where those existing specialized workflows fit. Offer `ahk-spec-tech` only after the functional source is approved.

The MCP assigns new documents a `YYYY-MM-DD-<slug>.md` filename using the UTC creation date. Use the returned `filePath` (relative to the configured docs directory) to locate the artifact; do not reconstruct or rename it. The prefix belongs only to the physical filename: keep the logical slug, title, source references, and relationships unchanged. Existing files retain their paths on every update.
