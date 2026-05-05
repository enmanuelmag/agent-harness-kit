import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import pc from 'picocolors'

import { loadConfig } from '@/core/config'
import { startDashboardServer } from '@/core/dashboard-server'
import { openDB } from '@/core/db'

const __dirname = dirname(fileURLToPath(import.meta.url))

interface DashboardOptions {
  port: number
  open: boolean
}

export async function runDashboard(cwd: string, opts: DashboardOptions): Promise<void> {
  const config = await loadConfig(cwd)
  const db = openDB(config, cwd)
  const dbPath = resolve(cwd, config.storage.dbPath)
  const staticPath = join(__dirname, 'dashboard-dist')

  const { url } = startDashboardServer(db, dbPath, staticPath, opts.port)

  console.log(pc.green(`✓`) + ` Dashboard running at ${pc.bold(pc.cyan(url))}`)
  console.log(pc.dim(`  WebSocket live updates enabled`))
  console.log(pc.dim(`  Press Ctrl+C to stop`))

  if (opts.open) {
    const { default: open } = await import('open')
    await open(url)
  }

  process.on('SIGINT', () => {
    process.exit(0)
  })

  // Keep process alive until SIGINT
  await new Promise<void>(() => { })
}
