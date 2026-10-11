# Changelog

User-facing v3 changes relative to the Git tag `v2.36.2`, grouped by their repository comparison ranges.

## [Unreleased]

### Runtime requirements

- Upgrade Node to match `>=22.14.0 <23 || >=23.6.0`: Node 22.14.0 or newer on 22.x, or Node 23.6.0 or newer. Earlier 23.x releases are excluded. The SQLite driver is now pinned to `better-sqlite3` 13.0.3, removing the deprecated `prebuild-install` dependency from its installation path. Native installation may require a build toolchain; see [runtime compatibility](README.md#compatibility-and-development) for installation caveats and the limits of platform verification.

### Changed

- `specs.list` returns valid documents alongside an always-present `diagnostics` array for invalid or ambiguous files, with paths relative to the configured docs directory. Filters and pagination do not hide diagnostics. `README.md` indexes are excluded case-insensitively. Other document reads, searches, validation and mutations retain strict validation; rejected writes leave files unchanged.
- All 18 CLI actions await asynchronous work and hooks through a shared Result boundary. Operational failures report a contextual diagnostic on stderr and exit nonzero. Fatal `ahk build --watch` rebuild errors report once, close the watcher and terminate; cancellation and health exit behavior remain intact. Update reporting is advisory, and JSON/stdio output stays free of CLI update banners.
- All 37 MCP tools share a Result boundary that preserves successful output validation, legacy text, `isError` and operational notices when an operation fails.

### Added

- Informational database latency notices observe actual driver calls, including reads and writes inside transactions. Normal DB-backed task/action/health responses consume memory only, without extra SQL or file-size probes. Schema setup, explicit diagnostic probes, inclusive transaction time and health scripts are excluded from timing; SQL and user data are not logged. Primary results, errors and health gates remain unchanged. CLI notices use stderr even with JSON output; `serve` delivers notices through MCP only. Filesystem tools receive no database notices.
- Optional `databaseDiagnostics` configuration can disable or tune bounded observation. Defaults classify calls taking at least 500 ms as slow, retain at most 128 samples within five minutes, and require **at least 10 samples, at least 3 slow calls, and at least 20% slow calls** before a notice. A ten-minute cooldown applies per connection. State is memory-only and does not persist across processes; short CLI sessions may produce no notice.
- `ahk doctor --db` and MCP `ahk.doctor` with `db: true` opt into database history diagnostics cached for five minutes. Ordinary doctor remains metadata-only. The diagnostic counts completed tasks whose `completed_at` is older than 90 days, including archived history; at least 1,000 is a manual retention-review heuristic. SQLite main/WAL size is optional context, and remote size may be unknown. A missing SQLite database is not created; CLI diagnostics use a read-only connection without schema migration or journal-mode changes. MCP reuses its server connection. Probe failures remain advisory.

History counts and file size do not establish the cause of latency or promise an improvement from cleanup. No automatic deletion, VACUUM or checkpoint runs. Preserve needed history before planning manual maintenance; archiving hides rows and does not shrink storage. See [database diagnostics and configuration](src/core/materializer/skills/ahk-docs/resources/maintenance.md#optional-database-diagnostics) for bounds, ownership and scan-cost caveats.

## [3.0.0-rc.2]

### Fixed

- Release-metadata CLI scalars now use plain text independent of terminal colors. ANSI sequences can no longer corrupt shell boolean checks, which could recreate an existing prepared tag or misclassify a prerelease.

## [3.0.0-rc.1]

### Breaking requirements

- The MCP runtime moves from the legacy SDK to `@modelcontextprotocol/server` 2.3.1 and its `McpServer` API, with Zod 4.6.5 tool contracts. This release requires Node `>=22.0.0`; the later Unreleased requirement above is higher.

### Changed

- Zod tool definitions are the single source for advertised input schemas and executable input validation. Input/output contracts compile once at module initialization and are reused by registration and calls. Input admission preserves legacy coercion, recovery and missing/null/property-presence behavior; extra arguments are stripped.
- Successful structured outputs are schema-validated DTOs alongside the existing text response. Unknown DTO fields are stripped. Root arrays use an `items` envelope and null uses a `value` envelope in `structuredContent`; legacy text, errors and operational notices retain their existing form.
- Release preparation follows the manifest version with branch, channel and immutable-tag guards. Release candidates use npm's `rc` channel and GitHub prerelease status without becoming latest. The updated tooling keeps v2 maintenance on `v2` and v3 stable on `latest`; dry runs build and pack without authentication or publication. See [release-line guidance](README.md#release-lines) before preparing or backporting a release.

[Unreleased]: https://github.com/enmanuelmag/agent-harness-kit/compare/v3.0.0-rc.2...release/v3
[3.0.0-rc.2]: https://github.com/enmanuelmag/agent-harness-kit/compare/v3.0.0-rc.1...v3.0.0-rc.2
[3.0.0-rc.1]: https://github.com/enmanuelmag/agent-harness-kit/compare/v2.36.2...v3.0.0-rc.1
