import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'

import { applyConfigDefaults } from '@/commands/init-helpers'
import { getDoctorStatus } from '@/core/doctor'
import { getMaterializer } from '@/core/materializer/index'
import { mergeClaudeMcpJson, mergeClaudeSettingsLocalJson, mergeCodexConfigToml, mergeOpencodeJson } from '@/core/materializer/mcp-merge'
import {
  agentBuilderToml,
  agentExplorerToml,
  configCjs,
  configMjs,
  configTs,
  featureListJson,
  translateFrontmatterForClaudeCode,
  translateFrontmatterForOpenCode,
} from '@/core/materializer/templates'

const TMP = join(import.meta.dirname, '../../.tmp-templates')

function setup() { mkdirSync(TMP, { recursive: true }) }
function teardown() { rmSync(TMP, { recursive: true, force: true }) }

describe('mergeClaudeMcpJson', () => {
  test('creates file when it does not exist (defaults to npm command)', () => {
    setup()
    const path = join(TMP, '.mcp.json')
    mergeClaudeMcpJson(path, 3456)
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    const entry = parsed.mcpServers['agent-harness-kit']
    assert.ok(entry)
    assert.equal(entry.type, 'stdio')
    assert.equal(entry.command, 'npx')
    assert.deepEqual(entry.args, ['--no', 'ahk', 'serve', '--port', '3456'])
    teardown()
  })

  test('preserves existing mcpServers entries', () => {
    setup()
    const path = join(TMP, '.mcp2.json')
    const initial = { mcpServers: { 'other-tool': { command: 'foo', args: [] } } }
    writeFileSync(path, JSON.stringify(initial))
    mergeClaudeMcpJson(path, 3456)
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    assert.ok(parsed.mcpServers['other-tool'])
    assert.ok(parsed.mcpServers['agent-harness-kit'])
    teardown()
  })

  test('generates pnpm command/args when pm is pnpm', () => {
    setup()
    const path = join(TMP, '.mcp3.json')
    mergeClaudeMcpJson(path, 3456, 'pnpm')
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    const entry = parsed.mcpServers['agent-harness-kit']
    assert.equal(entry.command, 'pnpm')
    assert.deepEqual(entry.args, ['exec', 'ahk', 'serve', '--port', '3456'])
    teardown()
  })

  test('generates yarn command/args for both yarn-classic and yarn-berry', () => {
    setup()
    for (const pm of ['yarn-classic', 'yarn-berry'] as const) {
      const path = join(TMP, `.mcp-${pm}.json`)
      mergeClaudeMcpJson(path, 3456, pm)
      const parsed = JSON.parse(readFileSync(path, 'utf8'))
      const entry = parsed.mcpServers['agent-harness-kit']
      assert.equal(entry.command, 'yarn')
      assert.deepEqual(entry.args, ['run', 'ahk', 'serve', '--port', '3456'])
    }
    teardown()
  })

  test('generates bun command/args when pm is bun', () => {
    setup()
    const path = join(TMP, '.mcp-bun.json')
    mergeClaudeMcpJson(path, 3456, 'bun')
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    const entry = parsed.mcpServers['agent-harness-kit']
    assert.equal(entry.command, 'bunx')
    assert.deepEqual(entry.args, ['--no-install', 'ahk', 'serve', '--port', '3456'])
    teardown()
  })
})

