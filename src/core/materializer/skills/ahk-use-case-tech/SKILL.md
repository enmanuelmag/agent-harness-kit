---
name: ahk-use-case-tech
description: Turn an approved use-case, feature, or fix into a linked, evidence-backed technical specification.
---

## Entry gate

Start by locating the requested source with `specs.list` or `specs.search` and reading it with `specs.get`. Stop unless it is an approved `use-case`, `feature`, or `fix`; help resolve it with the corresponding discovery skill first.

Read [the technical workflow](resources/technical-workflow.md) before analysis and [the technical template](resources/technical-template.md) before saving.

## Investigation

Inspect the relevant codebase before proposing technical work. For every library, framework, SDK, API, CLI, cloud service, version, compatibility, configuration, or migration question: identify installed versions from manifests and lockfiles, query Context7 and the Mintlify documentation index when available, then use primary documentation for gaps. Record compatibility, upgrade need, new dependency need, and evidence. Do not treat an unverified assumption as a decision.

## Proposal and persistence

Define affected boundaries, contracts and data flow, alternatives and rationale, compatibility findings, dependencies, rollout or migration, risks, validation, and a phased implementation plan. Link related specifications with `specs.link`; use `depends-on`, `extends`, `supersedes`, `conflicts-with`, or `informs` precisely.

After the technical investigation produces a complete first synthesis, create or update a `technical` draft through structured MCP tools with `sourceSpec` pointing to the approved source, then run `specs.validate`. Keep the draft reviewable and editable through MCP; transition it to `approved` only after explicit user confirmation. A technical spec that is `needs-reconciliation` must not be used as an implementation plan until reconciled and approved again.
