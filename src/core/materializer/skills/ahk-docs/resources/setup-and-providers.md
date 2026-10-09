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

The package manifest currently declares Node `>=14`, while the default SQLite driver and the repository's tested development flow target Node 22 or Bun. Treat Node 22 or current Bun as the supported path until runtime compatibility is aligned and verified; the manifest alone is not proof that every feature runs on older Node releases.
