# Setup and providers

Choose one global installation command, then initialize each project from its own directory:

```bash
pnpm add -g @cardor/agent-harness-kit
# or: npm install -g @cardor/agent-harness-kit
# or: bun add -g @cardor/agent-harness-kit
# Yarn Classic (v1) only: yarn global add @cardor/agent-harness-kit

ahk init
```

Yarn Modern (Berry) removed `yarn global`; use the pnpm, npm, or Bun global command instead. Then run `ahk init`. It scaffolds the current directory, creating provider-specific agent and MCP configuration, the project configuration, a native health-script starter when missing, and harness storage. It does not create a provider scaffold under the user's home directory.

## Providers

The materializers support Claude Code, Codex CLI, Cursor, Grok Build, OpenCode, and OpenCode V2. Every provider receives project-root `AGENTS.md`, its role-agent files, its skills, and a merged MCP configuration:

| Provider | Role agents | Skills | MCP/configuration |
| --- | --- | --- | --- |
| Claude Code | `.claude/agents/*.md` | `.claude/skills/` | `.mcp.json`; also `.claude/settings.json` and `.claude/settings.local.json` |
| Codex CLI | `.codex/agents/*.toml` | `.agents/skills/` | `.codex/config.toml` |
| Cursor | `.cursor/agents/*.md` | `.cursor/skills/` | `.cursor/mcp.json`; also `.cursor/permissions.json` |
| Grok Build | `.grok/agents/*.md` | `.grok/skills/` | `.grok/config.toml` |
| OpenCode (v1) | `.opencode/agents/*.md` | `.opencode/skills/` | `opencode.json` |
| OpenCode V2 | `.opencode/agents/*.md` | `.opencode/skills/` | `opencode.json(c)` in root or `.opencode/`; native `mcp.servers` |

Run `ahk build` after changing AHK configuration and restart or reopen the provider when it needs to reload MCP configuration.

Provider prompts and account policy determine which native model controls are available. AHK persists compatible per-agent preferences where a provider supports them. Codex's prompt-only instructions guide behavior; they do not create a security boundary or enforce a provider's permissions.

## Storage is separate from installation

- A **global CLI** is an executable on your PATH.
- **Global storage** places the harness database under the user's home-directory harness storage for a project ID.
- **Local storage** keeps the database under the project, commonly `.harness/harness.db`.

The CLI location and storage scope are independent. Agent and skill files materialized by `init` remain in the project.

## Runtime compatibility

AHK requires Node 22.14.0 or newer on 22.x, or Node 23.6.0 or newer. Earlier 23.x releases are excluded. The pinned `better-sqlite3` 13.0.3 driver uses Node-API 10; the repository build targets Node 22.

Native installation can still require a working build toolchain. [Upstream issue #1516](https://github.com/WiseLibs/better-sqlite3/issues/1516) records installation failures on Windows with npm and on Linux with pnpm; those reports do not establish an AHK failure on every platform. General CI tests exact Node 22.14.0 and the current 22.x release on Ubuntu. A focused Windows job exercises native health execution on Node 22.14.0 and 24.x. Local compatibility evidence applies to the tested OS, architecture and package manager.


## Stable and release-candidate versions

The v2 maintenance line is `release/v2`; select and backport fixes there without the v3 MCP migration. Version `2.36.1` is published and `2.37.0` is prepared but not yet published. The v3 line is `release/v3`: version `3.6.0` is published on `latest` and `3.7.0` is prepared but not yet published. After publication, pin the intended version or use `latest` for stable v3. For release candidates, use `@cardor/agent-harness-kit@rc` or pin the full prerelease version. The prepared v2 release script uses the `v2` npm channel and marks its GitHub release `--latest=false`, so it does not replace v3 stable at `latest`. Preparing a release does not publish it.

MCP input guidance and compiled tolerant admission are derived from one authored Zod registry. Compatibility recovery stays private and preserves existing numeric/string/JSON-array inputs, omitted keys and explicit null values. Successful responses keep their legacy text and add validated structured DTOs.

Release scripts use the checked-in manifest version. The updated release tooling maps v2 to the `v2` maintenance channel and stable v3 to `latest`; v3 RCs publish to `rc` and create GitHub prereleases that are not marked latest. Prepared tags may be reused only at the same HEAD; version tags must never be moved. After review and commit, fast-forward local `main` to the exact `release/v3` commit as an explicit release step.

Keep generated-skill downgrade protection intact; generating v2 over a v3 tree is refused. The update checker follows stable npm `latest`, so check `rc` explicitly for RC-to-RC updates. Do not regenerate provider files merely to prepare a release.

## Windows health correction in 3.2.0

To obtain the correction, update the AHK installation your project uses to published version 3.6.0 or later: `pnpm add -g @cardor/agent-harness-kit@3.6.0` for the global CLI, or `pnpm add -D @cardor/agent-harness-kit@3.6.0` for a project dependency. Restart the provider or reconnect its MCP server, then run `ahk health` again. Existing scripts and `health.scriptPath` stay unchanged; no `ahk init`, regeneration, or Claude repair prompt is needed for this fix. The corrected runner is used by manual/MCP health and task health gates automatically once the updated process is running. AHK only reports available updates; it does not install them automatically.

The correction fixes Windows command quoting for `health.bat`, including paths with spaces and shell punctuation. A green `ahk doctor` validates setup artifacts but does not establish that the native health script passes.

## OpenCode V2 compatibility

Use provider `opencode-v2` for native v2 configuration. Read [the V2 guide](opencode-v2.md) before switching an existing `.opencode` project. V1 and V2 share paths and executable names; AHK never installs or changes global OpenCode settings.
