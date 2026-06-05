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

  const syncResult = checkPermissionsSync(cwd)
  if (!syncResult.in_sync) {
    const affected = Object.entries(syncResult.agents)
      .filter(([, r]) => !r.ok)
      .map(([name, r]) => {
        const parts: string[] = []
        if (r.missing.length) parts.push(`missing: ${r.missing.map(t => t.replace('mcp__agent-harness-kit__', '')).join(', ')}`)
        if (r.extra.length) parts.push(`extra: ${r.extra.map(t => t.replace('mcp__agent-harness-kit__', '')).join(', ')}`)
        return `${name} (${parts.join('; ')})`
      })
      .join('\n   ')
    process.stderr.write(`[agent-harness-kit] Agent permissions out of sync. Run: ahk build --sync\n   ${affected}\n`)
  }

  await startMcpServer(config, cwd)
}
