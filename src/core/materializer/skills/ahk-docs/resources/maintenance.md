# Maintenance and upgrades

Use `ahk build` to materialize generated agent, MCP, and skill files after configuration changes. Use `ahk sync` when its synchronization workflow is appropriate for the project. `ahk doctor` is read-only: it reports package/update notices, agent-file presence, and canonical skill drift; it never applies migrations or rewrites generated files.

Doctor checks agents by existence only because their bodies and frontmatter are user-owned. It byte-compares each canonical skill manifest and resource against the packaged source (with provider guidance applied to manifests), so a missing or edited skill can be reported as missing or outdated.

Some lifecycle responses and maintenance commands may check for updates. Those network checks are optional and cached; ordinary local workflow and bundled documentation do not require network access.

Generated skills have a project-local migration state. `build` and `sync` apply eligible migrations in version order and record resumable checkpoints. The eleven canonical AHK skill names and retired `ahk-use-cases` / `ahk-use-case-tech` are reserved by exact name, not by an `ahk-*` wildcard. Changed canonical files are backed up before refresh; retired trees are backed up in full before removal, including recovery after an already-applied checkpoint. Backups use unique project-relative paths under `.harness/backups/` and are reported by build. Unknown skill names and extra files remain untouched, except stale canonical resources proven by a validated prior inventory. Symlinks, including broken links, are refused. Doctor only reports state; agent files retain their user-owned policy.

Only registered migrations between the project's checkpoint and the running CLI version execute, oldest first. A newer minor or major release without a migration is valid; it needs no placeholder entry. Completed entries remain checkpointed after an interruption. After canonical refresh completes, both the generated-skills version and the processed-version checkpoint advance to the running CLI version; the applied-entry ledger contains only actual migrations. Version checks follow SemVer precedence, including prereleases; build metadata does not change precedence. Downgrading below the generated version or migration checkpoint is refused.

Document migrations are explicit because they change human-authored specifications. Back up important project state before force operations or storage changes. `--force` can overwrite generated material; review its command help and the affected paths before using it.

## Optional database diagnostics

Ordinary doctor remains metadata-only. `ahk doctor --db` and MCP `ahk.doctor` with `db: true` request a cached aggregate of completed tasks with `completed_at` older than 90 days, including archived history. At least 1,000 is a review heuristic, not evidence that history caused latency. SQLite main plus WAL bytes are optional read-only context; remote size is unknown. CLI reports on stderr; MCP adds a notice while preserving the metadata DTO. A missing SQLite file is not created. CLI diagnostic SQLite connections are read-only: they skip schema migration, WAL mode changes and stale-sidecar cleanup. Remote diagnostic connections also skip schema initialization. Unavailable config, probes, or size information remain advisory. The five-minute per-connection cache also caches failed probes; expired facts cannot support normal-response retention advice.

Passive measurement decorates actual driver calls after schema initialization on SQLite, PostgreSQL and MySQL, including transaction callback drivers. It excludes inclusive transaction duration, driver internal delegation, health scripts, schema initialization and explicit diagnostic queries. Samples contain only times, never SQL, bindings, credentials or task content. Normal task/action/health MCP responses consume memory only and can add a combined operational-notice block; specs/docs/permissions/dependency tools do not. CLI DB users emit notices at owned connection close, including JSON commands; stdio serving exclusively uses MCP delivery.

Optional `databaseDiagnostics` settings:

| Setting | Default | Accepted range |
| --- | --- | --- |
| `enabled` | `true` | `false` disables observations and probes |
| `slowMs` | 500 | 1–60,000 |
| `windowMs` | 300,000 | 1,000–3,600,000 |
| `minSamples` | 10 | integer 1–128 |
| `minSlow` | 3 | integer 1–128 |
| `slowFraction` | 0.2 | 0.01–1 |
| `cooldownMs` | 600,000 | 1,000–86,400,000 |

Invalid numeric values fall back individually to defaults. All sample-count, slow-count and fraction conditions must hold, with at most 128 recent samples. Each connection owns its rolling window, cooldown and fixed-size history cache; no metrics persist across processes. Short CLI sessions may produce no notice. Lower thresholds can reflect network/pool latency, not just database work.

Design decision: use a passive driver decorator plus explicit cached diagnostics rather than timing whole commands or running probes on normal responses. Monotonic time measures elapsed calls; UTC determines task age. Observer/delivery failures cannot change driver values, original errors or transaction commit/rollback. CLI owns and closes only connections it opens; MCP doctor reuses the server connection and never closes it. A command-scoped sink collects close-time advice without retaining live connections globally. An explicit SQLite COUNT can incur synchronous scan cost; asynchronous wrappers do not guarantee cancellation or a time budget. There is no daemon, persistent telemetry, schema/index migration or automatic maintenance. Retention review and any bulk cleanup remain manual after preserving needed history; archiving hides records and does not shrink storage.
