import type { HarnessConfig, Provider } from '@/types'

export function applyConfigDefaults(params: {
  name: string
  description: string
  provider: Provider
  docsPath: string
  tasksAdapter: string
}): HarnessConfig {
  return {
    provider: params.provider,
    project: {
      name: params.name,
      description: params.description,
      docsPath: params.docsPath,
      agentsMd: './AGENTS.md',
    },
    agents: {
      lead: { instructionsPath: null },
      explorer: { instructionsPath: null, allowedPaths: [params.docsPath, './src'] },
      builder: { instructionsPath: null, writablePaths: ['./src', './tests'] },
      reviewer: { instructionsPath: null },
      custom: [],
    },
    storage: {
      dir: '.harness',
      dbPath: '.harness/harness.db',
      tasks: { adapter: params.tasksAdapter as 'local' },
      sections: {
        toolsUsed: true,
        filesModified: true,
        result: true,
        blockers: true,
        nextSteps: false,
      },
      markdownFallback: { enabled: true, path: '.harness/current.md' },
    },
    health: {
      scriptPath: './health.sh',
      required: true,
    },
    tools: {
      mcp: { enabled: true, port: 3742 },
      scripts: { enabled: true, outputDir: './.harness/scripts' },
    },
  }
}
