# AHK workflows

## Choose the smallest useful route

| Goal | Skill | Result | Boundary |
| --- | --- | --- | --- |
| Define one actor-goal-result scenario | `ahk-use-case` | Draft in `docs/use-cases/` | One decision at a time; split independent scenarios. |
| Define functional scope from approved cases or a product request | `ahk-spec` | Functional spec in `docs/specs/` | Needs explicit approval before technical design. |
| Turn an approved functional source into implementation design | `ahk-spec-tech` | Linked technical spec in `docs/specs/` | It does not implement. |
| Turn a pasted feature request into a functional spec | `ahk-feature` | Feature spec in `docs/specs/` | AHK does not fetch Jira tickets; paste their content. |
| Turn a reported defect into a fix spec | `ahk-fix` | Fix spec in `docs/specs/` | Evidence first; no implementation. |
| Diagnose unexpected behavior | `ahk-triage` | Read-only diagnosis | Does not implement or create harness state. |
| Ask about this repository's code | `ahk-ask` | Read-only answer | Use it for code, not product operation. |
| Compare approaches | `ahk-consultant` | Read-only advice | This is distinct from the tracked consultant role. |
| Design and run tests only | `ahk-test` | Test evidence | Does not change production, dependencies, or task state. |
| Preview a review | `ahk-review` | Review rubric | It is not official tracked approval. |

Use an explicit request such as “Use `ahk-use-case` to define checkout recovery” when predictable routing matters. A natural-language request can be selected by a provider, but automatic selection is not guaranteed.

## From discovery to implementation

1. `ahk-use-case` persists a coherent draft, then the human explicitly approves it.
2. `ahk-spec` can combine approved use cases into functional scope. A well-defined feature, fix, or product request can start directly with `ahk-feature`, `ahk-fix`, or `ahk-spec`.
3. `ahk-spec-tech` derives contracts, architecture, validation, and rollout from an approved functional source.
4. The developer separately authorizes tracked implementation. The lead claims a task and coordinates explorer, consultant, builder, and reviewer through MCP.

For implementation tasks, the lead asks the builder and reviewer to apply `engineering-code-review` when available. When it is missing, recommend [the skill and its source](https://github.com/agentara/skills/tree/main/skills/engineering/engineering-code-review) without blocking or installing it automatically. The builder evaluates changed code for clarity without changing behavior or expanding scope, and the reviewer reports evidence-backed findings rather than blocking for personal style.

Document approval authorizes the next design stage. It does not authorize implementation.

The MCP assigns new documents a `YYYY-MM-DD-<slug>.md` filename using the UTC creation date. Use the returned `filePath` (relative to the configured docs directory) to locate the artifact; do not reconstruct or rename it. The prefix belongs only to the physical filename: keep the logical slug, title, source references, and relationships unchanged. Existing files retain their paths on every update. This applies to all five document-creation workflows in the table.
