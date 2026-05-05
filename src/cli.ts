import { Command } from 'commander'
import { createRequire } from 'node:module'
import { runInit } from './commands/init.js'
import { runBuild } from './commands/build.js'
import { runHealth } from './commands/health.js'
import { runStatus } from './commands/status.js'
import { runSync } from './commands/sync.js'
import { runServe } from './commands/serve.js'
import { runMigrate } from './commands/migrate.js'
import { runExport } from './commands/export.js'
import { runTaskAdd, runTaskList, runTaskDone } from './commands/task/index.js'

const require = createRequire(import.meta.url)
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const pkg = require('../package.json') as { version: string }

const cwd = process.cwd()

const program = new Command()

program
  .name('ahk')
  .description('agent-harness-kit — CLI scaffolding for multi-agent harness systems')
  .version(pkg.version, '-v, --version')

// ─── init ─────────────────────────────────────────────────────────────────────
program
  .command('init')
  .description('Scaffold a harness interactively in the current directory')
  .option('--name <name>', 'Project name (skip prompt)')
  .option('--provider <provider>', 'AI provider: claude-code | opencode (skip prompt)')
  .option('--docs <path>', 'Docs folder path (skip prompt)')
  .option('--tasks <adapter>', 'Task adapter: local | jira | linear (skip prompt)')
  .action(async (opts) => {
    await runInit(cwd, opts)
  })

// ─── build ────────────────────────────────────────────────────────────────────
program
  .command('build')
  .description('Regenerate AGENTS.md and provider files from agent-harness-kit.config.ts')
  .option('--watch', 'Rebuild on config changes')
  .action(async (opts) => {
    await runBuild(cwd, opts)
  })

// ─── health ───────────────────────────────────────────────────────────────────
program
  .command('health')
  .description('Run health.sh and report result')
  .action(async () => {
    await runHealth(cwd)
  })

// ─── status ───────────────────────────────────────────────────────────────────
program
  .command('status')
  .description('Show task table and active actions')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    await runStatus(cwd, opts)
  })

// ─── sync ─────────────────────────────────────────────────────────────────────
program
  .command('sync')
  .description('Sync feature_list.json ↔ SQLite')
  .option('--dry-run', 'Show what would change without applying')
  .option('--direction <direction>', 'in | out | both (default: both)')
  .action(async (opts) => {
    await runSync(cwd, { dryRun: opts['dry-run'], direction: opts.direction })
  })

// ─── serve ────────────────────────────────────────────────────────────────────
program
  .command('serve')
  .description('Start the MCP server (stdio)')
  .option('--port <port>', 'Port hint stored in config (default: 3742)', parseInt)
  .action(async (opts) => {
    await runServe(cwd, { port: opts.port })
  })

// ─── task ─────────────────────────────────────────────────────────────────────
const task = program.command('task').description('Manage tasks')

task
  .command('add')
  .description('Add a task interactively')
  .action(async () => {
    await runTaskAdd(cwd)
  })

task
  .command('list')
  .description('List tasks')
  .option('--status <status>', 'Filter by status: pending | in_progress | done | blocked')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    await runTaskList(cwd, opts)
  })

task
  .command('done <id|slug>')
  .description('Mark a task as done')
  .action(async (idOrSlug: string) => {
    await runTaskDone(cwd, idOrSlug)
  })

// ─── migrate ──────────────────────────────────────────────────────────────────
program
  .command('migrate')
  .description('Migrate provider-specific files to a different provider')
  .option('--to <provider>', 'Target provider: claude-code | opencode')
  .action(async (opts) => {
    await runMigrate(cwd, opts)
  })

// ─── export ───────────────────────────────────────────────────────────────────
program
  .command('export')
  .description('Export the database')
  .option('--sql', 'SQL dump')
  .option('--json', 'JSON export of tasks and actions')
  .option('--output <path>', 'Output file path (default: stdout)')
  .action(async (opts) => {
    await runExport(cwd, opts)
  })

program.parse()