describe('mergeOpencodeJson', () => {
  test('creates file when it does not exist (defaults to npm command array)', () => {
    setup()
    const path = join(TMP, 'opencode.json')
    mergeOpencodeJson(path, 3456)
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    const entry = parsed.mcp['agent-harness-kit']
    assert.ok(entry)
    assert.equal(entry.type, 'local')
    assert.ok(Array.isArray(entry.command))
    assert.deepEqual(entry.command, ['npx', '--no', 'ahk', 'serve', '--port', '3456'])
    teardown()
  })

  test('preserves existing mcp entries', () => {
    setup()
    const path = join(TMP, 'opencode2.json')
    const initial = { mcp: { 'other': { type: 'local', command: ['bar'] } } }
    writeFileSync(path, JSON.stringify(initial))
    mergeOpencodeJson(path, 3456)
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    assert.ok(parsed.mcp['other'])
    assert.ok(parsed.mcp['agent-harness-kit'])
    teardown()
  })

  test('generates a single command array (not split command/args) per pm', () => {
    setup()
    const path = join(TMP, 'opencode3.json')
    mergeOpencodeJson(path, 3456, 'pnpm')
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    const entry = parsed.mcp['agent-harness-kit']
    assert.deepEqual(entry.command, ['pnpm', 'exec', 'ahk', 'serve', '--port', '3456'])
    teardown()
  })
})

describe('mergeCodexConfigToml', () => {
  test('creates file when it does not exist (defaults to npm command)', () => {
    setup()
    const path = join(TMP, 'config.toml')
    mergeCodexConfigToml(path, 3456)
    const content = readFileSync(path, 'utf8')
    assert.match(content, /\[mcp_servers\.agent-harness-kit\]/)
    assert.match(content, /command = "npx"/)
    assert.match(content, /args = \["--no","ahk","serve","--port","3456"\]/)
    teardown()
  })

  test('generates pnpm command/args when pm is pnpm', () => {
    setup()
    const path = join(TMP, 'config-pnpm.toml')
    mergeCodexConfigToml(path, 3456, 'pnpm')
    const content = readFileSync(path, 'utf8')
    assert.match(content, /command = "pnpm"/)
    assert.match(content, /args = \["exec","ahk","serve","--port","3456"\]/)
    teardown()
  })

  test('generates yarn command/args when pm is yarn-berry', () => {
    setup()
    const path = join(TMP, 'config-yarn.toml')
    mergeCodexConfigToml(path, 3456, 'yarn-berry')
    const content = readFileSync(path, 'utf8')
    assert.match(content, /command = "yarn"/)
    assert.match(content, /args = \["run","ahk","serve","--port","3456"\]/)
    teardown()
  })

  test('preserves other existing TOML sections when merging', () => {
    setup()
    const path = join(TMP, 'config-preserve.toml')
    writeFileSync(path, '[other_section]\nfoo = "bar"\n')
    mergeCodexConfigToml(path, 3456)
    const content = readFileSync(path, 'utf8')
    assert.match(content, /\[other_section\]/)
    assert.match(content, /foo = "bar"/)
    assert.match(content, /\[mcp_servers\.agent-harness-kit\]/)
    teardown()
  })
})

describe('mergeClaudeSettingsLocalJson', () => {
  test('creates file when it does not exist', () => {
    setup()
    const path = join(TMP, '.claude/settings.local.json')
    mergeClaudeSettingsLocalJson(path)
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    assert.ok(Array.isArray(parsed.permissions.allow))
    assert.ok(parsed.permissions.allow.includes('mcp__agent-harness-kit__actions_start'))
    assert.ok(Array.isArray(parsed.enabledMcpjsonServers))
    assert.ok(parsed.enabledMcpjsonServers.includes('agent-harness-kit'))
    assert.equal(parsed.permissions.allow.length, 19)
    teardown()
  })

  test('preserves existing permissions and merges without duplicates', () => {
    setup()
    const path = join(TMP, '.claude/settings.local.json')
    mkdirSync(join(TMP, '.claude'), { recursive: true })
    const initial = {
      permissions: { allow: ['mcp__agent-harness-kit__actions_start', 'mcp__other__tool'] },
      enabledMcpjsonServers: ['agent-harness-kit', 'other-server'],
    }
    writeFileSync(path, JSON.stringify(initial))
    mergeClaudeSettingsLocalJson(path)
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    // No duplicates — actions_start was already present
    const count = parsed.permissions.allow.filter(
      (e: string) => e === 'mcp__agent-harness-kit__actions_start'
    ).length
    assert.equal(count, 1)
    assert.ok(parsed.permissions.allow.includes('mcp__other__tool'))
    assert.ok(parsed.enabledMcpjsonServers.includes('other-server'))
    const serverCount = parsed.enabledMcpjsonServers.filter(
      (e: string) => e === 'agent-harness-kit'
    ).length
    assert.equal(serverCount, 1)
    teardown()
  })

  test('handles missing permissions key gracefully', () => {
    setup()
    const path = join(TMP, '.claude/settings.local.json')
    mkdirSync(join(TMP, '.claude'), { recursive: true })
    writeFileSync(path, JSON.stringify({ someOtherKey: true }))
    mergeClaudeSettingsLocalJson(path)
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    assert.ok(parsed.someOtherKey)
    assert.ok(Array.isArray(parsed.permissions.allow))
    assert.ok(parsed.permissions.allow.length === 19)
    teardown()
  })
})

