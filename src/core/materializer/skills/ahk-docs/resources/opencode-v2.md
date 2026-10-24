# OpenCode V2

## Select and configure

Select `OpenCode V2` in `ahk init` or migrate an existing project with `ahk migrate --to opencode-v2`. The original `opencode` provider continues generating v1 configuration. AHK does not install either runtime, change your PATH or edit global OpenCode configuration. Both versions use the same executable and `.opencode` directories; this is a format selection, not side-by-side isolation.

Project configuration is inspected at `opencode.json`, `opencode.jsonc`, `.opencode/opencode.json` and `.opencode/opencode.jsonc`. A new project uses root `opencode.json`. An existing unambiguous AHK entry determines the editing target; multiple AHK entries or multiple unrelated candidate files without a clear target require consolidation. Invalid JSONC, duplicate keys, invalid MCP shape and symlinked paths fail without replacing source bytes. Localized JSONC edits preserve comments, other servers and settings. Existing explicit native server settings are preserved; edit your command intentionally if changing an existing custom MCP invocation.

The AHK server remains local stdio with the detected package manager's command. Native configuration lives under `mcp.servers.agent-harness-kit`, using `disabled` and `codemode: false` for new entries. The default legacy MCP protocol is retained. Other servers, OAuth settings and global policies are not converted. AHK's v2 compaction defaults use `auto` and `buffer`; it does not generate ignored `prune`/`reserved` fields.

## Agents, skills and model preferences

The five role files remain `.opencode/agents/<role>.md`. Lead is `primary`; explorer, consultant, builder and reviewer are `subagent`. Frontmatter is entirely v2, with folded descriptions retained, `permissions` arrays and optional `model`. Lead invokes the `subagent` tool with agent, description and prompt. Children receive fresh, bounded context; wait for dependent results. Existing skills and resources stay under `.opencode/skills/<id>/SKILL.md`, and project instructions stay in `AGENTS.md`. AHK does not duplicate skills into slash commands.

`ahk models` and explicit regeneration collect per-role native references such as `team/model#high`, or inheritance. These refer to models/variants configured in OpenCode; AHK validates syntax without inventing a catalog or promising model availability. Preferences are stored under `agentPreferences['opencode-v2']`. `ahk sync --capture-models` captures canonical native model metadata including the `#variant`. `ahk sync --force --keep-models` retains saved choices. A safe ordinary build preserves existing agent files and recreates missing ones with saved preferences. Force regeneration backs up previous files.

Nonimplementers deny edit and shell by default; exact inspection commands are allowed. Reviewer also receives explicit standard health/test/build commands, which may produce local artifacts. Builder may edit and asks for shell approval. Lead may delegate to the four child roles. OpenCode rules use last match precedence, and administrator policies can still restrict them. Permissions are tool controls, not an OS sandbox. The v2 defaults retain asking before external-directory access rather than silently inheriting v2's broader default.

## Migration and recovery

A provider migration inspects the shared configuration and role files before generating anything. Recognized unmodified canonical v1 role files and the generated v1 MCP entry can be converted; a customized v1 role, transport or plugin produces a conflict even if force was requested. Resolve custom content explicitly before repeating the migration. Native v2 customized role files remain preserved. Unrelated plugins, commands, credentials and provider definitions are not converted.

The maintenance result reports a backup directory under `.harness/backups/maintenance-<id>`. It contains the previous files before conversion, including the managed provider overlay, skills state and owned notification manifests when present. Review the result and keep the directory until validation is complete. Generation finishes before the provider overlay is changed. Multi-file filesystem operations are not a global atomic transaction; a later write failure requires recovery from the verified backup.

Returning directly with `ahk migrate --to opencode` is refused while the current provider is v2. Recover the pre-v2 setup first:

1. Stop the project's OpenCode service and AHK watcher. Preserve any files you edited after migration separately.
2. Review the reported backup against the current AHK role/config/plugin files. Restore only the files actually transformed by AHK, not entire shared directories or unrelated user files.
3. Restore the prior managed provider overlay if it existed; if migration created it, remove only the new provider/preference changes after reviewing any later edits. The base executable configuration is not rewritten by provider migration.
4. Restore the matching skills state and owned notification manifest with their original files. Remove the newly generated owned v2 plugin only when unmodified; restore the owned v1 plugin from its backup if one existed.
5. Verify the provider reports `opencode`, the AHK MCP entry/agents use v1, and the intended v1 binary is selected before restarting it. Re-run doctor and project checks. Do not feed native v2-only shapes to v1 or auto-convert unrelated v2 settings.

For a failure before a successful migration, use the same reported backup/review process. Never restore over later personal edits without preserving them. Reset refuses customized shared v2 role files rather than deleting them merely because their filenames are canonical.

## Notifications and diagnostics

Install explicitly using `ahk notifications install --provider opencode-v2`; uninstall removes only hash-verified owned content. The local plugin uses the OpenCode v2 host-provided plugin API. AHK does not install dependencies into your project to resolve that API. Owned v1 plugins are retired during migration to avoid duplicate discovery; customized plugins are preserved as conflicts.

The v2 adapter uses durable execution IDs, verifies parent/location, binds successful structured AHK MCP output, and emits completion only on successful main-session execution. Idle, failure, interruption and child sessions do not produce success. Queues and processes are bounded; cleanup cancels subscriptions and active children. Delivery remains best-effort and disabled by default unless project/global notification settings enable it. It never changes task/health results or implies audible playback.

`ahk doctor` and MCP `ahk.doctor` include additive `opencodeV2` diagnostics for effective config path, legacy/native conflicts, agent modes/permissions, incompatible v1 plugin and the binary version found on PATH. Doctor does not run a model session: `runtimeVerified` is always false. Missing or v1 binaries are reported without installation. Existing doctor lib/agent/skill output remains unchanged for other providers.

## Verification boundary

The integration target exercised was isolated OpenCode 2.1.4. A deterministic local OpenAI-compatible HTTP provider allowed real host sessions without personal model credentials: generated agents and complete descriptions, skill load, explorer child, actual AHK MCP stdio call, variant/effort propagation, denied shell writes and allowed inspection all executed. The generated v2 plugin produced one MCP bind and one parent completion with the same execution identity; no child completion was recorded. These prove host contracts and orchestration, not paid-model reasoning quality or physical audio delivery.

Automated tests separately verify JSONC preservation and errors, idempotence, conflicts, shared-path migration/backups, model preferences/capture, permissions, event normalization and owned plugin installation. The existing notification ledger/player tests remain applicable to normalized v2 HookActions. Record full health and review results separately; a valid generated JSON file alone is not proof of runtime integration.

Official references: [migration](https://opencode.ai/v2/docs/migrate-v1/), [MCP](https://opencode.ai/v2/docs/mcp-servers/), [agents](https://opencode.ai/v2/docs/agents/), [permissions](https://opencode.ai/v2/docs/permissions/), [plugins](https://opencode.ai/v2/docs/build/plugins/migrate-v1/).
