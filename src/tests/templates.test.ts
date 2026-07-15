import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'

import { getDoctorStatus } from '@/core/doctor'
import { getMaterializer } from '@/core/materializer/index'
import { mergeClaudeMcpJson, mergeClaudeSettingsLocalJson, mergeOpencodeJson } from '@/core/materializer/mcp-merge'
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
import { applyConfigDefaults } from '@/commands/init-helpers'

const TMP = join(import.meta.dirname, '../../.tmp-templates')

function setup() { mkdirSync(TMP, { recursive: true }) }
function teardown() { rmSync(TMP, { recursive: true, force: true }) }

describe('mergeClaudeMcpJson', () => {
  test('creates file when it does not exist', () => {
    setup()
    const path = join(TMP, '.mcp.json')
    mergeClaudeMcpJson(path, 3456)
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    const entry = parsed.mcpServers['agent-harness-kit']
    assert.ok(entry)
    assert.equal(entry.type, 'stdio')
    assert.equal(entry.args[3], '3456')
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
})

describe('mergeOpencodeJson', () => {
  test('creates file when it does not exist', () => {
    setup()
    const path = join(TMP, 'opencode.json')
    mergeOpencodeJson(path, 3456)
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    const entry = parsed.mcp['agent-harness-kit']
    assert.ok(entry)
    assert.equal(entry.type, 'local')
    assert.ok(Array.isArray(entry.command))
    assert.equal(entry.command[entry.command.length - 1], '3456')
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
  }

  test('description with apostrophe produces valid JS', () => {
    const desc = "it's a playground"
    const out = configTs({ ...base, description: desc })
    assert.ok(out.includes(JSON.stringify(desc)), 'description not safely encoded')
    assert.doesNotThrow(() => new Function(out.replace(/^import .+$/gm, '//$&').replace(/^export default /m, 'const _cfg = ')))
  })

  test('description with double quotes produces valid JS', () => {
    const desc = 'a "test" project'
    const out = configTs({ ...base, description: desc })
    assert.ok(out.includes(JSON.stringify(desc)))
    assert.doesNotThrow(() => new Function(out.replace(/^import .+$/gm, '//$&').replace(/^export default /m, 'const _cfg = ')))
  })

  test('description with both apostrophe and double quotes produces valid JS', () => {
    const desc = `it's a "test" project`
    const out = configTs({ ...base, description: desc })
    assert.ok(out.includes(JSON.stringify(desc)))
    assert.doesNotThrow(() => new Function(out.replace(/^import .+$/gm, '//$&').replace(/^export default /m, 'const _cfg = ')))
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
  }

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
