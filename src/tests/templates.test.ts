import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'

import { applyConfigDefaults } from '@/commands/init-helpers'
import { getDoctorStatus } from '@/core/doctor'
import { getMaterializer } from '@/core/materializer/index'
import { pkg } from '@/core/package-data'
import { mergeClaudeMcpJson, mergeClaudeSettingsLocalJson, mergeCodexConfigToml, mergeOpencodeJson } from '@/core/materializer/mcp-merge'
import {
  __configObjectForTests,
  agentBuilderToml,
  agentConsultantToml,
  agentExplorerToml,
  agentLeadAsDefaultToml,
  agentLeadToml,
  agentReviewerToml,
  configCjs,
  configJson,
  configMjs,
  configTs,
  featureListJson,
  translateFrontmatterForClaudeCode,
  translateFrontmatterForOpenCode,
} from '@/core/materializer/templates'

const TMP = join(import.meta.dirname, '../../.tmp-templates')

function setup() { mkdirSync(TMP, { recursive: true }) }
function teardown() { rmSync(TMP, { recursive: true, force: true }) }

// The merger suites below assert the package-manager-mediated command shape,
// which only applies when the package is installed locally in the project
// being configured. TMP is the cwd passed to those mergers, so it must
// genuinely look like such a project — otherwise getMcpCommandParts correctly
// falls back to the bare global `ahk` binary. Making the fixture state that
// intent explicitly is the point; see the dedicated global-install suite for
// the other branch.
function setupLocalInstall() {
  setup()
  const [scope, name] = pkg.name.split('/')
  mkdirSync(join(TMP, 'node_modules', scope, name), { recursive: true })
}

describe('mergeClaudeMcpJson', () => {
  test('creates file when it does not exist (defaults to npm command)', () => {
    setupLocalInstall()
    const path = join(TMP, '.mcp.json')
    mergeClaudeMcpJson(path, 3456, TMP)
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    const entry = parsed.mcpServers['agent-harness-kit']
    assert.ok(entry)
    assert.equal(entry.type, 'stdio')
    assert.equal(entry.command, 'npx')
    assert.deepEqual(entry.args, ['--no', 'ahk', 'serve', '--port', '3456'])
    teardown()
  })

  test('preserves existing mcpServers entries', () => {
    setupLocalInstall()
    const path = join(TMP, '.mcp2.json')
    const initial = { mcpServers: { 'other-tool': { command: 'foo', args: [] } } }
    writeFileSync(path, JSON.stringify(initial))
    mergeClaudeMcpJson(path, 3456, TMP)
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    assert.ok(parsed.mcpServers['other-tool'])
    assert.ok(parsed.mcpServers['agent-harness-kit'])
    teardown()
  })

  test('generates pnpm command/args when pm is pnpm', () => {
    setupLocalInstall()
    const path = join(TMP, '.mcp3.json')
    mergeClaudeMcpJson(path, 3456, TMP, 'pnpm')
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    const entry = parsed.mcpServers['agent-harness-kit']
    assert.equal(entry.command, 'pnpm')
    assert.deepEqual(entry.args, ['exec', 'ahk', 'serve', '--port', '3456'])
    teardown()
  })

  test('generates yarn command/args for both yarn-classic and yarn-berry', () => {
    setupLocalInstall()
    for (const pm of ['yarn-classic', 'yarn-berry'] as const) {
      const path = join(TMP, `.mcp-${pm}.json`)
      mergeClaudeMcpJson(path, 3456, TMP, pm)
      const parsed = JSON.parse(readFileSync(path, 'utf8'))
      const entry = parsed.mcpServers['agent-harness-kit']
      assert.equal(entry.command, 'yarn')
      assert.deepEqual(entry.args, ['run', 'ahk', 'serve', '--port', '3456'])
    }
    teardown()
  })

  test('generates bun command/args when pm is bun', () => {
    setupLocalInstall()
    const path = join(TMP, '.mcp-bun.json')
    mergeClaudeMcpJson(path, 3456, TMP, 'bun')
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    const entry = parsed.mcpServers['agent-harness-kit']
    assert.equal(entry.command, 'bunx')
    assert.deepEqual(entry.args, ['--no-install', 'ahk', 'serve', '--port', '3456'])
    teardown()
  })
})

