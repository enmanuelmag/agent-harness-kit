import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export function mergeClaudeMcpJson(filePath: string, port: number): void {
  let existing: Record<string, unknown> = {}
  if (existsSync(filePath)) {
    try {
      existing = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>
    } catch {
      // Unreadable JSON — start fresh to avoid corrupt state
    }
  }

  const merged = {
    ...existing,
    mcpServers: {
      ...((existing.mcpServers as Record<string, unknown>) ?? {}),
      'agent-harness-kit': {
        enable: true,
        type: 'local',
        command: 'npx',
        args: ['ahk', 'serve', '--port', String(port)],
      },
    },
  }

  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(merged, null, 2) + '\n', 'utf8')
}

export function mergeOpencodeJson(filePath: string, port: number): void {
  let existing: Record<string, unknown> = {}
  if (existsSync(filePath)) {
    try {
      existing = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>
    } catch {
      // start fresh
    }
  }

  const existingMcp = (existing.mcp as Record<string, unknown>) ?? {}

  const merged = {
    ...existing,
    mcp: {
      ...existingMcp,
      'agent-harness-kit': {
        command: 'npx',
        args: ['ahk', 'serve', '--port', String(port)],
        type: 'stdio',
      },
    },
  }

  writeFileSync(filePath, JSON.stringify(merged, null, 2) + '\n', 'utf8')
}
