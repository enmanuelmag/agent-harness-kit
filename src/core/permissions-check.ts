import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  MCP_CLAUDE_PERMISSIONS_LEAD,
  MCP_CLAUDE_PERMISSIONS_EXPLORER,
  MCP_CLAUDE_PERMISSIONS_BUILDER,
  MCP_CLAUDE_PERMISSIONS_REVIEWER,
} from './materializer/mcp-merge'

export type AgentName = 'lead' | 'explorer' | 'builder' | 'reviewer'

export interface AgentSyncResult {
  ok: boolean
  missing: string[]
  extra: string[]
}

export interface SyncCheckResult {
  in_sync: boolean
  agents: Record<AgentName, AgentSyncResult>
}

const CANONICAL: Record<AgentName, string[]> = {
  lead: MCP_CLAUDE_PERMISSIONS_LEAD,
  explorer: MCP_CLAUDE_PERMISSIONS_EXPLORER,
  builder: MCP_CLAUDE_PERMISSIONS_BUILDER,
  reviewer: MCP_CLAUDE_PERMISSIONS_REVIEWER,
}

function parseToolsFromFrontmatter(content: string): string[] {
  const match = content.match(/^---\n([\s\S]*?)\n---/m)
  if (!match) return []
  const fm = match[1]
  const toolsMatch = fm.match(/^tools:\n((?:  - [^\n]+\n?)*)/m)
  if (!toolsMatch) return []
  return toolsMatch[1]
    .split('\n')
    .map(l => l.trim().replace(/^- /, ''))
    .filter(l => l.startsWith('mcp__'))
}

export function checkPermissionsSync(cwd: string): SyncCheckResult {
  const agents: Record<AgentName, AgentSyncResult> = {} as Record<AgentName, AgentSyncResult>
  let in_sync = true

  for (const agent of ['lead', 'explorer', 'builder', 'reviewer'] as AgentName[]) {
    const filePath = join(cwd, '.claude', 'agents', `${agent}.md`)
    if (!existsSync(filePath)) {
      const missing = CANONICAL[agent]
      agents[agent] = { ok: false, missing, extra: [] }
      in_sync = false
      continue
    }
    const content = readFileSync(filePath, 'utf-8')
    const installed = parseToolsFromFrontmatter(content)
    const canonical = CANONICAL[agent]
    const missing = canonical.filter(t => !installed.includes(t))
    const extra = installed.filter(t => !canonical.includes(t))
    const ok = missing.length === 0 && extra.length === 0
    if (!ok) in_sync = false
    agents[agent] = { ok, missing, extra }
  }

  return { in_sync, agents }
}
