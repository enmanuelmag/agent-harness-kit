// ─── Provider ─────────────────────────────────────────────────────────────────

export type Provider = 'claude-code' | 'opencode' | 'codex-cli' | 'grok-cli' | 'cursor'

// ─── Config types ─────────────────────────────────────────────────────────────

export interface ProjectConfig {
  name: string
  description: string
  docsPath: string
  agentsMd?: string | null
}

/* NOTE: the whole `agents` config key was removed, along with the
 * `AgentConfig` / `AgentsConfig` / `CustomAgentConfig` types (which were also
 * part of the public API — see src/index.ts). It configured four things and
 * delivered none of them:
 *
 *   - `allowedPaths` / `writablePaths` — prompt text only, never enforced by
 *     any provider (removed earlier; see git history).
 *   - `instructionsPath` and `context`  — written by the config generator but
 *     never read by anything.
 *   - `custom`                          — emitted as `[]` and never consumed.
 *   - `model`                           — the only field with an effect, and it
 *     is redundant: the generated agent file is now user-owned, so the `model:`
 *     line is edited directly in `.claude/agents/<role>.md` (or the provider's
 *     equivalent), which is where every other per-agent setting already lives.
 *
 * What a role may NOT do is enforced per-tool by AGENT_RESTRICTIONS
 * (src/core/materializer/agent-restrictions.ts), which each provider translates
 * natively (Claude Code `disallowedTools`, OpenCode `permission.edit`, Codex
 * `sandbox_mode`). Configs on disk that still declare `agents` are accepted,
 * ignored, and warned about — see `normalizeLegacyAgentsKey()` in
 * src/core/config.ts.
 *
 * Do NOT confuse this with the `AgentName` type below — that is the agent
 * identifier used by the DB and MCP layers, and it is unaffected. */

export type TasksAdapter = 'mcp'

export interface ActionSections {
  toolsUsed: boolean
  filesModified: boolean
  result: boolean
  blockers: boolean
  nextSteps: boolean
}

export interface SQLiteConfig {
  type: 'sqlite'
}

export interface RemoteDBConfig {
  type: 'postgres' | 'mysql'
  /** Full connection URL — postgres://user:pass@host:5432/db or mysql://... */
  connectionString: string
}

/** Describes which DB *engine* to use. Physical location (where the sqlite
 *  file lives) is a `storage` concern, not a `database` one — see
 *  `LocalStorageConfig.sqlitePath` / `DEFAULT_SQLITE_PATH` (src/core/db.ts).
 *  `RemoteDBConfig` is scope-independent (a connection string is the same
 *  regardless of local/global) and is untouched by that split. */
export type DatabaseConfig = SQLiteConfig | RemoteDBConfig

interface BaseStorageConfig {
  /** Directory for harness metadata and scripts. Task state stays in the MCP database. */
  dir: string
  tasks?: { adapter: TasksAdapter; [key: string]: unknown }
  sections: ActionSections
  /** Stable UUID identifying this project's storage. Generated once at init
   *  via randomUUID() and never regenerated. Used to namespace the global
   *  storage directory (~/.harness/dbs/<projectId>/). */
  projectId: string
}

/** scope: 'local' — DB lives project-relative in .harness/. */
export interface LocalStorageConfig extends BaseStorageConfig {
  scope: 'local'
  /** Relative path to the sqlite .db file, resolved against cwd. Only
   *  meaningful when `database.type === 'sqlite'`. Optional — defaults to
   *  `DEFAULT_SQLITE_PATH` ('.harness/harness.db', see src/core/db.ts) when
   *  omitted. */
  sqlitePath?: string
}

/** scope: 'global' — DB lives under ~/.harness/dbs/<projectId>/. */
export interface GlobalStorageConfig extends BaseStorageConfig {
  scope: 'global'
}

/** Where the harness database physically lives. */
export type StorageConfig = LocalStorageConfig | GlobalStorageConfig

/** Shape of .harness/storage-state.json — always written to the project,
 *  regardless of scope. Reflects the REAL current state of storage (as
 *  opposed to agent-harness-kit.config.ts, which reflects the DESIRED
 *  state). Consumed by `ahk migrate storage` (future). Format is stable —
 *  do not change field names/shape without a migration plan. */
export interface StorageState {
  scope: 'local' | 'global'
  projectId: string
  dbType: 'sqlite' | 'postgres' | 'mysql'
  migratedAt: string
}

export interface HealthConfig {
  scriptPath: string
  required: boolean
}

