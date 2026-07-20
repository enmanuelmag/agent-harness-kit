import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import pc from 'picocolors'

import { isLocalInstallSatisfied } from '@/core/local-install-guard'

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

/**
 * Chooses the config file format for `ahk init`.
 *
 * A local install of the package is the PRECONDITION, checked before anything
 * else: without it, the project cannot resolve '@cardor/agent-harness-kit', so
 * a .ts config's `import type` — and any editor autocompletion that depends on
 * it — resolves to nothing and the user sees a red-underlined, apparently
 * broken project. JSON has nothing to resolve, so it is correct by
 * construction there.
 *
 * Only once the package IS installed locally do we fall through to the
 * pre-existing project-type detection (tsconfig.json / package.json type),
 * whose behavior is unchanged.
 */
export function detectConfigExtension(cwd: string): 'json' | 'ts' | 'mjs' | 'cjs' {
  if (!isLocalInstallSatisfied(cwd)) return 'json'
  try {
    if (existsSync(join(cwd, 'tsconfig.json'))) return 'ts'
    const pkgPath = join(cwd, 'package.json')
    if (!existsSync(pkgPath)) return 'mjs'
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    if (pkg?.type === 'module') return 'mjs'
  } catch {}
  return 'mjs'
}

export function applyConfigDefaults(params: {
  name: string
  description: string
  provider: Provider
  docsPath: string
  tasksAdapter: string
  /** Storage scope chosen during init. Defaults to 'local' for backward compat. */
  scope?: 'local' | 'global'
  /** Reuse an existing projectId (e.g. re-running init logic). If omitted, a
   *  fresh UUID is generated — NEVER derive it from the project path/hash. */
  projectId?: string
}): HarnessConfig {
  const scope = params.scope ?? 'local'
  const projectId = params.projectId ?? randomUUID()
  const baseStorage = {
    dir: '.harness',
    tasks: { adapter: params.tasksAdapter as 'local' },
    sections: {
      toolsUsed: true,
      filesModified: true,
      result: true,
      blockers: true,
      nextSteps: false,
    },
  }
  const storage: HarnessConfig['storage'] =
    scope === 'global'
      ? { ...baseStorage, markdownFallback: { enabled: true }, scope: 'global', projectId }
      : { ...baseStorage, markdownFallback: { enabled: true, path: '.harness/current.md' }, scope: 'local', projectId }

  return {
    provider: params.provider,
    project: {
      name: params.name,
      description: params.description,
      docsPath: params.docsPath,
      agentsMd: './AGENTS.md',
    },
    // No `agents` key: per-agent settings (model, role instructions) live in
    // the generated agent file, which is user-owned. This object is the runtime
    // twin of the config body emitted by configObjectBody() in templates.ts —
    // drift between the two is the bug this pairing has to keep out.
    database: { type: 'sqlite' as const },
    storage,
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
export function drawBox(lines: string[]): void {
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
