import { loadConfig } from '@/core/config'
import { startMcpServer } from '@/core/mcp-server'
import { checkPermissionsSync } from '@/core/permissions-check'

interface ServeOptions {
  port?: number
}

export async function runServe(cwd: string, opts: ServeOptions): Promise<void> {
  const config = await loadConfig(cwd)

  if (opts.port) {
    config.tools.mcp.port = opts.port
  }

  // MCP server runs on stdio — do not write to stdout after this point.
  // Stderr is used for diagnostics.
  process.stderr.write(`[agent-harness-kit] MCP server starting (stdio)\n`)

  const syncResult = checkPermissionsSync(cwd, config)
  if (!syncResult.in_sync && syncResult.agents) {
    const affected = Object.entries(syncResult.agents)
      .filter(([, r]) => !r.ok)
      .map(([name]) => name)
      .join(', ')
    process.stderr.write(`[agent-harness-kit] Agent definition files missing: ${affected}. Run: ahk build\n`)
  }

  await startMcpServer(config, cwd)
}
