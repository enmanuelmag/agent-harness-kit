import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import pc from 'picocolors'

import { loadConfig } from '@/core/config'
import { resolveSqlitePath } from '@/core/db'

import type { HarnessConfig } from '@/types'

function checkLine(label: string | null, ok: boolean, message: string, indent = 0): void {
  const prefix = label ? pc.cyan(`[${label}] `) : ' '.repeat(indent)
  const icon = ok ? pc.green('✓') : pc.red('✗')
  console.log(prefix + icon + ' ' + (ok ? pc.green(message) : pc.red(message)))
}

export async function runHealth(cwd: string): Promise<void> {
  let config
  try {
    config = await loadConfig(cwd)
  } catch {
    console.error(pc.red('✗ No config found. Run: ahk init'))
    process.exit(1)
  }

  let allOk = true

  // ─── [checking DB] ──────────────────────────────────────────────────────────
  let dbOk: boolean
  if (config.database.type === 'sqlite') {
    const dbPath = resolveSqlitePath(config, cwd, homedir())
    dbOk = existsSync(dbPath)
    checkLine('checking DB', dbOk, `${dbPath} reachable`)
  } else {
    // For remote DBs we can't check the file — assume reachable (openDB will fail fast if not)
    dbOk = true
    checkLine('checking DB', true, `${config.database.type}://${config.database.connectionString.replace(/:[^:@]*@/, ':***@')} configured`)
  }
  if (!dbOk) allOk = false

  // ─── [checking agents] ──────────────────────────────────────────────────────
  const providerFiles = getProviderHealthFiles(config.provider)
  const agentsDir = providerFiles.agentsDir
  const agentNames = ['lead', 'explorer', 'consultant', 'builder', 'reviewer']

  const agentsLabelWidth = '[checking agents] '.length
  for (let i = 0; i < agentNames.length; i++) {
    const name = agentNames[i]
    const agentPath = join(cwd, agentsDir, `${name}${providerFiles.agentExtension}`)
    const ok = existsSync(agentPath)
    checkLine(
      i === 0 ? 'checking agents' : null,
      ok,
      `${name}${providerFiles.agentExtension} present`,
      agentsLabelWidth,
    )
    if (!ok) allOk = false
  }

  // ─── [checking MCP] ─────────────────────────────────────────────────────────
  if (config.tools.mcp.enabled) {
    const mcpFile = providerFiles.mcpFile
    const mcpPath = resolve(cwd, mcpFile)
    const mcpOk = existsSync(mcpPath)
    checkLine('checking MCP', mcpOk, `${mcpFile} valid`)
    if (!mcpOk) allOk = false
  }

  if (!allOk) {
    console.log('')
    console.error(pc.red('✗ Harness checks failed — fix the above before running health.sh'))
    process.exit(1)
  }

  // ─── Run health.sh ──────────────────────────────────────────────────────────
  const scriptPath = resolve(cwd, config.health.scriptPath)

  if (!existsSync(scriptPath)) {
    console.error(pc.red(`✗ health.sh not found: ${scriptPath}`))
    console.error('  Run ahk init first.')
    process.exit(1)
  }

  const result = spawnSync('bash', [scriptPath], {
    cwd,
    stdio: 'inherit',
    encoding: 'utf8',
  })

  if (result.error) {
    console.error(pc.red(`✗ Failed to run health.sh: ${result.error.message}`))
    process.exit(1)
  }

  if (result.status === 0) {
    console.log(pc.green('✓ Health check passed'))
    process.exit(0)
  } else {
    console.error(pc.red(`✗ Health check failed (exit ${result.status ?? 'unknown'})`))
    process.exit(result.status ?? 1)
  }
}

function getProviderHealthFiles(provider: HarnessConfig['provider']): {
  agentsDir: string
  agentExtension: '.md' | '.toml'
  mcpFile: string
} {
  switch (provider) {
    case 'claude-code':
      return { agentsDir: '.claude/agents', agentExtension: '.md', mcpFile: '.mcp.json' }
    case 'opencode':
      return { agentsDir: '.opencode/agents', agentExtension: '.md', mcpFile: 'opencode.json' }
    case 'codex-cli':
      return { agentsDir: '.codex/agents', agentExtension: '.toml', mcpFile: '.codex/config.toml' }
    default:
      throw new Error(`Unknown provider: ${provider as string}`)
  }
}
