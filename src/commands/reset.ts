import { existsSync, readdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import * as p from '@clack/prompts'
import pc from 'picocolors'

import { loadConfig } from '@/core/config'
import { resolveSqlitePath } from '@/core/db'

import type { Provider } from '@/types'

interface ResetOptions {
  force?: boolean
  provider?: Provider
}

// Map of agent role names to their generated filenames (extension varies by provider)
const AGENT_MD_FILES = ['lead', 'explorer', 'consultant', 'builder', 'reviewer']

const PROVIDER_AGENT_DIRS: Record<Provider, string> = {
  'claude-code': '.claude/agents',
  opencode: '.opencode/agents',
  'codex-cli': '.codex/agents',
  'grok-cli': '.grok/agents',
}

// codex-cli agent files are TOML (see codex-cli.ts materializer); every other
// provider generates markdown + YAML frontmatter.
const PROVIDER_AGENT_EXT: Record<Provider, string> = {
  'claude-code': '.md',
  opencode: '.md',
  'codex-cli': '.toml',
  'grok-cli': '.md',
}

async function resetAgentMds(cwd: string, provider: Provider): Promise<void> {
  const agentDir = PROVIDER_AGENT_DIRS[provider]
  const agentDirPath = resolve(cwd, agentDir)
  const agentExt = PROVIDER_AGENT_EXT[provider]

  if (!existsSync(agentDirPath)) {
    console.log(pc.yellow(`  Skipping agent files — directory not found: ${agentDirPath}`))
    return
  }

  // Collect existing agent files for this provider's extension
  const existingFiles: string[] = []
  try {
    const files = readdirSync(agentDirPath)
    for (const f of files) {
      if (f.endsWith(agentExt) && AGENT_MD_FILES.includes(f.replace(agentExt, ''))) {
        existingFiles.push(f)
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
    console.log(pc.yellow(`  Skipping agent files — ${agentDirPath} is not readable`))
    return
  }

  if (existingFiles.length === 0) {
    console.log(pc.yellow(`  No agent MD files found in ${agentDir}/`))
    return
  }

  // Confirm removal of each agent MD file
  for (const file of existingFiles) {
    const confirm = await p.confirm({
      message: `Remove ${file}?`,
      initialValue: true,
    })
    if (p.isCancel(confirm)) {
      console.log(pc.red('  Cancelled by user.'))
      return
    }
    if (confirm) {
      try {
        const filePath = join(agentDirPath, file)
        rmSync(filePath, { force: true })
        console.log(pc.green(`  Removed ${file}`))
      } catch {
        console.error(pc.red(`  Failed to remove ${file}`))
      }
    } else {
      console.log(pc.cyan(`  Skipped ${file}`))
    }
  }
}

export async function runReset(cwd: string, opts: ResetOptions): Promise<void> {
  let config
  try {
    config = await loadConfig(cwd)
  } catch {
    console.error(pc.red('✗ No agent-harness-kit.config found. Run: ahk init'))
    process.exit(1)
  }

  const dbPath =
    config.database.type === 'sqlite' ? resolveSqlitePath(config, cwd, homedir()) : null

  let resetDb = false
  let resetAgentMdsFlag = false

  // ─── Determine what to reset ────────────────────────────────────────────────

  // Reset DB? (SQLite only — remote DBs are not reset by this command)
  if (dbPath && existsSync(dbPath)) {
    if (opts.force) {
      resetDb = true
    } else {
      if (config.database.type !== 'sqlite') {
        console.log(
          pc.yellow(
            `  Skipping DB reset — database type "${config.database.type}" is not managed by this command.`
          )
        )
        resetDb = false
      } else {
        const confirm = await p.confirm({
          message: `Delete database (${dbPath})?`,
          initialValue: true,
        })
        if (p.isCancel(confirm)) {
          console.log(pc.red('  Cancelled by user.'))
          return
        }
        resetDb = confirm
      }
    }
  } else if (!dbPath) {
    console.log(
      pc.dim(
        `  Skipping DB reset — remote ${config.database.type} database is not managed by this command.`
      )
    )
  }

  // Reset agent MD files?
  if (opts.provider) {
    resetAgentMdsFlag = true
  }

  // ─── Perform resets ─────────────────────────────────────────────────
  if (resetDb && dbPath) {
    try {
      rmSync(dbPath, { force: true })
      rmSync(`${dbPath}-wal`, { force: true }) // also remove WAL file if it exists (only for SQLite)
      rmSync(`${dbPath}-shm`, { force: true }) // also remove SHM file if it exists (only for SQLite)
      console.log(pc.green(`  ✓ Removed ${dbPath}`))
    } catch {
      console.error(pc.red(`  ✗ Failed to remove ${dbPath}`))
    }
  }

  if (resetAgentMdsFlag) {
    console.log('')
    await resetAgentMds(cwd, opts.provider || 'claude-code')
  }

  if (!resetDb && !resetAgentMdsFlag) {
    console.log(pc.yellow('  Nothing to reset (all items missing or skipped).'))
    return
  }

  // ─── Summary ────────────────────────────────────────────────────────
  console.log('')
  console.log(pc.green('✓ Reset complete. Run "ahk init" to scaffold a fresh harness.'))
}
