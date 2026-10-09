---
name: ahk-spec-tech
description: Turn an approved spec, feature, or fix into a linked evidence-backed technical specification.
---

Start by locating the approved `spec`, `feature`, or `fix` source. Research the current codebase first. For libraries, frameworks, SDKs, APIs, CLIs, cloud services, versions, configuration, or migration questions, use current primary documentation through Context7 and the configured documentation index.

Read [the workflow](resources/workflow.md) and [the template](resources/template.md) before saving.

Define boundaries, contracts, data flow, alternatives and rationale, compatibility, dependencies, rollout, risks, validation, and implementation phases. Create a `spec-tech` draft in `docs/specs/` with `sourceSpec`, validate after every write, and transition to approved only after explicit user confirmation. A `needs-reconciliation` technical spec cannot guide implementation until reconciled and approved again.
