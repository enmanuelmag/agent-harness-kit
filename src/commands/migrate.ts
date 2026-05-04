import * as p from '@clack/prompts'
import pc from 'picocolors'
import { loadConfig } from '../core/config.js'
import { getMaterializer } from '../core/materializer/index.js'
import type { Provider } from '../types.js'

interface MigrateOptions {
  to?: string
}

export async function runMigrate(cwd: string, opts: MigrateOptions): Promise<void> {
  const config = await loadConfig(cwd)

  let target: Provider
  if (opts.to && ['claude-code', 'opencode'].includes(opts.to)) {
    target = opts.to as Provider
  } else {
    const val = await p.select({
      message: 'Migrate to provider',
      options: [
        { value: 'claude-code', label: 'Claude Code' },
        { value: 'opencode', label: 'OpenCode' },
      ],
    })
    if (p.isCancel(val)) { p.cancel('Cancelled.'); process.exit(0) }
    target = val as Provider
  }

  if (target === config.provider) {
    console.log(pc.dim(`Already on ${target} — nothing to migrate.`))
    return
  }

  const spinner = p.spinner()
  spinner.start(`Migrating from ${config.provider} to ${target}...`)

  try {
    // Scaffold the new provider's files
    const targetMaterializer = getMaterializer(target)
    await targetMaterializer.build(config, cwd)

    spinner.stop(pc.green(`Migrated to ${target}`))
    p.log.warn(`Update agent-harness-kit.config.ts: set provider: '${target}'`)
    p.log.warn(`Then run: ahk build`)
  } catch (err) {
    spinner.stop(pc.red('Migration failed'))
    p.log.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }
}
