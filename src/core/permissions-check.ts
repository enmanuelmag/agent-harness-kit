import { existsSync } from 'node:fs'
import { join } from 'node:path'

import type { HarnessConfig } from '@/types'

export type AgentName = 'lead' | 'explorer' | 'consultant' | 'builder' | 'reviewer'

export interface AgentSyncResult {
  ok: boolean
  /** Only reason an agent can be out of sync now: its definition file is absent. */
  reason?: 'missing_file'
}

export interface SyncCheckResult {
  in_sync: boolean
  agents?: Record<AgentName, AgentSyncResult>
}

const AGENTS: AgentName[] = ['lead', 'explorer', 'consultant', 'builder', 'reviewer']

/**
 * Verifies that each role's agent definition file exists.
 *
 * This used to parse the `tools:` frontmatter block and diff it against a
 * canonical list of `mcp__agent-harness-kit__*` tools. That premise no longer
 * holds: agent files intentionally omit `tools` so the agent inherits the full
 * tool set (including every MCP tool) from the session, and restrictions are
 * expressed as a `disallowedTools` denylist instead. With no allowlist in the
 * file, there is nothing to diff — every agent would have reported as missing
 * all of its tools.
 *
 * Agent file contents are user-customisable and are never inspected here.
 */
export function checkPermissionsSync(cwd: string, config: HarnessConfig): SyncCheckResult {
  if (config.provider !== 'claude-code') {
    return { in_sync: true }
  }

  const agents = {} as Record<AgentName, AgentSyncResult>
  let in_sync = true

  for (const agent of AGENTS) {
    const filePath = join(cwd, '.claude', 'agents', `${agent}.md`)
    const exists = existsSync(filePath)
    if (!exists) in_sync = false
    agents[agent] = exists ? { ok: true } : { ok: false, reason: 'missing_file' }
  }

  return { in_sync, agents }
}
