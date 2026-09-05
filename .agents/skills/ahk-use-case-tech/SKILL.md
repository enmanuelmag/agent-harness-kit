---
name: ahk-use-case-tech
description: Turn an approved use-case specification into a linked, evidence-backed technical specification.
---

## Provider Delegation Guidance

- Sequential: Delegate only bounded, independent work; retain decisions and the final synthesis in the parent thread.
- Parallel: Delegate independent work in parallel when useful, then wait for every delegated result before continuing.
- Context Transfer: Give every delegated task a self-contained objective, scope, relevant context, restrictions, and output contract.
- Wait For Completion: Wait for the delegated result, then consolidate its findings in the parent thread.
- Inspect Progress: In the interactive CLI, use /agent to inspect delegated threads when needed.


## Entry gate

Start by locating the requested use-case with `specs.list` and reading it with `specs.get`. Stop if it is not an `approved` `use-case`; help resolve it with `ahk-use-cases` first.

Read [the technical workflow](resources/technical-workflow.md) before analysis and [the technical template](resources/technical-template.md) before saving.

## Investigation

Inspect the relevant codebase before proposing technical work. For every library, framework, SDK, API, CLI, cloud service, version, compatibility, configuration, or migration question: identify installed versions from manifests and lockfiles, query Context7 and the Mintlify documentation index when available, then use primary documentation for gaps. Record compatibility, upgrade need, new dependency need, and evidence. Do not treat an unverified assumption as a decision.

## Proposal and persistence

Define affected boundaries, contracts and data flow, alternatives and rationale, compatibility findings, dependencies, rollout or migration, risks, validation, and a phased implementation plan. Link related specifications with `specs.link`; use `depends-on`, `extends`, `supersedes`, `conflicts-with`, or `informs` precisely.

Present the technical proposal for user approval before writing it. Once approved, create or update a `technical` specification through structured MCP tools with `sourceSpec` pointing to the approved use-case, then run `specs.validate`. A technical spec that is `needs-reconciliation` must not be used as an implementation plan until reconciled and approved again.
