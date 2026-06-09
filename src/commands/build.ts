import { watch } from 'node:fs'
import * as p from '@clack/prompts'
import pc from 'picocolors'

import { loadConfig } from '@/core/config'
import { getMaterializer } from '@/core/materializer/index'

interface BuildOptions {
  watch?: boolean
  sync?: boolean
}

export async function runBuild(cwd: string, opts: BuildOptions): Promise<void> {
  await buildOnce(cwd)

  if (opts.sync) {
    p.log.step('Syncing agent permissions...')
    const config = await loadConfig(cwd)
    const materializer = getMaterializer(config.provider)
    await materializer.syncPermissions(cwd)
  }

  if (opts.watch) {
    p.log.info(`Watching agent-harness-kit.config.ts for changes...`)
    watch(cwd, { recursive: false }, async (_, filename) => {
      if (filename?.startsWith('agent-harness-kit.config')) {
        p.log.step('Config changed — rebuilding...')
        await buildOnce(cwd)
      }
    })
    // Keep process alive
    await new Promise(() => { })
  }
}

async function buildOnce(cwd: string): Promise<void> {
  const spinner = p.spinner()
  spinner.start('Loading config...')

  try {
    const config = await loadConfig(cwd)
    spinner.message('Rebuilding files...')
    const materializer = getMaterializer(config.provider)
    await materializer.build(config, cwd)
    spinner.stop(pc.green('Build complete'))
    p.log.success('AGENTS.md')
    p.log.success(`Agent definitions (${config.provider})`)
    p.log.success('MCP config')
  } catch (err) {
    spinner.stop(pc.red('Build failed'))
    p.log.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }
}
