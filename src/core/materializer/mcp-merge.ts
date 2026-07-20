import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { getMcpCommandParts } from './detect-package-manager'

import type { PackageManager } from './detect-package-manager'

// ─── Claude Code ──────────────────────────────────────────────────────────────

export function mergeClaudeMcpJson(filePath: string, port: number, cwd: string, pm: PackageManager = 'npm'): void {
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

  const [command, ...args] = getMcpCommandParts(pm, port, cwd)

  const merged = {
    ...existing,
    mcpServers: {
      ...((existing.mcpServers as Record<string, unknown>) ?? {}),
      'agent-harness-kit': {
        type: 'stdio',
        command,
        args,
      },
    },
  }

  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(merged, null, 2) + '\n', 'utf8')
}

// Write `agent: "lead"` to .claude/settings.json — the correct Claude Code field
// for setting which subagent runs as the main session thread.
export function mergeClaudeSettingsJson(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true })

  let existing: Record<string, unknown> = {}
  if (existsSync(filePath)) {
    try {
      existing = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>
    } catch {
      // start fresh
    }
  }

  const merged = {
    ...existing,
    agent: 'lead',
  }

  writeFileSync(filePath, JSON.stringify(merged, null, 2) + '\n', 'utf8')
}

// Merge MCP tool permissions into .claude/settings.local.json
export const MCP_CLAUDE_PERMISSIONS_LEAD = [
  'mcp__agent-harness-kit__actions_start',
  'mcp__agent-harness-kit__actions_write',
  'mcp__agent-harness-kit__actions_complete',
  'mcp__agent-harness-kit__actions_get',
  'mcp__agent-harness-kit__actions_record_file',
  'mcp__agent-harness-kit__actions_record_tool',
  'mcp__agent-harness-kit__tasks_get',
  'mcp__agent-harness-kit__tasks_claim',
  'mcp__agent-harness-kit__tasks_add',
  'mcp__agent-harness-kit__tasks_update',
  'mcp__agent-harness-kit__tasks_edit',
  'mcp__agent-harness-kit__tasks_archive',
  'mcp__agent-harness-kit__tasks_unarchive',
  'mcp__agent-harness-kit__tasks_acceptance_get',
  'mcp__agent-harness-kit__docs_search',
  'mcp__agent-harness-kit__ahk_doctor',
]

export const MCP_CLAUDE_PERMISSIONS_EXPLORER = [
  'mcp__agent-harness-kit__actions_start',
  'mcp__agent-harness-kit__actions_write',
  'mcp__agent-harness-kit__actions_complete',
  'mcp__agent-harness-kit__actions_get',
  'mcp__agent-harness-kit__actions_record_file',
  'mcp__agent-harness-kit__actions_record_tool',
  'mcp__agent-harness-kit__tasks_get',
  'mcp__agent-harness-kit__tasks_claim',
  'mcp__agent-harness-kit__tasks_acceptance_get',
  'mcp__agent-harness-kit__docs_search',
  'mcp__agent-harness-kit__ahk_doctor',
]

export const MCP_CLAUDE_PERMISSIONS_BUILDER = [
  'mcp__agent-harness-kit__actions_start',
  'mcp__agent-harness-kit__actions_write',
  'mcp__agent-harness-kit__actions_complete',
  'mcp__agent-harness-kit__actions_get',
  'mcp__agent-harness-kit__actions_record_file',
  'mcp__agent-harness-kit__actions_record_tool',
  'mcp__agent-harness-kit__tasks_get',
  'mcp__agent-harness-kit__tasks_claim',
  'mcp__agent-harness-kit__tasks_add',
  'mcp__agent-harness-kit__tasks_update',
  'mcp__agent-harness-kit__tasks_edit',
  'mcp__agent-harness-kit__tasks_archive',
  'mcp__agent-harness-kit__tasks_unarchive',
  'mcp__agent-harness-kit__tasks_acceptance_get',
  'mcp__agent-harness-kit__docs_search',
  'mcp__agent-harness-kit__ahk_doctor',
]

export const MCP_CLAUDE_PERMISSIONS_REVIEWER = [
  'mcp__agent-harness-kit__actions_start',
  'mcp__agent-harness-kit__actions_write',
  'mcp__agent-harness-kit__actions_complete',
  'mcp__agent-harness-kit__actions_get',
  'mcp__agent-harness-kit__actions_record_file',
  'mcp__agent-harness-kit__actions_record_tool',
  'mcp__agent-harness-kit__tasks_get',
  'mcp__agent-harness-kit__tasks_claim',
  'mcp__agent-harness-kit__tasks_add',
  'mcp__agent-harness-kit__tasks_update',
  'mcp__agent-harness-kit__tasks_edit',
  'mcp__agent-harness-kit__tasks_archive',
  'mcp__agent-harness-kit__tasks_unarchive',
  'mcp__agent-harness-kit__tasks_acceptance_update',
  'mcp__agent-harness-kit__tasks_acceptance_get',
  'mcp__agent-harness-kit__docs_search',
  'mcp__agent-harness-kit__ahk_doctor',
]

