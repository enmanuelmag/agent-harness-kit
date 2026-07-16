// ─── Provider ─────────────────────────────────────────────────────────────────

export type Provider = 'claude-code' | 'opencode' | 'codex-cli'

// ─── Config types ─────────────────────────────────────────────────────────────

export interface ProjectConfig {
  name: string
  description: string
  docsPath: string
  agentsMd?: string | null
}

export interface AgentConfig {
  instructionsPath: string | null
  context?: string
  allowedPaths?: string[]
  writablePaths?: string[]
  model?: string
}

export interface CustomAgentConfig {
  name: string
  instructionsPath: string
}

export interface AgentsConfig {
  lead: AgentConfig
  explorer: AgentConfig
  builder: AgentConfig
  reviewer: AgentConfig
  /** Optional — the consultant agent has no dedicated config entry elsewhere;
   *  this exists primarily to carry a per-agent `model` override. */
  consultant?: AgentConfig
  custom?: CustomAgentConfig[]
}

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
  /** Path to the .db file, relative to cwd */
  path: string
}

export interface RemoteDBConfig {
  type: 'postgres' | 'mysql'
  /** Full connection URL — postgres://user:pass@host:5432/db or mysql://... */
  connectionString: string
}

export type DatabaseConfig = SQLiteConfig | RemoteDBConfig

export interface StorageConfig {
  /** Directory for local harness files: current.md, feature_list.json, scripts */
  dir: string
  tasks: { adapter: TasksAdapter; [key: string]: unknown }
  sections: ActionSections
  markdownFallback: { enabled: boolean; path: string }
  /** Where the harness DB (and current.md fallback) physically lives.
   *  'local' — project-relative, in .harness/ (default, backward compatible).
   *  'global' — under ~/.harness/dbs/<projectId>/, outside the project tree. */
  scope: 'local' | 'global'
  /** Stable UUID identifying this project's storage. Generated once at init
   *  via randomUUID() and never regenerated. Used to namespace the global
   *  storage directory (~/.harness/dbs/<projectId>/). */
  projectId: string
}

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
  agents: AgentsConfig
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
