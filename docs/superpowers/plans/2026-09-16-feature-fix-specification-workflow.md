# Implementation plan: feature and fix specification workflow

## 1. Extend specification domain rules

Files: `src/core/specs.ts`, `src/tests/specs.test.ts`

- Add `feature` and `fix` to `SPEC_KINDS`.
- Define their lifecycle statuses as `draft`, `needs-decision`, `approved`, and `superseded`.
- Centralize the source kinds allowed for a technical spec: approved `use-case`, `feature`, or `fix`.
- Generalize approved-source invalidation so edits to any approved source kind mark it `needs-decision` and its technical dependents `needs-reconciliation`.
- Preserve atomic writes and all existing frontmatter, relation, and status validation.
- Add unit coverage for feature/fix serialization, invalid states, accepted and rejected technical sources, and invalidation from each source kind.

## 2. Add content-aware specification search to MCP

Files: `src/core/specs.ts`, `src/core/mcp-server.ts`, new or existing focused MCP test file

- Add a bounded `SpecStore` search operation that checks slug, title, description, and body case-insensitively.
- Return header metadata and a stable, bounded matching excerpt; do not return entire bodies by default.
- Register `specs.search` with query, optional type/status filters, offset, and limit.
- Keep `specs.list` as the existing light metadata-only index.
- Test body-only matches, filtering, excerpts, pagination, invalid parameters, and no partial writes on errors.

## 3. Add canonical feature and fix skills

Files: `src/core/materializer/skills/ahk-feature/**`, `src/core/materializer/skills/ahk-fix/**`

- Create a manifest, workflow resource, and template resource for each skill.
- Require initial-input capture, related-spec discovery, project evidence, one-at-a-time questions, evidence/assumption/open-question separation, and automatic first-draft persistence only after complete synthesis.
- Feature resources cover problem/value, actors, current/desired flows, scope, rules, dependencies, risks, and observable acceptance.
- Fix resources cover symptom/impact, expected/actual behavior, reproduction, evidence, confirmed cause vs hypothesis, non-regression boundaries, and validation.
- Require structured MCP reads/writes, validation after writes, and explicit approval before technical handoff.

## 4. Align existing use-case and technical skills

Files: `src/core/materializer/skills/ahk-use-cases/**`, `src/core/materializer/skills/ahk-use-case-tech/**`

- State the persistent draft → MCP review/edit → explicit approval lifecycle explicitly.
- Make use-case drafts follow first-complete-synthesis persistence.
- Keep the technical entry gate requiring an approved source, expanded to use-case/feature/fix.
- Update templates to record initial input, project evidence, decisions, assumptions, open questions, and change history consistently.

## 5. Materialize, expose, and document the skills

Files: `src/core/materializer/scaffold-utils.ts`, `src/core/doctor.ts`, relevant templates/tests, `README.md`, `docs/README.md`

- Add both skill names to canonical materialization and doctor status lists.
- Update all provider-materialization assertions to require the two complete trees and byte-identical resources.
- Update project-facing skill lists and specification documentation with the new kinds, draft lifecycle, search tool, and technical-source rule.

## 6. Verify the complete contract

Files: `src/tests/specs.test.ts`, focused MCP tests, `src/tests/templates.test.ts`, `src/tests/delegation-guidance.test.ts`, documentation tests if present

- Run focused specification, MCP, materialization, template, and guidance tests.
- Run `bash health.sh` after all edits.
- Verify the changed generated skill assets are consistent with their canonical sources without touching user-owned agent definitions.
