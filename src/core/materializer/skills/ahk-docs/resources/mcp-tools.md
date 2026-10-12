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

## The agent detects, resolves and communicates

`ahk.capabilities` lists implemented maintenance operations, version and limits. Public CLI equivalents return typed `ok`, `operation`, `code`, `data`, optional `required` and informational `notices`. Expected failures preserve structured outcomes with `isError`. Unknown input keys are stripped, benign supported numeric/JSON forms are recovered, and unsafe boolean strings are rejected before changes.

| CLI operation | MCP equivalent |
| --- | --- |
| init with optional sounds/hooks | `ahk.init` with explicit project/provider/storage/role choices; missing config permits setup-mode serving |
| build and permission sync | `ahk.build` with explicit `force`, `sync` and native choices |
| sync, force/keep-models/capture-models | `ahk.sync.plan` then `ahk.sync.apply` |
| models | `ahk.models` with explicit native role choices |
| task add/list/edit/done | `tasks.add/get/edit/update`; `archivedOnly` maps archived listing, edit/update accept ID or slug, done retains final health |
| status, health, doctor --db | `ahk.status`, stateless `ahk.health`, `ahk.doctor` with `db: true` |
| provider/storage/specs migration | `ahk.migrate.provider/storage/specs.plan` then corresponding `.apply` |
| reset | `ahk.reset.plan` with selected targets, then `.apply` with explicit force/confirmation |
| export | `ahk.export` selects JSON artifact; overwriting an existing output requires explicit `force` and backup; SQL returns unsupported guidance |
| dashboard, build --watch | `ahk.dashboard.start/status/stop`, `ahk.watch.start/status/stop` |
| serve | `ahk.serve` reports this host's transport/port/restart state; no nested server |
| notifications and attention | `ahk.notifications.status/configure/enable/disable/install/uninstall`, `ahk.notify.attention` |

Plans inspect without persistent source/destination database changes, project backups, schema changes or migration checkpoints. DB inspection may create a bounded temporary disk snapshot, removed after inspection. Plans expire, are bounded per server and cannot be reused after restart. Apply rechecks configuration and relevant files under a workspace lock; stale plans and concurrent edits require a fresh inspection. Missing model choices return `needs_input` without guessing inheritance. Force is explicit, with complete prewrite backups. Operational configuration is saved to a managed JSON overlay, preserving executable base config. Storage/reset drain owned jobs and fence old DB handles until verified reopen; a failed reopen requires recovery/restart instead of stale business reads.

SQLite inspection reads a temporary disk snapshot (including WAL) to avoid sidecar writes to the source and refuses a snapshot above 1 GiB. Concurrent source changes invalidate inspection. Maintenance uses DB-scoped exclusive ownership guards for source and destination, and a real SQLite write barrier holds a consistent six-table snapshot through import, verification and checkpoints. Another live AHK connection returns `database_busy` without destructive changes. Durable epochs and retirement metadata fence stale AHK handles/configurations with `restart_required`; an intentional migration back may reactivate a retired path only after verification.

SQLite sources are retained after every migration. Stop unmanaged native SQLite writers before moving storage; migration is a verified snapshot, not continuous replication, and later native writes remain in the retained source. Reset clears workflow rows transactionally with a consistent JSON backup while preserving the SQLite file/inode and schema; `removed` reports only selected role files. Source/destination private ownership records are capped at 64, dead process records are pruned, and incompatible/corrupt state fails closed. Previous remote-source credentials are not retained, so automatic reconnection of a former remote DB is unsupported. A populated remote destination is refused unless a safe native destination write barrier is supported; an empty supported destination can be imported transactionally. Scope/checkpoints are recorded only after verified import.

The agent detects and communicates generated-skill drift, registered migration work, preserved customizations, effective sound precedence, hook ownership conflicts, changed paths, backups and verification. Future migration support means implemented registered migrations. Native trust and sound preferences remain user-managed.

Generated role defaults list diagnostic/status/plan operations and explicit attention for every role; lead and builder additionally receive maintenance mutations. Codex instructions distinguish server-owned bounded maintenance from arbitrary direct project edits, and Claude generated allow rules enumerate the registered tool names. Provider capabilities and trust controls differ; these defaults are not server-side identity authentication and do not grant arbitrary file writes. Existing personal/provider files are refreshed only by an explicit build/sync operation.

`ahk.models` configures the current provider only. If an explicit provider differs, it returns `provider_mismatch` without changing preferences or role files; use the provider migration plan/apply flow to change providers.

A valid configuration with a known busy/retired database can start MCP in maintenance mode. Database business tools return typed `database_busy`/`restart_required` outcomes; specifications, metadata diagnostics, plans and notification configuration remain usable. `ahk.serve` reports stored/effective provider and runtime mode. Once supported maintenance verifies the target, it reopens the database in the same session, including reconciliation of an already-current target. Invalid configuration and unrelated database errors do not silently enter this mode.

Status, stateless health and cached DB timing/history diagnostics help communicate slow operations and retention context. Warnings remain informative and nonblocking; they do not infer index/query causes or automatically bulk-delete/archive tasks. Task health and acceptance gates remain authoritative.

## Health and limits

`health.run` reruns native health for diagnosis. It is not a replacement for the automatic claim and final-health gates. A tool response can prove only the operation it reports; inspect live task status and logs before making a wider claim.

`ahk.doctor` accepts optional `db: true` for cached database history/storage diagnostics in its optional `database` field and an additive notice. Its default behavior remains metadata-only. Database-backed task/action/health tools may include passive latency notices in the same operational-notice block; filesystem tools do not. Notice eligibility performs no SQL or file-size probe on normal responses. See maintenance documentation for thresholds, cache policy and manual-retention caveats.

When local sounds are enabled, lifecycle responses may add an independent versioned JSON text notification marker for hook correlation. Primary DTO/text/errors and existing notices remain unchanged; see [local sound notifications](notifications.md).
