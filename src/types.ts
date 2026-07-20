// ─── Provider ─────────────────────────────────────────────────────────────────

export type Provider = 'claude-code' | 'opencode' | 'codex-cli'

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

export type TasksAdapter = 'local' | 'jira' | 'linear' | 'mcp'

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
  /** Directory for local harness files: current.md, feature_list.json, scripts */
  dir: string
  tasks: { adapter: TasksAdapter; [key: string]: unknown }
  sections: ActionSections
  /** Stable UUID identifying this project's storage. Generated once at init
   *  via randomUUID() and never regenerated. Used to namespace the global
   *  storage directory (~/.harness/dbs/<projectId>/). */
  projectId: string
}

/** scope: 'local' — DB (and current.md fallback) live project-relative, in
 *  .harness/ (default, backward compatible). */
export interface LocalStorageConfig extends BaseStorageConfig {
  scope: 'local'
  markdownFallback: { enabled: boolean; path: string }
  /** Relative path to the sqlite .db file, resolved against cwd. Only
   *  meaningful when `database.type === 'sqlite'`. Optional — defaults to
   *  `DEFAULT_SQLITE_PATH` ('.harness/harness.db', see src/core/db.ts) when
   *  omitted. */
  sqlitePath?: string
}

/** scope: 'global' — DB (and current.md fallback) live under
 *  ~/.harness/dbs/<projectId>/, outside the project tree. There is no
 *  meaningful local path to declare for either the sqlite file or the
 *  markdown fallback under this scope — both are computed via
 *  `resolveGlobalStorageDir()` (src/core/db.ts). */
export interface GlobalStorageConfig extends BaseStorageConfig {
  scope: 'global'
  markdownFallback: { enabled: boolean }
}

/** Where the harness DB (and current.md fallback) physically lives.
 *  Discriminated on `scope` so that `scope: 'global'` configs cannot declare
 *  the now-meaningless local-only path fields (`sqlitePath`,
 *  `markdownFallback.path`) without a type error. */
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

export type AgentName = 'lead' | 'explorer' | 'consultant' | 'builder' | 'reviewer' | `custom:${string}`

export type ActionStatus = 'in_progress' | 'completed' | 'blocked'

export interface ActionRow {
  id: string
  task_id: number
  agent: AgentName
  status: ActionStatus
  created_at: string
  completed_at: string | null
  summary: string | null
}

export interface ActionSectionRow {
  id: number
  action_id: string
  section_type: string
  content: string
  created_at: string
}

export interface ActionFileRow {
  id: number
  action_id: string
  file_path: string
  operation: 'read' | 'created' | 'modified' | 'deleted'
  notes: string | null
}

export interface ActionToolRow {
  id: number
  action_id: string
  tool_name: string
  args_json: string | null
  result_summary: string | null
  called_at: string
}

// ─── feature_list.json seed format ───────────────────────────────────────────

export interface TaskSeed {
  slug: string
  title: string
  description?: string
  acceptance?: string[]
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

export interface ScaffoldOptions {
  cwd: string
  firstTask?: {
    title: string
    description: string
    acceptance: string[]
  }
}
