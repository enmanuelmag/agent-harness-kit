import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const compactionConfig = {
  compaction: {
    auto: true,
    prune: true,
    reserved: 10000
  }
}

export function mergeClaudeMcpJson(filePath: string, port: number): void {
  const folderPath = dirname(filePath)
  if (!existsSync(folderPath)) {
    mkdirSync(folderPath, { recursive: true })
  }

  let existing: Record<string, unknown> = {}
  if (existsSync(filePath)) {
    try {
      existing = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>
    } catch {
      // Unreadable JSON — start fresh to avoid corrupt state
    }
  }



  const agentHarnessKitConfig = {
    type: 'stdio',
    command: 'npx',
    args: ['ahk', 'serve', '--port', String(port)],
  }

  const merged = {
    ...existing,
    compaction: existing.compaction ?? compactionConfig.compaction,
    mcpServers: {
      ...((existing.mcpServers as Record<string, unknown>) ?? {}),
      'agent-harness-kit': agentHarnessKitConfig,
    },
  }

  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(merged, null, 2) + '\n', 'utf8')
}

export function mergeOpencodeJson(filePath: string, port: number): void {
  const folderPath = dirname(filePath)
  if (!existsSync(folderPath)) {
    mkdirSync(folderPath, { recursive: true })
  }

  let existing: Record<string, unknown> = {}
  if (existsSync(filePath)) {
    try {
      existing = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>
    } catch {
      // start fresh
    }
  }

  const existingMcp = (existing.mcp as Record<string, unknown>) ?? {}

  const agentHarnessKitConfig = {
    enabled: true,
    type: 'local',
    command: ['npx', 'ahk', 'serve', '--port', String(port)],
  }

  const merged = {
    ...existing,
    compaction: existing.compaction ?? compactionConfig.compaction,
    mcp: {
      ...existingMcp,
      'agent-harness-kit': agentHarnessKitConfig,
    },
  }

  writeFileSync(filePath, JSON.stringify(merged, null, 2) + '\n', 'utf8')
}
