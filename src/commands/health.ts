import pc from 'picocolors'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { loadConfig } from '../core/config.js'

export async function runHealth(cwd: string): Promise<void> {
  let scriptPath: string

  try {
    const config = await loadConfig(cwd)
    scriptPath = resolve(cwd, config.health.scriptPath)
  } catch {
    scriptPath = join(cwd, 'health.sh')
  }

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
