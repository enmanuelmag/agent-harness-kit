import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import pc from 'picocolors'

import type { HarnessConfig, Provider } from '@/types'

/**
 * Read the `name` field from a `package.json` in the given directory.
 * Returns `null` if the file doesn't exist, is malformed, or lacks a valid `name`.
 */
export function readProjectNameFromPackageJson(cwd: string): string | null {
  try {
    const pkgPath = join(cwd, 'package.json')
    if (!existsSync(pkgPath)) return null
    const content = readFileSync(pkgPath, 'utf8')
    const pkg = JSON.parse(content)
    const name = pkg?.name
    if (typeof name === 'string' && name.trim()) return name.trim()
    return null
  } catch {
    return null
  }
}

export function applyConfigDefaults(params: {
  name: string
  description: string
  provider: Provider
  docsPath: string
  tasksAdapter: string
}): HarnessConfig {
  return {
    provider: params.provider,
    project: {
      name: params.name,
      description: params.description,
      docsPath: params.docsPath,
      agentsMd: './AGENTS.md',
    },
    agents: {
      lead: { instructionsPath: null },
      explorer: { instructionsPath: null, allowedPaths: [params.docsPath, './src'] },
      builder: { instructionsPath: null, writablePaths: ['./src', './tests'] },
      reviewer: { instructionsPath: null },
      custom: [],
    },
    storage: {
      dir: '.harness',
      dbPath: '.harness/harness.db',
      tasks: { adapter: params.tasksAdapter as 'local' },
      sections: {
        toolsUsed: true,
        filesModified: true,
        result: true,
        blockers: true,
        nextSteps: false,
      },
      markdownFallback: { enabled: true, path: '.harness/current.md' },
    },
    health: {
      scriptPath: './health.sh',
      required: true,
    },
    tools: {
      mcp: { enabled: true, port: 3742 },
      scripts: { enabled: true, outputDir: './.harness/scripts' },
    },
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Strip ANSI escape codes for width calculation */
function stripAnsi(str: string): string {
  return str.replace(/\x1B\[[0-9;]*m/g, '')
}

/** Draw a bordered box matching printUpdateMessage() style */
function drawBox(lines: string[]): void {
  // Calculate max content width (excluding ANSI codes)
  const width = Math.max(...lines.map((l) => stripAnsi(l).length))
  const border = '─'.repeat(width)

  console.log(pc.yellow(`┌${border}┐`))
  for (const line of lines) {
    const pad = width - stripAnsi(line).length
    const padStr = pad > 0 ? ' '.repeat(pad) : ''
    console.log(pc.yellow('│') + line + padStr + pc.yellow('│'))
  }
  console.log(pc.yellow(`└${border}┘`))
}

/**
 * Print a pretty welcome message when user executes the init command.
 * Styled to match the existing printUpdateMessage() aesthetic.
 */
export function printWelcomeMessage(projectName: string): void {
  const sep = '─'.repeat(38)

  // Build lines with embedded ANSI codes for width calculation
  const lines: string[] = [
    `  ${pc.bold(pc.white('agent-harness-kit'))}  `,
    `  ${pc.gray('—')} harness scaffolding ${pc.gray('—')}  `,
    `  ${pc.gray(sep)}  `,
    `  ${pc.bold('Project:')}  ${projectName || '—'}  `,
    `  ${pc.bold('Status:')}   ${pc.green('ready to configure')}  `,
    `  ${pc.gray(sep)}  `,
    `  ${pc.gray('Next steps:')}  `,
    `  ${pc.gray('→')} ${pc.gray('Set up your AI provider config')}  `,
    `  ${pc.gray('→')} ${pc.gray('Run your health check to verify')}  `,
    `  ${pc.gray('→')} ${pc.gray('Start adding tasks for your agents')}  `,
  ]

  console.log()
  drawBox(lines)
  console.log()
}
