import { Command } from 'commander'

import { runBuild } from '@/commands/build'
import { runDashboard } from '@/commands/dashboard'
import { runExport } from '@/commands/export'
import { runHealth } from '@/commands/health'
import { runInit } from '@/commands/init'
import { runMigrate } from '@/commands/migrate'
import { runServe } from '@/commands/serve'
import { runStatus } from '@/commands/status'
import { runSync } from '@/commands/sync'
import { runTaskAdd, runTaskDone, runTaskList } from '@/commands/task/index'
import { pkg } from '@/core/package-data'
import { checkForUpdate, printUpdateMessage } from '@/core/update-check'
import { runReset } from '@/commands/reset'

const cwd = process.cwd()

const updateCheck = checkForUpdate(pkg.version)

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

// ─── dashboard ────────────────────────────────────────────────────────────────
program
  .command('dashboard')
  .description('Open web dashboard to visualize harness data')
  .option('-p, --port <port>', 'Port to listen on', '4242')
  .option('--no-open', 'Do not open browser automatically')
  .action(async (opts: { port: string; open: boolean }) => {
    await runDashboard(cwd, { port: parseInt(opts.port), open: opts.open })
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


// ─── reset ────────────────────────────────────────────────────────────────────
program
  .command('reset')
  .description('Reset/clear harness data (DB, feature list, agent files)')
  .option('--force', 'Skip confirmation prompts')
  .option('--provider <claude-code|opencode>', 'Reset agent MD files for specified provider')
  .action(async (opts) => {
    await runReset(cwd, opts)
  })

program.hook('postAction', async () => {
  const update = await updateCheck
  if (update) printUpdateMessage(update)
})

program.parse()
