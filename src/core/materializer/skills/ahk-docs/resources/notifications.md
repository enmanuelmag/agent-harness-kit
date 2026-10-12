# Optional local sound notifications

Notifications are opt-in and disabled by default. They run locally for CLI/MCP and managed provider hooks; cloud agents and remote MCP audio are unsupported. No sounds are emitted for action completion, isolated green health, reading a done task, or transient checking/verifying/repair modes. Task completion requires a committed verified close; a new blocked health episode may notify, while repeated diagnostic failures of the same episode do not.

## Configuration and commands

```ts
notifications: {
  enabled: true,
  categories: {
    'task.completed': true,
    'health.blocked': true,
    'provider.completed': true,
    'attention.requested': true,
  },
  sounds: {
    'task.completed': 'task-completed.wav',
    'health.blocked': 'health-blocked.wav',
    'provider.completed': 'turn-completed.wav',
    'attention.requested': 'attention.wav',
  },
  pendingWaitMs: 1500,
  playerTimeoutMs: 3000,
}
```

Precedence is defaults, global `~/.config/agent-harness-kit/notifications.json`, base project configuration, then managed `agent-harness-kit.config.local.json` per field/category. Explicit scoped configuration commands atomically merge JSON and preserve executable base config bytes, unrelated settings and existing private file permissions. Malformed files, symlinks and concurrent writes are reported rather than overwritten. `--unset` restores inheritance; an explicit project disable overrides global enable. Ledger row/age caps remain global. Only the four packaged WAV names are accepted. Categories default enabled once the overall switch is enabled; set a category false to disable it. Assets are resolved from the installed package, never from project cwd; no conversion or FFmpeg is needed at runtime.

`ahk init` asks two independent default-off questions: activate optional sounds, and install managed project hooks. `--notifications`/`--no-notifications` and `--notification-hooks`/`--no-notification-hooks` skip their respective question; `--notification-scope project|global` selects where activation is stored. Existing setups use:

```sh
ahk notifications enable --scope project
ahk notifications disable --scope global
ahk notifications configure --scope project --patch '{"categories":{"provider.completed":false}}'
ahk notifications configure --scope project --unset enabled
```

MCP equivalents are `ahk.notifications.status`, `configure`, `enable`, `disable`, `install`, `uninstall`, and `ahk.notify.attention`. Writes require explicit scope. Active notification services refresh bounded settings in the same session. Hook installation remains project-local and independent of global activation.

- `ahk notifications status [--json]`: settings, ledger location and asset paths, without opening the ledger.
- `ahk notifications install --provider cursor|claude-code|codex-cli|opencode`: explicitly merge owned project hooks or create the owned OpenCode plugin. Re-installation is idempotent; conflicts/edited entries are preserved and reported.
- `ahk notifications uninstall --provider ...`: remove only verified unedited owned entries. Unrelated hooks, editor options and inline TOML remain intact.
- `ahk notify attention --request-id <stable-id>`: explicitly request workflow attention; reusing the same request ID deduplicates that cause. Use a different ID for a new question/permission.

Internal `notifications hook` reads at most 256 KiB JSON, and `notifications deliver` runs a leased event. Both are quiet/benign on malformed input, missing settings, unsupported capabilities or delivery failures; they do not print update banners or fatal diagnostics into host protocols.

## Delivery and deduplication

CLI and MCP publish after confirmed business writes, outside their transactions. A versioned JSON text marker (`notificationSchemaVersion:1`, `events`) is appended separately after MCP DTO validation and notices; primary text, structuredContent and isError are preserved. Hook adapters verify exact marker blocks against stored event/project identity and associate actual host conversation/turn IDs. Assistant prose and recent-sound timing are never used as evidence.

A successful specific task/blocked event suppresses general completion only for its exact provider/project/session/turn. Other turns/projects/conversations do not inherit suppression. Attention is independent, including a new request after DONE. For a known main completion, missing true turn IDs or trustworthy tool-result boundaries allow general fallback instead of guessing correlation. OpenCode must also verify main-session metadata; unknown parent classification does not emit generic completion. Repeated Stop with the same true turn and repeated event IDs are idempotent within retention limits. Terminal bindings are filtered by TTL before suppression, and their associated specific event must still exist, be fresh and played; expired or evicted evidence allows fallback.

