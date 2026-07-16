import { Command } from 'commander'
import pc from 'picocolors'

import { runBuild } from '@/commands/build'
import { runDashboard } from '@/commands/dashboard'
import { runDoctor } from '@/commands/doctor'
import { runExport } from '@/commands/export'
import { runHealth } from '@/commands/health'
import { runInit } from '@/commands/init'
import { runMigrate } from '@/commands/migrate'
import { runMigrateStorage } from '@/commands/migrate-storage'
import { runReset } from '@/commands/reset'
import { runServe } from '@/commands/serve'
import { runStatus } from '@/commands/status'
import { runSync } from '@/commands/sync'
import { runTaskAdd, runTaskDone, runTaskEdit, runTaskList } from '@/commands/task/index'
import { isLocalInstallSatisfied, printLocalInstallWarning } from '@/core/local-install-guard'
import { pkg } from '@/core/package-data'
import { checkForUpdate, printUpdateMessage } from '@/core/update-check'

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
  .option('--storage-scope <scope>', 'Storage scope: local | global (skip prompt)')
  .action(async (opts) => {
    await runInit(cwd, opts)
  })

// ─── build ────────────────────────────────────────────────────────────────────
program
  .command('build')
  .description('Regenerate AGENTS.md and provider files from agent-harness-kit.config.ts')
  .option('--watch', 'Rebuild on config changes')
  .option('--sync', 'Sync tools: frontmatter in existing .claude/agents/*.md to match current permission constants')
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
  .option('--archived', 'Show only archived tasks')
  .option('--include-archived', 'Include archived tasks in the list')
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

task
  .command('edit')
  .description('Edit a task interactively')
  .action(async () => {
    await runTaskEdit(cwd)
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
// `ahk migrate` is a pure router (no options/action of its own — commander
// does not reliably support an identical flag declared on both a parent
// command and its subcommand, see the argv rewrite below) with two
// subcommands:
//   - `migrate provider --to <x>` — migrate provider-specific scaffold files.
//   - `migrate storage [--force] [--dry-run]` — migrate harness DB storage
//     (local↔global scope, sqlite↔postgres/mysql). See migrate-storage.ts.
// `ahk migrate --to <x>` (no subcommand) and bare `ahk migrate` are kept as
// backward-compatible aliases for `migrate provider [--to <x>]` — see the
// argv rewrite just before `program.parse()` below.
const migrate = program
  .command('migrate')
  .description('Migrate provider files to a different provider, or migrate harness storage (see subcommands)')

migrate
  .command('provider')
  .description('Migrate provider-specific files to a different provider')
  .option('--to <provider>', 'Target provider: claude-code | opencode | codex-cli')
  .action(async (opts) => {
    await runMigrate(cwd, opts)
  })

migrate
  .command('storage')
  .description(
    'Migrate harness DB storage between local/global scope or sqlite/postgres/mysql, based on agent-harness-kit.config.ts vs the real current state',
  )
  .option('--force', 'Required to overwrite a non-empty destination (a backup is written first)')
  .option('--dry-run', 'Preview what would migrate without applying any changes')
  .action(async (opts) => {
    try {
      await runMigrateStorage(cwd, { force: opts.force, dryRun: opts['dry-run'] })
    } catch (err) {
      console.error(pc.red(`✗ ${err instanceof Error ? err.message : String(err)}`))
      process.exit(1)
    }
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

// ─── doctor ───────────────────────────────────────────────────────────────────
program
  .command('doctor')
  .description('Check lib version, agent files, and harness skills sync status')
  .action(async () => {
    await runDoctor(cwd)
  })

// Prints a non-blocking warning (but not for --version/--help, which
// commander handles without invoking actions) when the package is only
// installed globally and not available in the project's local
// node_modules. This is purely informational — the command continues
// its normal flow regardless of the check's result.
program.hook('preAction', () => {
  if (!isLocalInstallSatisfied(cwd)) {
    printLocalInstallWarning()
  }
})

program.hook('postAction', async () => {
  const update = await updateCheck
  if (update) printUpdateMessage(update)
})

// ─── backward-compat argv rewrite for `ahk migrate` ────────────────────────
// Bare `ahk migrate` and `ahk migrate --to <x>` (no subcommand token) must
// keep working exactly as before subcommands were introduced — rewrite them
// to `ahk migrate provider [--to <x>]` before commander parses argv.
// `ahk migrate provider ...` and `ahk migrate storage ...` are untouched.
function rewriteLegacyMigrateArgv(argv: string[]): string[] {
  const migrateIdx = argv.indexOf('migrate')
  if (migrateIdx === -1) return argv
  const next = argv[migrateIdx + 1]
  const isLegacyForm = next === undefined || next === '--to'
  if (!isLegacyForm) return argv
  const rewritten = [...argv]
  rewritten.splice(migrateIdx + 1, 0, 'provider')
  return rewritten
}

program.parse(rewriteLegacyMigrateArgv(process.argv))
