import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createJiti } from 'jiti'

import type { HarnessConfig } from '@/types'

const CONFIG_NAMES = [
  'agent-harness-kit.config.ts',
  'agent-harness-kit.config',
  'agent-harness-kit.config.mjs',
  'agent-harness-kit.config.cjs',
]

export function findConfigFile(cwd: string): string | null {
  for (const name of CONFIG_NAMES) {
    const candidate = join(cwd, name)
    if (existsSync(candidate)) return candidate
  }
  return null
}

export async function loadConfig(cwd: string): Promise<HarnessConfig> {
  const configPath = findConfigFile(cwd)
  if (!configPath) {
    throw new Error('No agent-harness-kit.config found. Run: ahk init')
  }

  const jiti = createJiti(import.meta.url)
  const mod = await jiti.import(configPath) as { default?: HarnessConfig } | HarnessConfig
  const config = (mod as { default?: HarnessConfig }).default ?? (mod as HarnessConfig)

  if (!config || typeof config !== 'object') {
    throw new Error(`agent-harness-kit.config must export a default HarnessConfig object.`)
  }

  return applyDefaults(config as HarnessConfig)
}

export function defineHarness(config: HarnessConfig): HarnessConfig {
  return config
}

/** Detects and normalizes the legacy contradictory config shape: `scope:
 *  'global'` declared alongside now-meaningless local-only path fields
 *  (`database.path` / `storage.sqlitePath`, `storage.markdownFallback.path`).
 *
 *  This is necessary IN ADDITION to the type-level redesign (not instead of
 *  it) because `loadConfig()` loads `agent-harness-kit.config.ts` via
 *  `jiti.import()` at runtime, which transpiles TS to JS and strips types
 *  entirely before the module is ever evaluated — a hard type error on
 *  `GlobalStorageConfig` protects authors who type-check their config file
 *  (IDE, `tsc --noEmit`), but gives ZERO protection against an existing
 *  config on disk that already has both fields set. Operates on the RAW
 *  untyped input (may not conform to the new types at all) and returns a
 *  normalized (stripped) plain object — never crashes, only warns. */
function normalizeLegacyStorageShape(raw: Record<string, unknown>): Record<string, unknown> {
  const storage = raw.storage as Record<string, unknown> | undefined
  const database = raw.database as Record<string, unknown> | undefined
  if (!storage || storage.scope !== 'global') return raw

  const offenders: string[] = []
  let normalizedStorage = storage
  let normalizedDatabase = database

  const omit = (obj: Record<string, unknown>, key: string): Record<string, unknown> =>
    Object.fromEntries(Object.entries(obj).filter(([k]) => k !== key))

  if (database && typeof database.path === 'string' && database.path) {
    offenders.push('database.path')
    normalizedDatabase = omit(database, 'path')
  }
  if (typeof storage.sqlitePath === 'string' && storage.sqlitePath) {
    offenders.push('storage.sqlitePath')
    normalizedStorage = omit(normalizedStorage, 'sqlitePath')
  }
  const markdownFallback = normalizedStorage.markdownFallback as Record<string, unknown> | undefined
  if (markdownFallback && typeof markdownFallback.path === 'string' && markdownFallback.path) {
    offenders.push('storage.markdownFallback.path')
    normalizedStorage = { ...normalizedStorage, markdownFallback: omit(markdownFallback, 'path') }
  }

  if (offenders.length === 0) return raw

  console.warn(
    `[agent-harness-kit] storage.scope is 'global' but ${offenders.join(', ')} ${offenders.length > 1 ? 'are' : 'is'} set in ` +
      `agent-harness-kit.config.ts — ${offenders.length > 1 ? 'these are' : 'this is'} ignored under global scope and will be ` +
      `removed by a future major version. See docs/architecture.md#storage-scope.`,
  )

  return { ...raw, storage: normalizedStorage, database: normalizedDatabase ?? database }
}

function applyDefaults(config: HarnessConfig): HarnessConfig {
  const normalized = normalizeLegacyStorageShape(config as unknown as Record<string, unknown>)
  const c = normalized as Partial<HarnessConfig>

  const scope: 'local' | 'global' = c.storage?.scope === 'global' ? 'global' : 'local'
  const projectId = c.storage?.projectId ?? randomUUID()
  const baseStorage = {
    dir: '.harness',
    tasks: { adapter: 'local' as const },
    sections: {
      toolsUsed: true,
      filesModified: true,
      result: true,
      blockers: true,
      nextSteps: false,
    },
  }

  const storageOverrides = (c.storage ?? {}) as Record<string, unknown>

  const storage: HarnessConfig['storage'] =
    scope === 'global'
      ? ({
          ...baseStorage,
          markdownFallback: { enabled: true },
          ...storageOverrides,
          scope: 'global',
          projectId,
        } as HarnessConfig['storage'])
      : ({
          ...baseStorage,
          markdownFallback: { enabled: true, path: '.harness/current.md' },
          ...storageOverrides,
          scope: 'local',
          projectId,
        } as HarnessConfig['storage'])

  return {
    ...(normalized as unknown as HarnessConfig),
    provider: c.provider ?? 'claude-code',
    project: {
      docsPath: './docs',
      agentsMd: './AGENTS.md',
      ...c.project,
    } as HarnessConfig['project'],
    agents: {
      lead: { instructionsPath: null },
      explorer: { instructionsPath: null },
      builder: { instructionsPath: null },
      reviewer: { instructionsPath: null },
      custom: [],
      ...c.agents,
    } as HarnessConfig['agents'],
    database: c.database ?? { type: 'sqlite' as const },
    storage,
    health: {
      scriptPath: './health.sh',
      required: true,
      ...c.health,
    },
    tools: {
      mcp: { enabled: true, port: 3742 },
      scripts: { enabled: true, outputDir: './.harness/scripts' },
      ...c.tools,
    } as HarnessConfig['tools'],
  }
}