export const MCP_CLAUDE_PERMISSIONS_CONSULTANT = [
  'mcp__agent-harness-kit__actions_start',
  'mcp__agent-harness-kit__actions_write',
  'mcp__agent-harness-kit__actions_complete',
  'mcp__agent-harness-kit__actions_get',
  'mcp__agent-harness-kit__actions_record_file',
  'mcp__agent-harness-kit__actions_record_tool',
  'mcp__agent-harness-kit__tasks_get',
  'mcp__agent-harness-kit__tasks_claim',
  'mcp__agent-harness-kit__tasks_acceptance_get',
  'mcp__agent-harness-kit__deps_snapshot',
  'mcp__agent-harness-kit__deps_check',
  'mcp__agent-harness-kit__docs_search',
  'mcp__agent-harness-kit__ahk_doctor',
] as const

// Full union — used by mergeClaudeSettingsLocalJson for project-wide settings
export const MCP_CLAUDE_PERMISSIONS = [
  ...new Set([
    ...MCP_CLAUDE_PERMISSIONS_LEAD,
    ...MCP_CLAUDE_PERMISSIONS_EXPLORER,
    ...MCP_CLAUDE_PERMISSIONS_BUILDER,
    ...MCP_CLAUDE_PERMISSIONS_REVIEWER,
    ...MCP_CLAUDE_PERMISSIONS_CONSULTANT,
  ]),
]

export function mergeClaudeSettingsLocalJson(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true })

  let existing: Record<string, unknown> = {}
  if (existsSync(filePath)) {
    try {
      existing = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>
    } catch {
      // start fresh
    }
  }

  const existingPermissions = (existing.permissions as Record<string, unknown>) ?? {}
  const existingAllow = (existingPermissions.allow as string[]) ?? []
  const existingServers = (existing.enabledMcpjsonServers as string[]) ?? []

  const mergedAllow = Array.from(new Set([...existingAllow, ...MCP_CLAUDE_PERMISSIONS]))
  const mergedServers = Array.from(new Set([...existingServers, 'agent-harness-kit']))

  const merged = {
    ...existing,
    permissions: {
      ...existingPermissions,
      allow: mergedAllow,
    },
    enabledMcpjsonServers: mergedServers,
  }

  writeFileSync(filePath, JSON.stringify(merged, null, 2) + '\n', 'utf8')
}

// ─── OpenCode ─────────────────────────────────────────────────────────────────

export function mergeOpencodeJson(filePath: string, port: number, cwd: string, pm: PackageManager = 'npm'): void {
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

  const merged = {
    ...existing,
    default_agent: 'lead',
    compaction: existing.compaction ?? { auto: true, prune: true, reserved: 10000 },
    permission: existing.permission ?? { write: 'ask' },
    mcp: {
      ...existingMcp,
      'agent-harness-kit': {
        enabled: true,
        type: 'local',
        // OpenCode's mcp.<name>.command field is a single array (unlike
        // Claude/Codex, which split command/args) — pass the full token list.
        command: getMcpCommandParts(pm, port, cwd),
      },
    },
  }

  writeFileSync(filePath, JSON.stringify(merged, null, 2) + '\n', 'utf8')
}

// ─── Codex CLI ────────────────────────────────────────────────────────────────

function mergeTomlSection(content: string, sectionName: string, sectionBody: string): string {
  const lines = content.split('\n')
  const header = `[${sectionName}]`

  const startIdx = lines.findIndex((l) => l.trim() === header)

  if (startIdx === -1) {
    const trimmed = content.trimEnd()
    return trimmed + (trimmed ? '\n\n' : '') + header + '\n' + sectionBody.trimEnd() + '\n'
  }

  // Find where the section ends: next line starting with `[` or EOF
  let endIdx = lines.length
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (/^\[/.test(lines[i])) {
      endIdx = i
      break
    }
  }

  const newLines = [
    ...lines.slice(0, startIdx),
    header,
    ...sectionBody.trimEnd().split('\n'),
    '',
    ...lines.slice(endIdx),
  ]

  return newLines.join('\n')
}

export function mergeCodexConfigToml(filePath: string, port: number, cwd: string, pm: PackageManager = 'npm'): void {
  mkdirSync(dirname(filePath), { recursive: true })

  let content = ''
  if (existsSync(filePath)) {
    content = readFileSync(filePath, 'utf8')
  }

  const [command, ...args] = getMcpCommandParts(pm, port, cwd)

  const sectionBody = [
    `command = ${JSON.stringify(command)}`,
    `args = ${JSON.stringify(args)}`,
    'default_tools_approval_mode = "auto"',
  ].join('\n')

  content = mergeTomlSection(content, 'mcp_servers.agent-harness-kit', sectionBody)

  writeFileSync(filePath, content, 'utf8')
}
