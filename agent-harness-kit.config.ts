import { defineHarness } from '@cardor/agent-harness-kit'

export default defineHarness({
  project: {
    name: '@cardor/agent-harness-kit',
    description: 'A CLI tool to manage agnets',
    docsPath: './docs',
  },

  provider: 'claude-code',

  agents: {
    lead: { instructionsPath: null },
    explorer: { instructionsPath: null, allowedPaths: ['./docs', './src', 'README.md'] },
    builder: { instructionsPath: null, writablePaths: ['./src', './tests', 'README.md'] },
    reviewer: { instructionsPath: null },
    custom: [],
  },

  // SQLite (default). Switch to postgres/mysql by changing database.type.
  // database: { type: 'postgres', connectionString: process.env.DATABASE_URL },
  // database: { type: 'mysql',    connectionString: process.env.DATABASE_URL },
  database: { type: 'sqlite' },

  storage: {
    dir: '.harness',
    tasks: { adapter: 'local' },
    sections: {
      toolsUsed: true,
      filesModified: true,
      result: true,
      blockers: true,
      nextSteps: false,
    },
    markdownFallback: { enabled: true, path: '.harness/current.md' },
    // 'local' — DB lives in .harness/ (project-relative). 'global' — DB lives
    // under ~/.harness/dbs/<projectId>/, outside the project tree.
    scope: 'local',
    projectId: '9f2e6b3a-2c9f-4b4a-8f7f-2a0a6e5c9d21',
  },

  health: {
    scriptPath: './health.sh',
    required: true,
  },

  tools: {
    mcp: { enabled: true, port: 3742 },
    scripts: { enabled: true, outputDir: './.harness/scripts' },
  },
})
