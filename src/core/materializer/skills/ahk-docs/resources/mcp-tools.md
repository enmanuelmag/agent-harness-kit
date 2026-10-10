# MCP tool families

Use the tool descriptions provided by the running server for exact schemas. These families describe the stable workflow intent.

## Tasks and actions

- `tasks.add`, `tasks.get`, `tasks.claim`, and `tasks.update` create, inspect, claim, and close work.
- `tasks.acceptance.get` and `tasks.acceptance.update` manage acceptance evidence.
- `tasks.repair.begin` records a bounded reason and scope before work repairs a failed health gate.
- `actions.start`, `actions.write`, and `actions.complete` record a role's bounded work.
- `actions.list`, `actions.get_by_id`, `actions.sections.list`, and `actions.sections.get` read action history without loading unrelated content.
- `actions.handoff.get` and `actions.handoff.write` transfer a completed result to the next role.

The lead claims work. Each role starts and completes an action. The builder reads the handoff addressed to builder rather than reconstructing a complete history. The reviewer writes actionable feedback or approval evidence for the lead's closure decision.

## Specifications and docs

- `docs.search` finds project documentation.
- `specs.list`, `specs.get`, `specs.search`, and `specs.related` read documents and relationships.
- `specs.list` discovers valid metadata and returns `{ items, nextOffset, diagnostics }`. Each diagnostic has a `path` relative to the configured docs directory and a `message` explaining an invalid or ambiguous document. Diagnostics cover all scanned files in both roots, regardless of item filters or pagination; an empty scan returns `diagnostics: []`.
- Discovery is nonrecursive and excludes `README.md` indexes case-insensitively. Other `.md` files, including `index.md`, need valid specification frontmatter. Duplicate filenames across roots are excluded with diagnostics for both paths. `specs.get`, search, validation, and mutations remain strict; listing diagnostics do not authorize or silently repair documents.
- `specs.create`, `specs.update_metadata`, `specs.update_content`, and `specs.transition` manage a specification draft and status.
- `specs.link`, `specs.unlink`, and `specs.validate` maintain relationships and validate metadata.

Use cases are `use-case` documents in `docs/use-cases/`. Functional `spec`, specialized `feature`/`fix`, and `spec-tech` documents are in `docs/specs/`. An approved use case can be an input to a spec; an approved functional source is the input to technical design.

## Health and limits

`health.run` reruns native health for diagnosis. It is not a replacement for the automatic claim and final-health gates. A tool response can prove only the operation it reports; inspect live task status and logs before making a wider claim.
