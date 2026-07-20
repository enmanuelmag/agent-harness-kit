export { defineHarness } from '@/core/config'
export type {
  ActionRow,
  ActionSections,
  ActionStatus,
  // BREAKING (removed): `AgentConfig`, `AgentsConfig` and `CustomAgentConfig`
  // were removed along with the `agents` config key. `AgentName` is unrelated
  // and stays. See the note in src/types.ts.
  AgentName,
  HarnessConfig,
  HealthConfig,
  ProjectConfig,
  Provider,
  StorageConfig,
  TaskRow,
  TasksAdapter,
  TaskSeed,
  TaskStatus,
  ToolsConfig,
} from '@/types'