describe('mergeOpencodeJson', () => {
  test('creates file when it does not exist (defaults to npm command array)', () => {
    setupLocalInstall()
    const path = join(TMP, 'opencode.json')
    mergeOpencodeJson(path, 3456, TMP)
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    const entry = parsed.mcp['agent-harness-kit']
    assert.ok(entry)
    assert.equal(entry.type, 'local')
    assert.ok(Array.isArray(entry.command))
    assert.deepEqual(entry.command, ['npx', '--no', 'ahk', 'serve', '--port', '3456'])
    teardown()
  })

  test('preserves existing mcp entries', () => {
    setupLocalInstall()
    const path = join(TMP, 'opencode2.json')
    const initial = { mcp: { 'other': { type: 'local', command: ['bar'] } } }
    writeFileSync(path, JSON.stringify(initial))
    mergeOpencodeJson(path, 3456, TMP)
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    assert.ok(parsed.mcp['other'])
    assert.ok(parsed.mcp['agent-harness-kit'])
    teardown()
  })

  test('generates a single command array (not split command/args) per pm', () => {
    setupLocalInstall()
    const path = join(TMP, 'opencode3.json')
    mergeOpencodeJson(path, 3456, TMP, 'pnpm')
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    const entry = parsed.mcp['agent-harness-kit']
    assert.deepEqual(entry.command, ['pnpm', 'exec', 'ahk', 'serve', '--port', '3456'])
    teardown()
  })
})

describe('mergeCodexConfigToml', () => {
  test('creates file when it does not exist (defaults to npm command)', () => {
    setupLocalInstall()
    const path = join(TMP, 'config.toml')
    mergeCodexConfigToml(path, 3456, TMP)
    const content = readFileSync(path, 'utf8')
    assert.match(content, /\[mcp_servers\.agent-harness-kit\]/)
    assert.match(content, /command = "npx"/)
    assert.match(content, /args = \["--no","ahk","serve","--port","3456"\]/)
    teardown()
  })

  test('generates pnpm command/args when pm is pnpm', () => {
    setupLocalInstall()
    const path = join(TMP, 'config-pnpm.toml')
    mergeCodexConfigToml(path, 3456, TMP, 'pnpm')
    const content = readFileSync(path, 'utf8')
    assert.match(content, /command = "pnpm"/)
    assert.match(content, /args = \["exec","ahk","serve","--port","3456"\]/)
    teardown()
  })

  test('generates yarn command/args when pm is yarn-berry', () => {
    setupLocalInstall()
    const path = join(TMP, 'config-yarn.toml')
    mergeCodexConfigToml(path, 3456, TMP, 'yarn-berry')
    const content = readFileSync(path, 'utf8')
    assert.match(content, /command = "yarn"/)
    assert.match(content, /args = \["run","ahk","serve","--port","3456"\]/)
    teardown()
  })

  test('preserves other existing TOML sections when merging', () => {
    setupLocalInstall()
    const path = join(TMP, 'config-preserve.toml')
    writeFileSync(path, '[other_section]\nfoo = "bar"\n')
    mergeCodexConfigToml(path, 3456, TMP)
    const content = readFileSync(path, 'utf8')
    assert.match(content, /\[other_section\]/)
    assert.match(content, /foo = "bar"/)
    assert.match(content, /\[mcp_servers\.agent-harness-kit\]/)
    teardown()
  })
})

