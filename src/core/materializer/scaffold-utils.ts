import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import {
  MCP_CLAUDE_PERMISSIONS_LEAD,
  MCP_CLAUDE_PERMISSIONS_EXPLORER,
  MCP_CLAUDE_PERMISSIONS_BUILDER,
  MCP_CLAUDE_PERMISSIONS_REVIEWER,
  MCP_CLAUDE_PERMISSIONS_CONSULTANT,
} from './mcp-merge'
import { GITIGNORE_ENTRIES } from './templates'

export function writeAgentFile(cwd: string, relPath: string, content: string): void {
  const abs = join(cwd, relPath)
  if (existsSync(abs)) return  // preserve dev customizations
  mkdirSync(resolve(abs, '..'), { recursive: true })
  writeFileSync(abs, content, 'utf8')
}

export function appendGitignore(cwd: string): void {
  const giPath = join(cwd, '.gitignore')
  const existing = existsSync(giPath) ? readFileSync(giPath, 'utf8') : ''

  const toAdd = GITIGNORE_ENTRIES.split('\n')
    .filter((line) => line && !existing.includes(line))
    .join('\n')

  if (toAdd.trim()) {
    writeFileSync(giPath, existing + (existing.endsWith('\n') ? '' : '\n') + toAdd + '\n', 'utf8')
  }
}

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

const AGENT_TOOLS: Record<string, string[]> = {
  lead: [...MCP_CLAUDE_PERMISSIONS_LEAD],
  explorer: [...MCP_CLAUDE_PERMISSIONS_EXPLORER],
  consultant: [...MCP_CLAUDE_PERMISSIONS_CONSULTANT],
  builder: [...MCP_CLAUDE_PERMISSIONS_BUILDER],
  reviewer: [...MCP_CLAUDE_PERMISSIONS_REVIEWER],
}

export async function syncAgentPermissions(cwd: string): Promise<void> {
  for (const [agent, tools] of Object.entries(AGENT_TOOLS)) {
    const filePath = join(cwd, '.claude', 'agents', `${agent}.md`)
    if (!existsSync(filePath)) {
      console.log(`  ${agent}.md not found — skipping`)
      continue
    }
    const content = readFileSync(filePath, 'utf-8')
    // Replace mcp__ lines in the tools: block while preserving native tools (Read/Write/Bash/Task)
    const updated = content.replace(
      /(tools:\n)((?:  - [^\n]+\n)*)/m,
      (_match, header, toolsSection) => {
        const nativeLines = toolsSection.split('\n').filter(line => line.trim() && !line.includes('mcp__'))
        const nativeSection = nativeLines.length ? nativeLines.join('\n') + '\n' : ''
        const mcpSection = tools.map(t => `  - ${t}`).join('\n') + '\n'
        return header + nativeSection + mcpSection
      }
    )
    if (updated === content) {
      console.log(`  ${agent}.md already in sync`)
    } else {
      writeFileSync(filePath, updated, 'utf-8')
      console.log(`  ${agent}.md updated`)
    }
  }
}