Workers reserve one owner lease 5s. Playback has a whole-event deadline of at most 3s; health-blocked.wav contains a composed double pulse and plays once as one event/deduplication unit. Its first pulse is shortened before the natural tail ends, followed by a brief connection gap; the second pulse keeps its complete fade-out. Completion hooks poll pending events for up to 1500ms at 25ms intervals, then may fall back. Partial failure, unsupported playback, expired pending/lease or unavailable ledger cannot suppress forever. Expired ambiguous workers are not replayed automatically. This is best-effort, not a crash-proof exactly-once guarantee; played means the player exited successfully, not that a user heard audio.

macOS uses system afplay. Linux uses available paplay or aplay. Windows currently degrades to a quiet skip. No player is downloaded or installed. Player output is discarded; notification failures never change health gates, task state, CLI business exits or stdout JSON/MCP. No physical audio QA or universal native host support is established by simulated provider tests.

## Provider capabilities and native preferences

| Provider | Project install | Correlation and events |
| --- | --- | --- |
| Cursor | `.cursor/hooks.json` | afterMCPExecution result_json, conversation_id/generation_id; completed main stop. No documented universal attention hook. |
| Claude Code | `.claude/settings.json` | MCP PostToolUse with real session_id/prompt_id when supplied; main Stop; relevant Notification types permission_prompt, idle_prompt, elicitation_dialog. Missing prompt IDs cannot suppress by session alone. |
| Codex | `.codex/hooks.json` | MCP PostToolUse, Stop and PermissionRequest with reported session_id/turn_id. Review/trust through /hooks; inline TOML/feature flags unchanged. |
| OpenCode | `.opencode/plugins/ahk-notifications.js` | tool.execute.after structured output/metadata; session.status and permission.asked. Only observed idle-to-busy/retry creates a generation; repeated busy stays stable. Restart epochs isolate old turns; unknown/midturn startup cannot suppress. Generic completion requires verified main Session info; child/unknown sessions do not emit it. Errors are not completion. |

OpenCode parent classification uses a verified full SDK Session object from `session.created`/`session.updated` `properties.info` or `client.session.get({ path: { id } }).data`. A present parentID identifies a child; its absence identifies a main session only after the full object is validated. Partial or missing metadata is unknown, not main. Bounded/caught lookup and per-session ordering prevent idle lookup from reordering later busy/tool events. Known-main sessions without an observed turn start may emit general fallback; child and unknown-parent sessions retain genuine AHK marker binding and permission attention without generic completion. Cache and queues are bounded, and restart loses unverified classification safely.

Adapters follow the documented payload contracts reviewed for this implementation; future host versions may omit IDs or change result transport. Fixtures validate supported shapes, not real execution in every host/version. MCP events from secondary agents may bind only reported true IDs; no parent lineage is inferred, and generic completion is never played per subagent. Unsupported/missing shapes degrade conservatively.

AHK cannot selectively mute Cursor native sounds by event. To replace general completion, manually disable the corresponding native sound before enabling managed hooks. Keeping native audio may duplicate sounds. Installer output explains manual steps; native visual/attention notifications remain available, and unsupported native-attention deduplication is not guaranteed. No personal editor preference, cloud setting, trust flag or generic provider tree is regenerated.

## Ledger, privacy and retention

The separate global ledger lives at `~/.config/agent-harness-kit/notifications.db`, based on the user running MCP/hooks, independent of task storage or cwd. Real normalized worktree path plus projectId produces a hash; separate worktrees remain isolated. Only event/category/project/task identities, hashed provider session/turn IDs, status/lease/timestamps and bounded episode/binding records are stored—no prompts, transcripts, generated answers, SQL or business data.

New dedicated parent directories use 0700 and the DB 0600 where supported. Existing shared directories are not chmodded. Schema incompatibility disables notifications safely instead of dropping/recreating the registry. SQLite WAL and a 50ms busy timeout coordinate short atomic reservations across processes; there is no growing server connection registry or full-table history cache.

Default retention is **1000 rows total across events, bindings and episodes /24 hours globally**, not per project. Only the optional global configuration can reduce `maxRecords` (10–1000) or `maxAgeMs` (1000–86400000); project overrides do not change other projects' global retention policy. Pruning uses bounded victim batches. Retention/eviction can degrade deduplication, but never leave a turn suppressed indefinitely. SQLite reusable free pages/WAL mean row caps are not an exact disk-size promise. No VACUUM or task-data cleanup is performed by this feature.
