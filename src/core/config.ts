import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createJiti } from 'jiti'

import type { HarnessConfig } from '@/types'

const CONFIG_NAMES = [
  'agent-harness-kit.config.ts',
  'agent-harness-kit.config',
  'agent-harness-kit.config.mjs',
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

function applyDefaults(config: HarnessConfig): HarnessConfig {
  const c = config as Partial<HarnessConfig>
  return {
    ...config,
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
    database: c.database ?? { type: 'sqlite' as const, path: '.harness/harness.db' },
    storage: {
      dir: '.harness',
      tasks: { adapter: 'local' as const },
      sections: {
        toolsUsed: true,
        filesModified: true,
        result: true,
        blockers: true,
        nextSteps: false,
      },
      markdownFallback: { enabled: true, path: '.harness/current.md' },
      ...c.storage,
    } as HarnessConfig['storage'],
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