describe('featureListJson', () => {
  test('serializes empty list', () => {
    const result = featureListJson([])
    assert.equal(result.trim(), '[]')
  })

  test('serializes tasks correctly', () => {
    const result = featureListJson([{ slug: 'foo', title: 'Foo', acceptance: ['Must work'] }])
    const parsed = JSON.parse(result)
    assert.equal(parsed[0].slug, 'foo')
    assert.deepEqual(parsed[0].acceptance, ['Must work'])
  })
})

describe('translateFrontmatterForOpenCode', () => {
  test('converts tools list to dict format', () => {
    const input = `---\nname: lead\ntools:\n  - Read\n  - Bash\n---\n\n# Body\n`
    const result = translateFrontmatterForOpenCode(input)
    assert.ok(result.includes('tools:\n  read: true\n  bash: true\n'), `Expected dict format, got:\n${result}`)
    assert.ok(!result.includes('- Read'), 'Should not contain list format')
  })

  test('converts all four builder tools', () => {
    const input = `---\nname: builder\ntools:\n  - Read\n  - Write\n  - Edit\n  - Bash\n---\n\n# Body\n`
    const result = translateFrontmatterForOpenCode(input)
    assert.ok(result.includes('  read: true'))
    assert.ok(result.includes('  write: true'))
    assert.ok(result.includes('  edit: true'))
    assert.ok(result.includes('  bash: true'))
  })

  test('leaves other frontmatter fields and body unchanged', () => {
    const input = `---\nname: explorer\ndescription: some desc\ntools:\n  - Read\n---\n\n# Body content\n`
    const result = translateFrontmatterForOpenCode(input)
    assert.ok(result.includes('name: explorer'))
    assert.ok(result.includes('description: some desc'))
    assert.ok(result.includes('# Body content'))
  })
})

