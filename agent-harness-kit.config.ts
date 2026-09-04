import type { HarnessConfig } from '@cardor/agent-harness-kit'

const config: HarnessConfig = {
  project: {
    name: '@cardor/agent-harness-kit',
    description: 'A CLI and MCP tools for LLM providers',
    docsPath: './docs',
  },

  provider: 'opencode',

  // There is no 'agents' key. Agent files are yours: edit the role prompt and
  // the 'model:' frontmatter line directly in the generated file. 'ahk build'
  // creates them when missing and never overwrites them — use
  // 'ahk build --force' to regenerate them from the packaged templates.
  // What each role may NOT do is enforced per-tool inside those files
  // (disallowedTools / permission.edit / sandbox_mode); see
  // src/core/materializer/agent-restrictions.ts.

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
    markdownFallback: { enabled: true },
    // 'local' — DB lives in .harness/ (project-relative). 'global' — DB lives
    // under ~/.harness/dbs/<projectId>/, outside the project tree.
    scope: 'global',
    projectId: '07108fd5-e404-4864-a839-eb698c84025c',
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

export default config
