# CLI and configuration

Run commands from the project that contains `agent-harness-kit.config.*`.

| Command | Use |
| --- | --- |
| `ahk init` | Interactively scaffold the current directory. Flags include `--name`, `--provider`, `--docs`, and `--storage-scope local|global`. |
| `ahk build` | Reconcile generated files from configuration. `--force` overwrites existing agent files only after a backup. `--watch` rebuilds on config changes. |
| `ahk sync` | Safely synchronize generated files. `--force` backs up agent files; `--keep-models` reuses saved choices; `--capture-models` imports current-provider metadata. |
| `ahk models` | Re-prompt compatible per-role model settings for Claude Code, Codex CLI, or Cursor. |
| `ahk health` | Run the configured native health script manually and statelessly. |
| `ahk status` | Show tasks and active actions; `--json` is available. |
| `ahk dashboard` | Serve the local dashboard; `--port` accepts 1–65535 and `--no-open` avoids opening a browser. |
| `ahk serve` | Start the stdio MCP server; `--port` stores an optional port hint. |
| `ahk doctor` | Read-only check of package version, agent-file presence, and generated skill state. Agent files are existence-only checks; canonical skill manifests/resources are byte-checked for missing or outdated bytes. |
| `ahk export` | Export database content. Use `--sql` or `--json`, with `--output` for a file. |
| `ahk reset` | Clear harness data or provider agent files. `--force` skips confirmation. |
| `ahk migrate provider` | Migrate provider-specific material; the legacy `ahk migrate` form remains an alias. |
| `ahk migrate storage` | Preview or migrate local/global and database storage. `--dry-run` previews; `--force` is required for a non-empty destination and writes a backup first. |
| `ahk migrate specs` | Preview legacy specification-kind migration. Use `--apply` only after reviewing the preview. |

`task add`, `task list`, `task edit`, and `task done <id|slug>` are interactive or direct CLI helpers. `ahk export --json` writes JSON to stdout unless `--output` is provided. SQL export currently reports the direct-SQLite alternative instead of generating a dump. `ahk reset` can delete the managed SQLite database (including WAL/SHM) after confirmation or with `--force`; `--provider <provider>` additionally offers removal of that provider's five role files. It does not reset remote databases.

`ahk models` prompts current native choices for Claude Code, Codex CLI, or Cursor. `ahk sync --capture-models` reads those current provider role files into saved preferences; it cannot be combined with force or keep-models. `ahk sync --force --keep-models` reuses saved preferences and prompts only for missing roles before regenerating agent files with backups.

## Configuration and generated files

The configuration records project metadata, provider, docs location, database and storage options, health-script path, and MCP settings. `init` selects a suitable supported config format for the project; do not rely on a particular extension without inspecting what it generated.

For a typed project configuration, the important shape is:

```ts
import type { HarnessConfig } from '@cardor/agent-harness-kit'

const config: HarnessConfig = {
  project: { name: 'my-project', description: '...', docsPath: './docs' },
  provider: 'codex-cli',
  database: { type: 'sqlite' },
  storage: {
    dir: '.harness',
    tasks: { adapter: 'mcp' },
    sections: { toolsUsed: true, filesModified: true, result: true, blockers: true, nextSteps: false },
    scope: 'local',
    projectId: 'stable-project-id',
  },
  health: { scriptPath: './health.sh', required: true },
  tools: { mcp: { enabled: true, port: 3742 }, scripts: { enabled: true, outputDir: './.harness/scripts' } },
}

export default config
```

With local SQLite storage, the default path is `.harness/harness.db`. With global SQLite storage, the file is exactly `~/.harness/dbs/<projectId>/harness.db` (resolved from the platform home directory, not an environment-variable assumption). A global scope ignores a local SQLite path override.

The provider materializer creates `AGENTS.md`, native provider agent files, MCP configuration, and skills. Existing agent files are user-owned: normal build creates missing files and preserves existing files. Skills are generated inventory: doctor can report missing or outdated canonical resources.

Claude configuration reads project-root `.mcp.json`. Codex, Cursor, Grok Build, and OpenCode receive their native project files. Restart or reopen the provider after changes that require it to reload MCP configuration.