describe('configTs', () => {
  const base = {
    name: 'my-app',
    description: 'placeholder',
    provider: 'claude-code',
    docsPath: './docs',
    tasksAdapter: 'local',
    port: 3742,
    scope: 'local' as const,
    projectId: 'test-project-id',
  }

  // Strips TS-only syntax (the `import type` line and the `: HarnessConfig`
  // annotation) so the remaining object literal can be validated as plain
  // JS via `new Function()`.
  function stripTsSyntax(out: string): string {
    return out
      .replace(/^import .+$/gm, '//$&')
      .replace(/^const config: HarnessConfig = /m, 'const config = ')
      .replace(/^export default /m, 'const _cfg = ')
  }

  test('description with apostrophe produces valid JS', () => {
    const desc = "it's a playground"
    const out = configTs({ ...base, description: desc })
    assert.ok(out.includes(JSON.stringify(desc)), 'description not safely encoded')
    assert.doesNotThrow(() => new Function(stripTsSyntax(out)))
  })

  test('description with double quotes produces valid JS', () => {
    const desc = 'a "test" project'
    const out = configTs({ ...base, description: desc })
    assert.ok(out.includes(JSON.stringify(desc)))
    assert.doesNotThrow(() => new Function(stripTsSyntax(out)))
  })

  test('description with both apostrophe and double quotes produces valid JS', () => {
    const desc = `it's a "test" project`
    const out = configTs({ ...base, description: desc })
    assert.ok(out.includes(JSON.stringify(desc)))
    assert.doesNotThrow(() => new Function(stripTsSyntax(out)))
  })

  test('emits scope and projectId explicitly in generated storage section', () => {
    const out = configTs({ ...base, scope: 'global', projectId: 'abc-123' })
    assert.match(out, /scope:\s*'global'/)
    assert.match(out, /projectId:\s*'abc-123'/)
  })

  // ─── scope-conditional shape (task #56) ────────────────────────────────

  test('scope=local emits markdownFallback.path (LocalStorageConfig shape)', () => {
    const out = configTs({ ...base, scope: 'local' })
    assert.match(out, /markdownFallback:\s*\{\s*enabled:\s*true,\s*path:\s*'\.harness\/current\.md'\s*\}/)
    assert.doesNotThrow(() => new Function(stripTsSyntax(out)))
  })

  test('scope=global omits markdownFallback.path (GlobalStorageConfig shape)', () => {
    const out = configTs({ ...base, scope: 'global' })
    assert.match(out, /markdownFallback:\s*\{\s*enabled:\s*true\s*\}/)
    assert.doesNotMatch(out, /markdownFallback:[^\n]*path:/)
    assert.doesNotThrow(() => new Function(stripTsSyntax(out)))
  })

  test('never emits database.path, regardless of scope', () => {
    for (const scope of ['local', 'global'] as const) {
      const out = configTs({ ...base, scope })
      assert.match(out, /database:\s*\{\s*type:\s*'sqlite'\s*\}/)
      assert.doesNotMatch(out, /database:[^\n]*path:/)
    }
  })

  test('uses `import type` for HarnessConfig instead of a value import of defineHarness', () => {
    const out = configTs(base)
    assert.match(out, /^import type \{ HarnessConfig \} from '@cardor\/agent-harness-kit'$/m)
    assert.doesNotMatch(out, /import \{ defineHarness \}/)
    assert.doesNotMatch(out, /defineHarness\(/)
    assert.match(out, /^const config: HarnessConfig = \{/m)
    assert.match(out, /^export default config$/m)
  })
})

describe('configTs — loads without the package resolvable in node_modules', () => {
  test('loadConfig() succeeds on a generated .ts config even with no node_modules/@cardor/agent-harness-kit present', async () => {
    const dir = join(TMP, 'no-local-install')
    mkdirSync(dir, { recursive: true })
    try {
      const out = configTs({
        name: 'my-app',
        description: 'placeholder',
        provider: 'claude-code',
        docsPath: './docs',
        tasksAdapter: 'local',
        port: 3742,
        scope: 'local',
        projectId: 'test-project-id',
      })
      writeFileSync(join(dir, 'agent-harness-kit.config.ts'), out, 'utf8')
      // No node_modules directory at all — the `import type` is erased at
      // compile time by jiti, so module resolution is never attempted.
      const { loadConfig } = await import('@/core/config')
      const config = await loadConfig(dir)
      assert.equal(config.project.name, 'my-app')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('defineHarness — retrocompatibility with the value-import shape', () => {
  test('a hand-written config using `import { defineHarness }` still loads via loadConfig()', async () => {
    const dir = join(TMP, 'value-import-retrocompat')
    mkdirSync(dir, { recursive: true })
    try {
      // Self-dev case: `isLocalInstallSatisfied`/jiti resolve the package
      // against this repo itself when cwd IS the package, so a real value
      // import of `defineHarness` from the package resolves correctly here.
      const legacyConfig = `import { defineHarness } from '@cardor/agent-harness-kit'

export default defineHarness({
  project: { name: 'legacy-app', description: 'legacy shape' },
})
`
      writeFileSync(join(dir, 'agent-harness-kit.config.mjs'), legacyConfig, 'utf8')
      const { loadConfig } = await import('@/core/config')
      const config = await loadConfig(dir)
      assert.equal(config.project.name, 'legacy-app')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('configCjs', () => {
  const base = {
    name: 'my-app',
    description: 'placeholder',
    provider: 'claude-code',
    docsPath: './docs',
    tasksAdapter: 'local',
    port: 3742,
    scope: 'local' as const,
    projectId: 'test-project-id',
  }

  test('emits scope and projectId explicitly in generated storage section', () => {
    const out = configCjs({ ...base, scope: 'global', projectId: 'abc-123' })
    assert.match(out, /scope:\s*'global'/)
    assert.match(out, /projectId:\s*'abc-123'/)
  })

  // ─── scope-conditional shape (task #56) ────────────────────────────────

  test('scope=global omits markdownFallback.path and database.path (GlobalStorageConfig shape)', () => {
    const out = configCjs({ ...base, scope: 'global' })
    assert.match(out, /markdownFallback:\s*\{\s*enabled:\s*true\s*\}/)
    assert.doesNotMatch(out, /markdownFallback:[^\n]*path:/)
    assert.doesNotMatch(out, /database:[^\n]*path:/)
    assert.doesNotThrow(() => new Function(out.replace(/^const .+require.+$/m, '//$&')))
  })

  test('scope=local emits markdownFallback.path (LocalStorageConfig shape)', () => {
    const out = configCjs({ ...base, scope: 'local' })
    assert.match(out, /markdownFallback:\s*\{\s*enabled:\s*true,\s*path:\s*'\.harness\/current\.md'\s*\}/)
  })

  test('description with apostrophe produces valid JS', () => {
    const desc = "it's a playground"
    const out = configCjs({ ...base, description: desc })
    assert.ok(out.includes(JSON.stringify(desc)))
    assert.doesNotThrow(() => new Function(out.replace(/^const .+require.+$/m, '//$&')))
  })

  test('description with double quotes produces valid JS', () => {
    const desc = 'a "test" project'
    const out = configCjs({ ...base, description: desc })
    assert.ok(out.includes(JSON.stringify(desc)))
    assert.doesNotThrow(() => new Function(out.replace(/^const .+require.+$/m, '//$&')))
  })

  test('description with both apostrophe and double quotes produces valid JS', () => {
    const desc = `it's a "test" project`
    const out = configCjs({ ...base, description: desc })
    assert.ok(out.includes(JSON.stringify(desc)))
    assert.doesNotThrow(() => new Function(out.replace(/^const .+require.+$/m, '//$&')))
  })
})

// ─── agent-model-personalization (task 43) ────────────────────────────────────

describe('agent*Toml — model field emission', () => {
  test('omits model line for undefined model', () => {
    const out = agentExplorerToml({ projectName: 'demo', allowedPaths: './src' })
    assert.doesNotMatch(out, /model = /)
  })

  test('omits model line for empty string model', () => {
    const out = agentExplorerToml({ projectName: 'demo', allowedPaths: './src', model: '' })
    assert.doesNotMatch(out, /model = /)
  })

  test('omits model line for whitespace-only model', () => {
    const out = agentExplorerToml({ projectName: 'demo', allowedPaths: './src', model: '   ' })
    assert.doesNotMatch(out, /model = /)
  })

  test('omits model line for a 2-char model (below the 3-char minimum)', () => {
    const out = agentExplorerToml({ projectName: 'demo', allowedPaths: './src', model: 'ab' })
    assert.doesNotMatch(out, /model = /)
  })

  test('includes model line for a valid (>=3 char) model', () => {
    const out = agentBuilderToml({ projectName: 'demo', writablePaths: './src', model: 'gpt-5' })
    assert.match(out, /model = "gpt-5"/)
  })

  test('trims the model value before emitting', () => {
    const out = agentBuilderToml({ projectName: 'demo', writablePaths: './src', model: '  haiku  ' })
    assert.match(out, /model = "haiku"/)
    assert.doesNotMatch(out, /model = "  haiku  "/)
  })
})

describe('translateFrontmatterForClaudeCode — model injection', () => {
  const input = `---\nname: explorer\ndescription: some desc\ntools:\n  - Read\n  - Bash\n---\n\n# Body content\n`

  test('no model configured → no model: line, output unchanged aside from tools block', () => {
    const result = translateFrontmatterForClaudeCode(input, 'explorer')
    assert.doesNotMatch(result, /^model:/m)
  })

  test('model configured → model: line present right after name:', () => {
    const result = translateFrontmatterForClaudeCode(input, 'explorer', 'haiku')
    assert.match(result, /^model: haiku$/m)
    assert.match(result, /name: explorer\nmodel: haiku/)
  })

  test('tools: block (Task + mcp injection) is unaffected by model injection', () => {
    const result = translateFrontmatterForClaudeCode(input, 'explorer', 'haiku')
    assert.ok(result.includes('  - Task'))
    assert.ok(result.includes('mcp__agent-harness-kit__'))
  })
})

describe('doctor.ts — model-aware status (fixes false-positive outdated)', () => {
  const TMP_DOCTOR = join(import.meta.dirname, '../../.tmp-doctor')

  function makeTmp(suffix: string): string {
    const dir = join(TMP_DOCTOR, suffix)
    mkdirSync(dir, { recursive: true })
    return dir
  }

  function cleanup(): void {
    rmSync(TMP_DOCTOR, { recursive: true, force: true })
  }

  test('reports ok (not outdated) for an agent whose live file model matches configured model', async () => {
    const dir = makeTmp('ok-case')
    try {
      const config = applyConfigDefaults({
        name: 'demo-app',
        description: 'demo',
        provider: 'claude-code',
        docsPath: './docs',
        tasksAdapter: 'local',
        models: { explorer: 'haiku', reviewer: 'haiku' },
      })

      const configContent = configMjs({
        name: 'demo-app',
        description: 'demo',
        provider: 'claude-code',
        docsPath: './docs',
        tasksAdapter: 'local',
        port: config.tools.mcp.port,
        models: { explorer: 'haiku', reviewer: 'haiku' },
        scope: config.storage.scope,
        projectId: config.storage.projectId,
      })
      writeFileSync(join(dir, 'agent-harness-kit.config.mjs'), configContent, 'utf8')

      const materializer = getMaterializer('claude-code')
      await materializer.build(config, dir)

      const status = await getDoctorStatus(dir)
      const explorerStatus = status.agents.find((a) => a.name === 'explorer')
      const reviewerStatus = status.agents.find((a) => a.name === 'reviewer')
      assert.equal(explorerStatus?.status, 'ok', 'explorer should be ok when live model matches config')
      assert.equal(reviewerStatus?.status, 'ok', 'reviewer should be ok when live model matches config')
    } finally {
      cleanup()
    }
  })

  test('reports outdated when the live file model diverges from the configured model', async () => {
    const dir = makeTmp('outdated-case')
    try {
      const config = applyConfigDefaults({
        name: 'demo-app',
        description: 'demo',
        provider: 'claude-code',
        docsPath: './docs',
        tasksAdapter: 'local',
        models: { explorer: 'haiku' },
      })

      const configContent = configMjs({
        name: 'demo-app',
        description: 'demo',
        provider: 'claude-code',
        docsPath: './docs',
        tasksAdapter: 'local',
        port: config.tools.mcp.port,
        models: { explorer: 'haiku' },
        scope: config.storage.scope,
        projectId: config.storage.projectId,
      })
      writeFileSync(join(dir, 'agent-harness-kit.config.mjs'), configContent, 'utf8')

      const materializer = getMaterializer('claude-code')
      await materializer.build(config, dir)

      // Simulate drift: live file has a different model than what's configured
      const explorerPath = join(dir, '.claude/agents/explorer.md')
      const live = readFileSync(explorerPath, 'utf8')
      writeFileSync(explorerPath, live.replace('model: haiku', 'model: opus'), 'utf8')

      const status = await getDoctorStatus(dir)
      const explorerStatus = status.agents.find((a) => a.name === 'explorer')
      assert.equal(explorerStatus?.status, 'outdated')
    } finally {
      cleanup()
    }
  })
})
