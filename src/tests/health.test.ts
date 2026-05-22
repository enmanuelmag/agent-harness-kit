import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, test } from 'node:test'

import { runHealth } from '@/commands/health'

const TMP = join(import.meta.dirname, '../../.tmp-health-test')

describe('runHealth', () => {
  let originalExit: typeof process.exit

  beforeEach(() => {
    rmSync(TMP, { recursive: true, force: true })
    mkdirSync(TMP, { recursive: true })

    originalExit = process.exit
  })

  afterEach(() => {
    process.exit = originalExit
    try {
      rmSync(TMP, { recursive: true, force: true })
    } catch {
      // Windows can briefly hold the temp cwd after the bash shim fails.
    }
  })

  test('checks Codex CLI agent and MCP files for codex-cli provider', async () => {
    writeCodexHarnessFixture()

    const result = await captureRunHealth(() => runHealth(TMP))

    assert.equal(result.exitCode, 1)
    assert.match(result.output, /lead\.toml present/)
    assert.match(result.output, /\.codex\/config\.toml valid/)
    assert.doesNotMatch(result.output, /opencode\.json/)
    assert.match(result.output, /Harness checks failed/)
  })
})

async function captureRunHealth(fn: () => Promise<void>): Promise<{
  exitCode: number | null
  output: string
}> {
  let code: number | null = null
  let output = ''
  const originalLog = console.log
  const originalError = console.error

  console.log = (...args: unknown[]) => {
    output += `${args.join(' ')}\n`
    originalLog(...args)
  }
  console.error = (...args: unknown[]) => {
    output += `${args.join(' ')}\n`
    originalError(...args)
  }

  process.exit = ((exitCode?: string | number | null) => {
    code = typeof exitCode === 'number' ? exitCode : 0
    throw new Error(`process.exit:${code}`)
  }) as typeof process.exit

  try {
    await fn()
  } catch (err) {
    if (!(err instanceof Error) || !err.message.startsWith('process.exit:')) {
      throw err
    }
  } finally {
    console.log = originalLog
    console.error = originalError
  }

  return { exitCode: code, output }
}

function writeCodexHarnessFixture(): void {
  writeFileSync(
    join(TMP, 'agent-harness-kit.config.ts'),
    `
export default {
  project: {
    name: 'codex-health-test',
    description: 'Codex health fixture',
    docsPath: './docs',
  },
  provider: 'codex-cli',
  agents: {
    lead: { instructionsPath: null },
    explorer: { instructionsPath: null, allowedPaths: ['./docs', './src'] },
    builder: { instructionsPath: null, writablePaths: ['./src', './tests'] },
    reviewer: { instructionsPath: null },
    custom: [],
  },
  database: { type: 'sqlite', path: '.harness/harness.db' },
  storage: {
    dir: '.harness',
    tasks: { adapter: 'local' },
    sections: {
      toolsUsed: true,
      filesModified: true,
      result: true,
      blockers: true,
      nextSteps: false,
    },
    markdownFallback: { enabled: true, path: '.harness/current.md' },
  },
  health: { scriptPath: './health.sh', required: true },
  tools: {
    mcp: { enabled: true, port: 3742 },
    scripts: { enabled: true, outputDir: './.harness/scripts' },
  },
}
`,
    'utf8',
  )

  mkdirSync(join(TMP, '.harness'), { recursive: true })
  writeFileSync(join(TMP, '.harness/harness.db'), '', 'utf8')

  mkdirSync(join(TMP, '.codex/agents'), { recursive: true })
  for (const agent of ['lead', 'explorer', 'builder', 'reviewer']) {
    writeFileSync(join(TMP, `.codex/agents/${agent}.toml`), `name = "${agent}"\n`, 'utf8')
  }
  // Leave .codex/config.toml absent so runHealth exits after scaffold validation.
  // This keeps the regression focused on provider-specific paths without shelling out.
}