describe('mergers — global install emits the bare ahk binary', () => {
  // setup() leaves TMP bare: no package.json, no node_modules/@cardor/agent-harness-kit.
  // That is exactly what a project configured against a globally installed
  // ahk looks like, so no package manager can resolve the binary and the
  // command must bypass the package manager entirely.

  test('mergeClaudeMcpJson splits into bare command/args regardless of pm', () => {
    for (const pm of ['npm', 'pnpm', 'yarn-classic', 'yarn-berry', 'bun'] as const) {
      setup()
      const path = join(TMP, `.mcp-global-${pm}.json`)
      mergeClaudeMcpJson(path, 3456, TMP, pm)
      const entry = JSON.parse(readFileSync(path, 'utf8')).mcpServers['agent-harness-kit']
      assert.equal(entry.type, 'stdio')
      assert.equal(entry.command, 'ahk')
      assert.deepEqual(entry.args, ['serve', '--port', '3456'])
      teardown()
    }
  })

  test('mergeOpencodeJson emits a single bare command array regardless of pm', () => {
    for (const pm of ['npm', 'pnpm', 'yarn-classic', 'yarn-berry', 'bun'] as const) {
      setup()
      const path = join(TMP, `opencode-global-${pm}.json`)
      mergeOpencodeJson(path, 3456, TMP, pm)
      const entry = JSON.parse(readFileSync(path, 'utf8')).mcp['agent-harness-kit']
      assert.equal(entry.type, 'local')
      assert.deepEqual(entry.command, ['ahk', 'serve', '--port', '3456'])
      teardown()
    }
  })

  test('mergeCodexConfigToml writes bare command/args regardless of pm', () => {
    for (const pm of ['npm', 'pnpm', 'yarn-classic', 'yarn-berry', 'bun'] as const) {
      setup()
      const path = join(TMP, `config-global-${pm}.toml`)
      mergeCodexConfigToml(path, 3456, TMP, pm)
      const content = readFileSync(path, 'utf8')
      assert.match(content, /\[mcp_servers\.agent-harness-kit\]/)
      assert.match(content, /command = "ahk"/)
      assert.match(content, /args = \["serve","--port","3456"\]/)
      teardown()
    }
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

describe('translateFrontmatterForOpenCode — permission translation', () => {
  test('restricted role emits permission: { edit: deny } and no tools key', () => {
    const input = `---\nname: explorer\ndescription: some desc\n---\n\n# Body\n`
    const result = translateFrontmatterForOpenCode(input, 'explorer')
    assert.match(result, /^permission:\n  edit: deny$/m)
    assert.doesNotMatch(result, /^tools:/m)
  })

  test('emits ONLY edit — OpenCode has no separate write permission', () => {
    const result = translateFrontmatterForOpenCode(`---\nname: lead\n---\n\n# Body\n`, 'lead')
    assert.doesNotMatch(result, /^\s+write:/m)
    assert.doesNotMatch(result, /^\s+patch:/m)
    assert.equal(result.match(/^\s+\w+: deny$/gm)?.length, 1)
  })

  test('builder (unrestricted) emits no permission block at all', () => {
    const result = translateFrontmatterForOpenCode(`---\nname: builder\n---\n\n# Body\n`, 'builder')
    assert.doesNotMatch(result, /^permission:/m)
    assert.doesNotMatch(result, /^tools:/m)
  })

  test('never emits the deprecated tools dict, even when input still carries a tools list', () => {
    const input = `---\nname: explorer\ntools:\n  - Read\n  - Bash\n---\n\n# Body\n`
    const result = translateFrontmatterForOpenCode(input, 'explorer')
    assert.doesNotMatch(result, /^tools:/m)
    assert.ok(!result.includes('read: true'), 'deprecated tools dict must not be emitted')
  })

  test('never emits Claude Code style mcp__ patterns (OpenCode uses <server>_<tool>)', () => {
    const result = translateFrontmatterForOpenCode(`---\nname: reviewer\n---\n\n# Body\n`, 'reviewer')
    assert.doesNotMatch(result, /mcp__/)
  })

  test('leaves other frontmatter fields and body unchanged', () => {
    const input = `---\nname: explorer\ndescription: some desc\n---\n\n# Body content\n`
    const result = translateFrontmatterForOpenCode(input, 'explorer')
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

// ─── configJson (task #61) ───────────────────────────────────────────────────
//
// Emitted when the package is not installed locally. Coverage mirrors configTs
// and configCjs — quote/apostrophe escaping, scope-conditional storage, no
// database.path — plus what is specific to this variant: nothing referencing
// the package, and a shape identical to its JS twins.

describe('configJson', () => {
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

  const parse = (out: string): Record<string, Record<string, unknown>> =>
    JSON.parse(out) as Record<string, Record<string, unknown>>

  test('emits valid, parseable JSON', () => {
    assert.doesNotThrow(() => parse(configJson(base)))
  })

  test('description with apostrophe round-trips intact', () => {
    const desc = "it's a playground"
    assert.equal(parse(configJson({ ...base, description: desc })).project.description, desc)
  })

  test('description with double quotes round-trips intact', () => {
    const desc = 'a "test" project'
    assert.equal(parse(configJson({ ...base, description: desc })).project.description, desc)
  })

  test('description with both apostrophe and double quotes round-trips intact', () => {
    const desc = `it's a "test" project`
    assert.equal(parse(configJson({ ...base, description: desc })).project.description, desc)
  })

  test('description with a backslash and a newline round-trips intact', () => {
    // Free via JSON.stringify, but pinned because these are exactly the
    // characters a hand-rolled string template gets wrong.
    const desc = 'path C:\\tmp\nsecond line'
    assert.equal(parse(configJson({ ...base, description: desc })).project.description, desc)
  })

  test('emits scope and projectId explicitly in the storage section', () => {
    const cfg = parse(configJson({ ...base, scope: 'global', projectId: 'abc-123' }))
    assert.equal(cfg.storage.scope, 'global')
    assert.equal(cfg.storage.projectId, 'abc-123')
  })

  test('scope=local emits markdownFallback.path (LocalStorageConfig shape)', () => {
    const cfg = parse(configJson({ ...base, scope: 'local' }))
    assert.deepEqual(cfg.storage.markdownFallback, { enabled: true, path: '.harness/current.md' })
  })

  test('scope=global omits markdownFallback.path (GlobalStorageConfig shape)', () => {
    const cfg = parse(configJson({ ...base, scope: 'global' }))
    assert.deepEqual(cfg.storage.markdownFallback, { enabled: true })
    assert.ok(!('path' in (cfg.storage.markdownFallback as Record<string, unknown>)))
  })

  test('never emits database.path, regardless of scope', () => {
    for (const scope of ['local', 'global'] as const) {
      const cfg = parse(configJson({ ...base, scope }))
      assert.deepEqual(cfg.database, { type: 'sqlite' })
      assert.ok(!('path' in cfg.database))
    }
  })

  test('never emits storage.sqlitePath, regardless of scope', () => {
    for (const scope of ['local', 'global'] as const) {
      assert.ok(!('sqlitePath' in parse(configJson({ ...base, scope })).storage))
    }
  })

  test('has no agents key', () => {
    // Task 60 removed the key; the newest generator must not reintroduce it,
    // or every JSON-config user would immediately trip the legacy warning in
    // normalizeLegacyAgentsKey().
    assert.ok(!('agents' in parse(configJson(base))))
  })

  test('contains no import and no reference to the package — the point of the format', () => {
    const out = configJson(base)
    assert.doesNotMatch(out, /@cardor\/agent-harness-kit/)
    assert.doesNotMatch(out, /\bimport\b/)
    assert.doesNotMatch(out, /HarnessConfig/)
    assert.doesNotMatch(out, /defineHarness/)
  })

  test('emits no $schema key (no schema is published or shipped today)', () => {
    // A $schema pointing at a URL that does not resolve trades a type error
    // for a fetch error. Flip this test when a schema is actually published.
    assert.ok(!('$schema' in parse(configJson(base))))
  })

  test('produces the same shape as the .ts config for both scopes', () => {
    // The anti-drift guard: configObjectBody() (a hand-formatted string, so it
    // can carry comments) and configObject() (real data for JSON) are
    // maintained in parallel. A field added to one and not the other fails here.
    function evalTsConfig(out: string): Record<string, unknown> {
      const src =
        out
          .replace(/^import .+$/gm, '//$&')
          .replace(/^const config: HarnessConfig = /m, 'const config = ')
          .replace(/^export default .+$/m, '') + '\nreturn config'
      return new Function(src)() as Record<string, unknown>
    }
    for (const scope of ['local', 'global'] as const) {
      const params = { ...base, scope }
      assert.deepEqual(
        JSON.parse(configJson(params)),
        evalTsConfig(configTs(params)),
        `JSON and TS config shapes diverged for scope=${scope}`,
      )
    }
  })

  test('configObject matches the emitted JSON exactly', () => {
    assert.deepEqual(JSON.parse(configJson(base)), __configObjectForTests(base))
  })

  test('ends with a trailing newline', () => {
    assert.ok(configJson(base).endsWith('\n'))
  })
})

describe('configJson — loaded by loadConfig()', () => {
  test('loadConfig() reads a generated .json config with no node_modules present', async () => {
    const dir = join(TMP, 'json-config-load')
    mkdirSync(dir, { recursive: true })
    try {
      const out = configJson({
        name: 'my-app',
        description: "it's a \"quoted\" app",
        provider: 'claude-code',
        docsPath: './docs',
        tasksAdapter: 'local',
        port: 3742,
        scope: 'local',
        projectId: 'test-project-id',
      })
      writeFileSync(join(dir, 'agent-harness-kit.config.json'), out, 'utf8')
      const { loadConfig } = await import('@/core/config')
      const config = await loadConfig(dir)
      assert.equal(config.project.name, 'my-app')
      assert.equal(config.project.description, 'it\'s a "quoted" app')
      assert.equal(config.storage.scope, 'local')
      assert.equal(config.storage.projectId, 'test-project-id')
      // Defaults still applied for a JSON config, same as any other format.
      assert.equal(config.project.agentsMd, './AGENTS.md')
      assert.equal(config.tools.mcp.port, 3742)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('legacy normalizers apply to a JSON config exactly as to a .ts one', async () => {
    const dir = join(TMP, 'json-config-legacy')
    mkdirSync(dir, { recursive: true })
    try {
      // Hand-written JSON carrying both removed/contradictory shapes: the
      // `agents` key (removed in task 60) and global scope alongside
      // now-meaningless local-only paths. Must load, not crash, and be stripped.
      writeFileSync(
        join(dir, 'agent-harness-kit.config.json'),
        JSON.stringify({
          project: { name: 'legacy-json', description: 'legacy shape' },
          agents: { explorer: { model: 'opus', allowedPaths: ['src/'] } },
          database: { type: 'sqlite', path: '.harness/harness.db' },
          storage: {
            scope: 'global',
            projectId: 'legacy-id',
            sqlitePath: '.harness/harness.db',
            markdownFallback: { enabled: true, path: '.harness/current.md' },
          },
        }),
        'utf8',
      )
      const { loadConfig } = await import('@/core/config')
      const config = await loadConfig(dir)
      assert.equal(config.project.name, 'legacy-json')
      assert.ok(!('agents' in config), 'the removed agents key must be stripped')
      // Double cast: the typed unions (DatabaseConfig, StorageConfig) do not
      // declare the legacy fields at all, which is exactly why they have to be
      // asserted as absent at runtime on the untyped shape.
      assert.ok(!('path' in (config.database as unknown as Record<string, unknown>)))
      assert.ok(!('sqlitePath' in (config.storage as unknown as Record<string, unknown>)))
      assert.ok(!('path' in (config.storage.markdownFallback as unknown as Record<string, unknown>)))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('a malformed .json config fails with a message naming the file', async () => {
    const dir = join(TMP, 'json-config-malformed')
    mkdirSync(dir, { recursive: true })
    try {
      writeFileSync(join(dir, 'agent-harness-kit.config.json'), '{ "project": ', 'utf8')
      const { loadConfig } = await import('@/core/config')
      await assert.rejects(() => loadConfig(dir), /agent-harness-kit\.config\.json is not valid JSON/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('an existing config of another extension keeps precedence over a .json one', async () => {
    // The format choice must never silently convert an initialized project
    // just because its local-install state changed. `ahk init` bails out when
    // any config exists, and findConfigFile keeps resolving the original.
    const dir = join(TMP, 'json-config-precedence')
    mkdirSync(dir, { recursive: true })
    try {
      writeFileSync(
        join(dir, 'agent-harness-kit.config.mjs'),
        configMjs({
          name: 'the-mjs-one',
          description: 'pre-existing',
          provider: 'claude-code',
          docsPath: './docs',
          tasksAdapter: 'local',
          port: 3742,
          scope: 'local',
          projectId: 'mjs-id',
        }),
        'utf8',
      )
      writeFileSync(
        join(dir, 'agent-harness-kit.config.json'),
        configJson({
          name: 'the-json-one',
          description: 'newcomer',
          provider: 'claude-code',
          docsPath: './docs',
          tasksAdapter: 'local',
          port: 3742,
          scope: 'local',
          projectId: 'json-id',
        }),
        'utf8',
      )
      const { findConfigFile, loadConfig } = await import('@/core/config')
      assert.match(findConfigFile(dir) ?? '', /agent-harness-kit\.config\.mjs$/)
      const config = await loadConfig(dir)
      assert.equal(config.project.name, 'the-mjs-one')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// ─── no generated model line (replaces the task-43 model-personalization suite)
//
// The per-agent `model` config was removed along with the whole `agents` key.
// The generated agent file is user-owned, so the model is set by editing the
// file. Emitting NO model line is what makes that work: each provider then
// applies its own default, which is exactly what the old 'inherit' option meant.
// These tests pin the absence, because a reintroduced model line would silently
// override the user's own edit on every --force regeneration.

describe('agent*Toml — never emits a model line', () => {
  const generators: [string, () => string][] = [
    ['lead', () => agentLeadToml({ projectName: 'demo' })],
    ['explorer', () => agentExplorerToml({ projectName: 'demo' })],
    ['consultant', () => agentConsultantToml({ projectName: 'demo' })],
    ['builder', () => agentBuilderToml({ projectName: 'demo' })],
    ['reviewer', () => agentReviewerToml({ projectName: 'demo' })],
    ['default (lead shim)', () => agentLeadAsDefaultToml({ projectName: 'demo' })],
  ]

  for (const [role, generate] of generators) {
    test(`${role}: no model = line`, () => {
      assert.doesNotMatch(generate(), /model\s*=/)
    })
  }

  test('sandbox_mode survives — removing model must not disturb the real restriction', () => {
    assert.match(agentExplorerToml({ projectName: 'demo' }), /sandbox_mode = "read-only"/)
    assert.match(agentBuilderToml({ projectName: 'demo' }), /sandbox_mode = "workspace-write"/)
  })
})

describe('translateFrontmatterForClaudeCode — never emits a model line', () => {
  const input = `---\nname: explorer\ndescription: some desc\n---\n\n# Body content\n`

  test('no model: line is injected', () => {
    assert.doesNotMatch(translateFrontmatterForClaudeCode(input, 'explorer'), /^model:/m)
  })

  test('a user-authored model: line is preserved, not stripped or rewritten', () => {
    // The whole point of user ownership: --force regenerates from the template,
    // but the translator itself must never touch a model line it finds.
    const withModel = `---\nname: explorer\nmodel: opus\ndescription: some desc\n---\n\n# Body\n`
    const result = translateFrontmatterForClaudeCode(withModel, 'explorer')
    assert.match(result, /^model: opus$/m)
  })

  test('disallowedTools block is still emitted', () => {
    const result = translateFrontmatterForClaudeCode(input, 'explorer')
    assert.match(result, /^disallowedTools:\n  - Write\n  - Edit$/m)
  })
})

describe('translateFrontmatterForClaudeCode — denylist translation', () => {
  const fm = (name: string) => `---\nname: ${name}\ndescription: some desc\n---\n\n# Body content\n`

  for (const role of ['lead', 'explorer', 'consultant', 'reviewer'] as const) {
    test(`${role} (no-write) emits disallowedTools as a YAML block sequence`, () => {
      const result = translateFrontmatterForClaudeCode(fm(role), role)
      assert.match(result, /^disallowedTools:\n  - Write\n  - Edit$/m)
      // Block sequence, not the inline comma form.
      assert.doesNotMatch(result, /^disallowedTools:\s*Write/m)
    })
  }

  test('builder (unrestricted) emits no disallowedTools at all', () => {
    const result = translateFrontmatterForClaudeCode(fm('builder'), 'builder')
    assert.doesNotMatch(result, /disallowedTools/)
  })

  test('tools is omitted entirely so the agent inherits Task and all mcp__ tools', () => {
    for (const role of ['lead', 'explorer', 'consultant', 'builder', 'reviewer'] as const) {
      const result = translateFrontmatterForClaudeCode(fm(role), role)
      assert.doesNotMatch(result, /^tools:/m, `${role} must not pin an allowlist`)
      assert.doesNotMatch(result, /mcp__agent-harness-kit__/, `${role} must not enumerate MCP tools`)
      assert.doesNotMatch(result, /^\s+- Task$/m, `${role} must not enumerate Task`)
    }
  })

  test('is idempotent — re-translating already-translated output is stable', () => {
    const once = translateFrontmatterForClaudeCode(fm('explorer'), 'explorer')
    const twice = translateFrontmatterForClaudeCode(once, 'explorer')
    assert.equal(twice, once)
  })

  test('strips a legacy tools allowlist carried in the input', () => {
    const legacy = `---\nname: explorer\ntools:\n  - Read\n  - Bash\n  - Task\n---\n\n# Body\n`
    const result = translateFrontmatterForClaudeCode(legacy, 'explorer')
    assert.doesNotMatch(result, /^tools:/m)
    assert.match(result, /^disallowedTools:\n  - Write\n  - Edit$/m)
  })

  test('body content survives translation untouched', () => {
    const result = translateFrontmatterForClaudeCode(fm('lead'), 'lead')
    assert.ok(result.includes('# Body content'))
    assert.ok(result.includes('description: some desc'))
  })
})

describe('agent*Toml — sandbox_mode and restriction reinforcement (Codex CLI)', () => {
  test('read-only roles get sandbox_mode = "read-only"', () => {
    const out = agentExplorerToml({ projectName: 'demo' })
    assert.match(out, /^sandbox_mode = "read-only"$/m)
  })

  test('builder gets sandbox_mode = "workspace-write"', () => {
    const out = agentBuilderToml({ projectName: 'demo' })
    assert.match(out, /^sandbox_mode = "workspace-write"$/m)
  })

  test('read-only roles restate the prohibition in developer_instructions', () => {
    // Codex keeps write tools visible to the model, so config alone is not
    // enough — the restriction must also appear in the instructions.
    const out = agentExplorerToml({ projectName: 'demo' })
    const instructions = out.split('developer_instructions = """')[1]
    assert.ok(instructions, 'developer_instructions block missing')
    assert.match(instructions, /sandbox_mode = .read-only/)
    assert.match(instructions, /MUST NOT create, modify, or delete any file/)
  })

  test('builder instructions carry no read-only notice', () => {
    const out = agentBuilderToml({ projectName: 'demo' })
    assert.doesNotMatch(out, /MUST NOT create, modify, or delete any file/)
  })

  test('Codex emits no tool denylist — it has no such mechanism', () => {
    const out = agentExplorerToml({ projectName: 'demo' })
    assert.doesNotMatch(out, /^disallowed_tools/m)
    assert.doesNotMatch(out, /^allowed_tools/m)
  })
})

describe('doctor.ts — agent files are existence-checked only', () => {
  const TMP_DOCTOR = join(import.meta.dirname, '../../.tmp-doctor')

  function makeTmp(suffix: string): string {
    const dir = join(TMP_DOCTOR, suffix)
    mkdirSync(dir, { recursive: true })
    return dir
  }

  function cleanup(): void {
    rmSync(TMP_DOCTOR, { recursive: true, force: true })
  }

  async function buildProject(dir: string): Promise<void> {
    const config = applyConfigDefaults({
      name: 'demo-app',
      description: 'demo',
      provider: 'claude-code',
      docsPath: './docs',
      tasksAdapter: 'local',
    })
    const configContent = configMjs({
      name: 'demo-app',
      description: 'demo',
      provider: 'claude-code',
      docsPath: './docs',
      tasksAdapter: 'local',
      port: config.tools.mcp.port,
      scope: config.storage.scope,
      projectId: config.storage.projectId,
    })
    writeFileSync(join(dir, 'agent-harness-kit.config.mjs'), configContent, 'utf8')
    await getMaterializer('claude-code').build(config, dir)
  }

  test('a freshly built project reports every agent as ok', async () => {
    const dir = makeTmp('fresh')
    try {
      await buildProject(dir)
      const status = await getDoctorStatus(dir)
      assert.equal(status.agents.length, 5)
      for (const agent of status.agents) {
        assert.equal(agent.status, 'ok', `${agent.name} should be ok`)
      }
    } finally {
      cleanup()
    }
  })

  test('hand-editing an agent body does NOT report outdated', async () => {
    const dir = makeTmp('edited-body')
    try {
      await buildProject(dir)
      const explorerPath = join(dir, '.claude/agents/explorer.md')
      const live = readFileSync(explorerPath, 'utf8')
      writeFileSync(explorerPath, live + '\n\n## My own custom section\n\nHand written.\n', 'utf8')

      const status = await getDoctorStatus(dir)
      assert.equal(status.agents.find((a) => a.name === 'explorer')?.status, 'ok')
    } finally {
      cleanup()
    }
  })

  test('hand-editing agent frontmatter does NOT report outdated', async () => {
    const dir = makeTmp('edited-frontmatter')
    try {
      await buildProject(dir)
      const explorerPath = join(dir, '.claude/agents/explorer.md')
      const live = readFileSync(explorerPath, 'utf8')
      writeFileSync(explorerPath, live.replace('model: haiku', 'model: opus'), 'utf8')

      const status = await getDoctorStatus(dir)
      assert.equal(status.agents.find((a) => a.name === 'explorer')?.status, 'ok')
    } finally {
      cleanup()
    }
  })

  test('replacing an agent file with unrelated content does NOT report outdated', async () => {
    const dir = makeTmp('clobbered')
    try {
      await buildProject(dir)
      writeFileSync(join(dir, '.claude/agents/reviewer.md'), 'totally different content\n', 'utf8')

      const status = await getDoctorStatus(dir)
      assert.equal(status.agents.find((a) => a.name === 'reviewer')?.status, 'ok')
    } finally {
      cleanup()
    }
  })

  test('deleting an agent file DOES report missing', async () => {
    const dir = makeTmp('deleted')
    try {
      await buildProject(dir)
      rmSync(join(dir, '.claude/agents/builder.md'))

      const status = await getDoctorStatus(dir)
      assert.equal(status.agents.find((a) => a.name === 'builder')?.status, 'missing')
      // Unrelated agents stay ok.
      assert.equal(status.agents.find((a) => a.name === 'lead')?.status, 'ok')
    } finally {
      cleanup()
    }
  })

  test("'outdated' is never reported for any agent, under any edit", async () => {
    const dir = makeTmp('never-outdated')
    try {
      await buildProject(dir)
      for (const name of ['lead', 'explorer', 'consultant', 'builder', 'reviewer']) {
        writeFileSync(join(dir, `.claude/agents/${name}.md`), 'clobbered\n', 'utf8')
      }
      const status = await getDoctorStatus(dir)
      assert.equal(status.agents.filter((a) => (a.status as string) === 'outdated').length, 0)
    } finally {
      cleanup()
    }
  })
})

// ─── The generated config has no `agents` key ────────────────────────────────
//
// Successor to `configTs — no per-agent path fields`. The path fields went
// first (prompt text that described a restriction without imposing one); the
// rest of the key followed, because everything left in it was either dead
// (`instructionsPath`, `context`, `custom`) or better expressed in the agent
// file itself (`model`). A freshly generated config must reintroduce none of it.

describe('configTs — no `agents` key', () => {
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

  // Evaluate the generated config back into a real object so the assertions
  // inspect structure rather than matching source text.
  function evalConfig(out: string): Record<string, unknown> {
    const src =
      out
        .replace(/^import .+$/gm, '//$&')
        .replace(/^const config: HarnessConfig = /m, 'const config = ')
        .replace(/^export default .+$/m, '') + '\nreturn config'
    return new Function(src)() as Record<string, unknown>
  }

  test('the generated config object has no agents key', () => {
    assert.ok(!('agents' in evalConfig(configTs(base))), 'generated config must not declare agents')
  })

  test('a config generated today loads without tripping the legacy warning', () => {
    // Closes the loop with normalizeLegacyAgentsKey(): the generator must not
    // emit the very shape the loader warns about, or every user would see a
    // deprecation warning on a brand-new project.
    const config = evalConfig(configTs(base))
    assert.ok(!('agents' in config))
  })

  test('the removed field names appear nowhere in the generated file', () => {
    const out = configTs(base)
    for (const field of ['allowedPaths', 'writablePaths', 'instructionsPath', 'custom']) {
      assert.doesNotMatch(out, new RegExp(`${field}\\s*:`), `${field} must not be declared`)
    }
    // `agents:` as a config key. The word may still appear inside comments and
    // in paths like `.claude/agents/`, which is why this is anchored.
    assert.doesNotMatch(out, /^\s*agents\s*:/m)
  })

  test('the old narrow ./src + ./tests defaults are not reintroduced', () => {
    const out = configTs(base)
    assert.doesNotMatch(out, /writablePaths:\s*\[\s*'\.\/src',\s*'\.\/tests'\s*\]/)
    assert.doesNotMatch(out, /allowedPaths:\s*\[\s*'\.\/docs',\s*'\.\/src'\s*\]/)
  })

  test('the mjs and cjs generators are equally free of the key', () => {
    for (const gen of [configMjs, configCjs]) {
      const out = gen(base)
      assert.doesNotMatch(out, /^\s*agents\s*:/m)
      assert.doesNotMatch(out, /instructionsPath\s*:/)
    }
  })
})

describe('agent prompt text — no path placeholders (task #59)', () => {
  test('the builder prompt states its scope without an uninterpolated placeholder', () => {
    const builder = agentBuilderToml({ projectName: 'demo' })
    assert.doesNotMatch(builder, /\{\{writablePaths\}\}/)
    assert.doesNotMatch(builder, /\{\{allowedPaths\}\}/)
    // The real restriction — the one that is actually enforced — must remain.
    assert.match(builder, /sandbox_mode = "workspace-write"/)
  })

  test('the explorer prompt carries no path placeholder and stays read-only', () => {
    const explorer = agentExplorerToml({ projectName: 'demo' })
    assert.doesNotMatch(explorer, /\{\{allowedPaths\}\}/)
    assert.doesNotMatch(explorer, /\{\{writablePaths\}\}/)
    assert.match(explorer, /sandbox_mode = "read-only"/)
    assert.doesNotMatch(explorer, /You may write anywhere/)
  })
})
