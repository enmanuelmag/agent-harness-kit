# Maintenance and upgrades

Use `ahk build` to materialize generated agent, MCP, and skill files after configuration changes. Use `ahk sync` when its synchronization workflow is appropriate for the project. `ahk doctor` is read-only: it reports package/update notices, agent-file presence, and canonical skill drift; it never applies migrations or rewrites generated files.

Doctor checks agents by existence only because their bodies and frontmatter are user-owned. It byte-compares each canonical skill manifest and resource against the packaged source (with provider guidance applied to manifests), so a missing or edited skill can be reported as missing or outdated.

Some lifecycle responses and maintenance commands may check for updates. Those network checks are optional and cached; ordinary local workflow and bundled documentation do not require network access.

Generated skills have a project-local migration state. `build` and `sync` apply eligible migrations in version order and record resumable checkpoints. The eleven canonical AHK skill names and retired `ahk-use-cases` / `ahk-use-case-tech` are reserved by exact name, not by an `ahk-*` wildcard. Changed canonical files are backed up before refresh; retired trees are backed up in full before removal, including recovery after an already-applied checkpoint. Backups use unique project-relative paths under `.harness/backups/` and are reported by build. Unknown skill names and extra files remain untouched, except stale canonical resources proven by a validated prior inventory. Symlinks, including broken links, are refused. Doctor only reports state; agent files retain their user-owned policy.

Document migrations are explicit because they change human-authored specifications. Back up important project state before force operations or storage changes. `--force` can overwrite generated material; review its command help and the affected paths before using it.
