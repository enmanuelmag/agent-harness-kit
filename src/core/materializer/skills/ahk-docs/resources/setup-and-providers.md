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

The materializers support Claude Code, Codex CLI, Cursor, Grok Build, and OpenCode. Every provider receives project-root `AGENTS.md`, its role-agent files, its skills, and a merged MCP configuration:

| Provider | Role agents | Skills | MCP/configuration |
| --- | --- | --- | --- |
| Claude Code | `.claude/agents/*.md` | `.claude/skills/` | `.mcp.json`; also `.claude/settings.json` and `.claude/settings.local.json` |
| Codex CLI | `.codex/agents/*.toml` | `.agents/skills/` | `.codex/config.toml` |
| Cursor | `.cursor/agents/*.md` | `.cursor/skills/` | `.cursor/mcp.json`; also `.cursor/permissions.json` |
| Grok Build | `.grok/agents/*.md` | `.grok/skills/` | `.grok/config.toml` |
| OpenCode | `.opencode/agents/*.md` | `.opencode/skills/` | `opencode.json` |

Run `ahk build` after changing AHK configuration and restart or reopen the provider when it needs to reload MCP configuration.

Provider prompts and account policy determine which native model controls are available. AHK persists compatible per-agent preferences where a provider supports them. Codex's prompt-only instructions guide behavior; they do not create a security boundary or enforce a provider's permissions.

## Storage is separate from installation

- A **global CLI** is an executable on your PATH.
- **Global storage** places the harness database under the user's home-directory harness storage for a project ID.
- **Local storage** keeps the database under the project, commonly `.harness/harness.db`.

The CLI location and storage scope are independent. Agent and skill files materialized by `init` remain in the project.

## Runtime compatibility

AHK requires Node 22.14.0 or newer on 22.x, or Node 23.6.0 or newer. Earlier 23.x releases are excluded. The pinned `better-sqlite3` 13.0.3 driver uses Node-API 10; the repository build targets Node 22.

Native installation can still require a working build toolchain. [Upstream issue #1516](https://github.com/WiseLibs/better-sqlite3/issues/1516) records installation failures on Windows with npm and on Linux with pnpm; those reports do not establish an AHK failure on every platform. CI is configured to test exact Node 22.14.0 and the current 22.x release. Local compatibility evidence applies to the tested OS, architecture and package manager.


## Stable and release-candidate versions

The v2 maintenance line is `release/v2`; select and backport fixes there without the v3 MCP migration. After publication, pin a stable v2 version such as `@cardor/agent-harness-kit@2.36.2`. The v3 line is `release/v3`, currently `3.0.0-rc.1`; after publication, install `@cardor/agent-harness-kit@rc` or pin its full prerelease version. The isolated v2.36.2 cut changes only the package version from its shared committed baseline, retaining historical release tooling. Future v2 publication must specify `--tag v2` explicitly or selectively backport release guards, so a v2 patch cannot replace v3 stable at `latest`. Local release preparation and tags do not publish packages.

MCP input guidance and compiled tolerant admission are derived from one authored Zod registry. Compatibility recovery stays private and preserves existing numeric/string/JSON-array inputs, omitted keys and explicit null values. Successful responses keep their legacy text and add validated structured DTOs.

Release scripts use the checked-in manifest version. The updated release tooling maps v2 to the `v2` maintenance channel and stable v3 to `latest`; v3 RCs publish to `rc` and create GitHub prereleases that are not marked latest. Prepared tags may be reused only at the same HEAD; version tags must never be moved. After review and commit, fast-forward local `main` to the exact `release/v3` commit as an explicit release step.

Keep generated-skill downgrade protection intact; generating v2 over a v3 tree is refused. The update checker follows stable npm `latest`, so check `rc` explicitly for RC-to-RC updates. Do not regenerate provider files merely to prepare a release.
