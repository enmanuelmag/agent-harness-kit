# Feature and fix specification workflow

## Goal

Add two persistent, reviewable specification kinds, `feature` and `fix`, alongside `use-case` and `technical`. They turn a Jira description or initial idea plus codebase evidence into a document that agents and users can search, read, edit, relate, approve, and reuse for later technical designs and tasks.

## Scope

- Extend the existing `docs/specs` store, validated frontmatter, MCP tools, and provider-materialized skills.
- Add `ahk-feature` and `ahk-fix` with their own workflow and template resources.
- Align `ahk-use-cases` and `ahk-use-case-tech` with the same persisted-draft, MCP-review, and explicit-approval lifecycle.
- Add body-content search through MCP.

## Exclusions

- No dashboard editor or a second document store.
- No automatic persistence of a raw, incomplete user prompt.
- No automatic approval or task creation from a draft.
- No implementation design in a feature/fix document; that stays in a linked `technical` specification.

## Architecture

`SpecStore` remains the source of truth and stores every specification under `docs/specs/<slug>.md`. `feature` and `fix` become independent `spec_kind` values rather than a shared kind with a category field. This preserves type-aware validation while retaining one storage format, relation graph, MCP namespace, and materialization path.

```
initial idea or Jira + project evidence
  -> feature/fix discovery skill
  -> complete first synthesis
  -> persistent draft in docs/specs
  <-> MCP search, read, edit, link, validate
  -> explicit approval
  -> linked technical specification
  -> later tasks consult the specification
```

## Lifecycle and derivation

`feature` and `fix` use `draft`, `needs-decision`, `approved`, and `superseded`. `technical` keeps `draft`, `needs-reconciliation`, `approved`, and `superseded`.

The technical-source rule accepts an `approved` `use-case`, `feature`, or `fix`. Editing the content or metadata of an approved source changes that source to `needs-decision` and changes every technical specification sourced from it to `needs-reconciliation`. A technical document in `needs-reconciliation` cannot be used as an implementation plan until it is reviewed and approved again.

## Discovery and draft workflow

Every product/technical specification skill follows these stages:

1. Read the initial idea or Jira description and discover related specifications.
2. Inspect relevant project documentation, code, contracts, tests, and prior decisions. Record evidence separately from assumptions and open questions.
3. Ask one necessary follow-up at a time; do not repeat facts already supported by evidence.
4. Once the required information is complete, write the first synthesis as a `draft` through structured MCP tools.
5. Let the user and later agents inspect, search, edit, relate, and validate the draft through MCP without reconstructing it from chat history.
6. Change status to `approved` only after explicit user confirmation.

`ahk-use-cases` and `ahk-use-case-tech` will state this same lifecycle explicitly. A technical skill still requires an approved source before it creates its own draft.

## Feature document contract

The feature template contains:

- Origin and initial request or Jira reference.
- Problem, value, and success signal.
- Actors or affected users.
- Codebase and product-context evidence.
- Current and desired experience, including main flow and meaningful variants.
- Scope, exclusions, rules, dependencies, and risks.
- Observable acceptance criteria.
- Confirmed decisions, assumptions, open questions, and a change log.

## Fix document contract

The fix template contains:

- Origin and initial request or Jira reference.
- Symptom, impact, affected scope, expected behavior, and actual behavior.
- Reproduction steps and available evidence.
- Codebase and product-context evidence.
- Confirmed cause, or separately labelled hypotheses when not yet confirmed.
- Scope, exclusions, non-regression boundaries, dependencies, and risks.
- Validation and observable acceptance criteria.
- Confirmed decisions, assumptions, open questions, and a change log.

The fix skill must never promote an unverified hypothesis to a confirmed cause.

## MCP contract

Existing generic specification operations (`list`, `get`, `create`, `update_metadata`, `update_content`, `transition`, `link`, `unlink`, `related`, and `validate`) accept the two new kinds and enforce their lifecycle rules.

Add `specs.search` with a query and optional `specKind`, `status`, pagination, and bounded-result controls. It searches slug, title, description, and body content, and returns document headers with matching excerpts. `specs.list` remains a lightweight header list rather than a body-search substitute.

All writes remain atomic. Invalid kinds, states, relations, sources, malformed frontmatter, or missing references return an error without partially updating documents.

## Materialization

Add the canonical `ahk-feature` and `ahk-fix` skill trees and include them in `writeSkills`. Each tree has a manifest, a workflow resource, and a template resource. Update existing use-case and technical resources for the aligned lifecycle. Provider-specific output continues to copy canonical resources byte-for-byte and only injects delegation guidance into manifests.

## Verification

- Unit-test feature/fix status validation and frontmatter parsing/serialization.
- Test technical specs sourced from approved use cases, features, and fixes; reject all other source states and kinds.
- Test invalidation from every approved source kind to its derived technical specifications.
- Test content-aware MCP search, filters, excerpts, pagination, and existing header listing behavior.
- Test MCP creation, read, edits, transitions, relationships, and validation for feature and fix documents.
- Test materialization ships both complete new skill trees and preserves every resource exactly.
- Run focused tests, then `bash health.sh`.

