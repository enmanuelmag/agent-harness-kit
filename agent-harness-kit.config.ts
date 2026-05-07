import { defineHarness } from '@cardor/agent-harness-kit'

export default defineHarness({
  project: {
    name: 'agnet-harness-kit',
    description: 'CLI Tool to setup agnet harness scaffolding',
    docsPath: './docs',
  },

  provider: 'opencode',

  agents: {
    lead:     { instructionsPath: null },
    explorer: { instructionsPath: null, allowedPaths: ['./docs', './src'] },
    builder:  { instructionsPath: null, writablePaths: ['./src', './tests'] },
    reviewer: { instructionsPath: null },
    custom:   [],
  },

  storage: {
    dir:    '.harness',
    dbPath: '.harness/harness.db',
    tasks:  { adapter: 'local' },
    sections: {
      toolsUsed:     true,
      filesModified: true,
      result:        true,
      blockers:      true,
      nextSteps:     false,
    },
    markdownFallback: { enabled: true, path: '.harness/current.md' },
  },

  health: {
    scriptPath: './health.sh',
    required:   true,
  },

  tools: {
    mcp:     { enabled: true, port: 3742 },
    scripts: { enabled: true, outputDir: './.harness/scripts' },
  },
})
