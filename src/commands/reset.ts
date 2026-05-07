import { existsSync, readdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import * as p from '@clack/prompts'
import pc from 'picocolors'

import { loadConfig } from '@/core/config'

interface ResetOptions {
  force?: boolean
  provider?: 'claude-code' | 'opencode'
}

// Map of agent names to their .md filenames
const AGENT_MD_FILES = ['lead', 'explorer', 'builder', 'reviewer']

async function resetAgentMds(cwd: string, provider: 'claude-code' | 'opencode'): Promise<void> {
  const agentDir = provider === 'claude-code' ? '.claude/agents' : '.opencode/agents'
  const agentDirPath = resolve(cwd, agentDir)

  if (!existsSync(agentDirPath)) {
    console.log(pc.yellow(`  Skipping agent files — directory not found: ${agentDirPath}`))
    return
  }

  // Collect existing agent MD files
  const existingFiles: string[] = []
  try {
    const files = readdirSync(agentDirPath)
    for (const f of files) {
      if (f.endsWith('.md')) {
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

  const storageDir = config.storage.dir || '.harness'
  const dbPath = resolve(cwd, storageDir, 'harness.db')
  const featureListPath = resolve(cwd, storageDir, 'feature_list.json')

  let resetDb = false
  let resetFeatureList = false
  let resetAgentMdsFlag = false

  // ─── Determine what to reset ────────────────────────────────────────────────

  // Reset DB?
  if (existsSync(dbPath)) {
    if (opts.force) {
      resetDb = true
    } else {
      const confirm = await p.confirm({
        message: `Delete database (${storageDir}/harness.db)?`,
        initialValue: true,
      })
      if (p.isCancel(confirm)) {
        console.log(pc.red('  Cancelled by user.'))
        return
      }
      resetDb = confirm
    }
  }

  // Reset feature_list.json?
  if (existsSync(featureListPath)) {
    if (opts.force) {
      resetFeatureList = true
    } else {
      const confirm = await p.confirm({
        message: `Delete feature list (${storageDir}/feature_list.json)?`,
        initialValue: true,
      })
      if (p.isCancel(confirm)) {
        console.log(pc.red('  Cancelled by user.'))
        return
      }
      resetFeatureList = confirm
    }
  }

  // Reset agent MD files?
  if (opts.provider) {
    resetAgentMdsFlag = true
  }

  // ─── Perform resets ─────────────────────────────────────────────────
  let changed = false

  if (resetDb) {
    try {
      rmSync(dbPath, { force: true })
      console.log(pc.green(`  ✓ Removed ${storageDir}/harness.db`))
      changed = true
    } catch {
      console.error(pc.red(`  ✗ Failed to remove ${dbPath}`))
    }
  }

  if (resetFeatureList) {
    try {
      rmSync(featureListPath, { force: true })
      console.log(pc.green(`  ✓ Removed ${storageDir}/feature_list.json`))
      changed = true
    } catch {
      console.error(pc.red(`  ✗ Failed to remove ${featureListPath}`))
    }
  }

  if (resetAgentMdsFlag) {
    console.log('')
    await resetAgentMds(cwd, opts.provider || 'claude-code')
  }

  if (!resetDb && !resetFeatureList && !resetAgentMdsFlag) {
    console.log(pc.yellow('  Nothing to reset (all items missing or skipped).'))
    return
  }

  // ─── Summary ────────────────────────────────────────────────────────
  console.log('')
  console.log(pc.green('✓ Reset complete. Run "ahk init" to scaffold a fresh harness.'))
}