export interface ToolsConfig {
  mcp: { enabled: boolean; port: number }
  scripts: { enabled: boolean; outputDir: string }
}

export interface HarnessConfig {
  project: ProjectConfig
  provider: Provider
  storage: StorageConfig
  database: DatabaseConfig
  health: HealthConfig
  tools: ToolsConfig
}

// ─── SQLite row types ─────────────────────────────────────────────────────────

export type TaskStatus = 'pending' | 'in_progress' | 'done' | 'blocked'

export interface TaskRow {
  id: number
  slug: string
  title: string
  description: string | null
  status: TaskStatus
  assigned_to: string | null
  created_at: string
  started_at: string | null
  completed_at: string | null
  archived_at: string | null
  updated_at: string
}

export interface TaskAcceptanceRow {
  id: number
  task_id: number
  criterion: string
  met: number
}

export type AgentName =
  'lead' | 'explorer' | 'consultant' | 'builder' | 'reviewer' | `custom:${string}`

export type ActionStatus = 'in_progress' | 'completed' | 'blocked'

export interface ActionRow {
  id: number
  task_id: number
  agent: AgentName
  status: ActionStatus
  created_at: string
  completed_at: string | null
  summary: string | null
}

export interface ActionSectionRow {
  id: number
  action_id: number
  section_type: string
  content: string
  created_at: string
}

// ─── MCP tool result helpers ──────────────────────────────────────────────────

export interface McpContent {
  type: 'text'
  text: string
}

export interface McpToolResult {
  content: McpContent[]
  isError?: boolean
}

// ─── Materializer interface ───────────────────────────────────────────────────

/** Codex returns the supported effort names for each available model at
 * runtime. Keep this open so a newly supported effort can be persisted
 * verbatim instead of being rejected by a stale compile-time catalog. */
export type CodexReasoningEffort = string

/** A single role's Codex CLI model + reasoning-effort choice, collected by
 *  `ahk init`'s Codex-conditional prompt (`promptCodexAgentModels`) and
 *  written into that role's generated `.codex/agents/<role>.toml`.
 *
 *  `model` and `effort` are plain strings because the live App Server catalog
 *  is the source of truth and both values are persisted exactly as selected. */
export interface CodexAgentModelChoice {
  model?: string
  effort?: CodexReasoningEffort
}

/** Cursor keeps model options in its single `model` frontmatter scalar. `auto`
 * and every discovered model ID must be written literally; `inherit` omits the
 * scalar altogether. */
export interface CursorAgentModelChoice {
  model?: string
}

export interface ScaffoldOptions {
  cwd: string
  firstTask?: {
    title: string
    description: string
    acceptance: string[]
  }
  /** Claude Code only: per-role model choice collected by `ahk init`'s
   *  provider-conditional prompt, keyed by the materializer's `AgentName`
   *  (lead/explorer/consultant/builder/reviewer). Consumed exclusively by
   *  `ClaudeCodeMaterializer.scaffold()` to inject a `model:` frontmatter line
   *  into each role's generated `.claude/agents/<role>.md` at scaffold time —
   *  never persisted to config. Optional and provider-specific-in-practice,
   *  but declared on the shared `ScaffoldOptions` type since `Materializer`
   *  exposes one `scaffold(config, opts)` signature across all providers;
   *  OpenCode's and Codex CLI's materializers simply never read this field. */
  claudeAgentModels?: Partial<
    Record<'lead' | 'explorer' | 'consultant' | 'builder' | 'reviewer', string>
  >
  /** Codex CLI only: per-role model + reasoning-effort choice collected by
   *  `ahk init`'s provider-conditional prompt (`promptCodexAgentModels`).
   *  Consumed exclusively by `CodexCliMaterializer.scaffold()` to inject
   *  `model = "..."` / `model_reasoning_effort = "..."` lines into each
   *  role's generated `.codex/agents/<role>.toml` at scaffold time — never
   *  persisted to config.toml, which carries its own separate top-level
   *  default (see `ensureTomlTopLevelKey` in mcp-merge.ts). Mirrors
   *  `claudeAgentModels` above; Claude Code's and OpenCode's materializers
   *  simply never read this field, exactly as claude-code.ts's materializer
   *  never reads `claudeAgentModels`'s Codex counterpart. */
  codexAgentModels?: Partial<
    Record<'lead' | 'explorer' | 'consultant' | 'builder' | 'reviewer', CodexAgentModelChoice>
  >
  cursorAgentModels?: Partial<
    Record<'lead' | 'explorer' | 'consultant' | 'builder' | 'reviewer', CursorAgentModelChoice>
  >
}
