import { loadConfig } from '../core/config.js'
import { startMcpServer } from '../core/mcp-server.js'

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

  await startMcpServer(config, cwd)
}
