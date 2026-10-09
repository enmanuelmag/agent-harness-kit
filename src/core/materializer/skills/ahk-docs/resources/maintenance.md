# Maintenance and upgrades

Use `ahk build` to materialize generated agent, MCP, and skill files after configuration changes. Use `ahk sync` when its synchronization workflow is appropriate for the project. `ahk doctor` is read-only: it reports package/update notices, agent-file presence, and canonical skill drift; it never applies migrations or rewrites generated files.

Doctor checks agents by existence only because their bodies and frontmatter are user-owned. It byte-compares each canonical skill manifest and resource against the packaged source (with provider guidance applied to manifests), so a missing or edited skill can be reported as missing or outdated.

Some lifecycle responses and maintenance commands may check for updates. Those network checks are optional and cached; ordinary local workflow and bundled documentation do not require network access.

Generated skills have a project-local migration state. When a newer AHK package introduces a migration, `build` and `sync` apply eligible migrations in version order and record checkpoints so interrupted work can resume. They can remove only known generated files whose bytes still prove ownership. Unknown or customized files are preserved and reported for review; doctor only reports the resulting state.

Document migrations are explicit because they change human-authored specifications. Back up important project state before force operations or storage changes. `--force` can overwrite generated material; review its command help and the affected paths before using it.
