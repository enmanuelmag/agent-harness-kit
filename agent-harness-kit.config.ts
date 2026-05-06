import { defineHarness } from '@cardor/agent-harness-kit'

export default defineHarness({
  project: {
    name: 'agent-harness-kit',
    description: 'CLI Tool to define agents role, harness pattern and MCP tools to orchestrate agent to take task in tandem',
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
