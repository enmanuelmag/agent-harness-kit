import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { after, before, test } from 'node:test'

import { reportCliAdvisory } from '@/core/cli-boundary'
import { loadConfig } from '@/core/config'
import { capture } from '@/core/result'

const ROOT = join(import.meta.dirname, '../..')
const TMP = mkdtempSync(join(ROOT, '.tmp-cli-boundary-'))
const CLI = join(TMP, 'dist/cli.js')
const FIXTURE_HOME = join(TMP, 'home')
const FIXTURE_ENV = { ...process.env, HOME: FIXTURE_HOME, USERPROFILE: FIXTURE_HOME }

before(() => {
  mkdirSync(FIXTURE_HOME)
  writeFileSync(join(TMP, 'package.json'), readFileSync(join(ROOT, 'package.json')))
  const require = createRequire(import.meta.url)
  const manifest = require.resolve('tsup/package.json')
  const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as { bin: { tsup: string } }
  const built = spawnSync(
    process.execPath,
    [
      join(dirname(manifest), pkg.bin.tsup),
      join(ROOT, 'src/cli.ts'),
      '--out-dir',
      join(TMP, 'dist'),
      '--tsconfig',
      join(ROOT, 'tsconfig.json'),
      '--format',
      'esm',
      '--target',
      'node22',
      '--platform',
      'node',
      '--external',
      'better-sqlite3',
      '--no-config',
      '--silent',
    ],
    { cwd: ROOT, encoding: 'utf8', env: FIXTURE_ENV }
  )
  assert.equal(built.status, 0, built.stderr || built.stdout)
  cpSync(join(ROOT, 'src/core/materializer/agent-templates'), join(TMP, 'dist/agent-templates'), {
    recursive: true,
  })
  cpSync(join(ROOT, 'src/core/materializer/skills'), join(TMP, 'dist/skills'), { recursive: true })
  cpSync(join(ROOT, 'src/assets/sounds'), join(TMP, 'dist/assets/sounds'), { recursive: true })
})
after(() => rmSync(TMP, { recursive: true, force: true }))

function project(name: string) {
  const cwd = join(TMP, name)
  mkdirSync(cwd)
  writeFileSync(join(cwd, 'package.json'), '{"name":"@cardor/agent-harness-kit"}')
  return cwd
}
function cli(args: string[], cwd: string) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    env: FIXTURE_ENV,
    encoding: 'utf8',
    timeout: 8000,
    killSignal: 'SIGKILL',
  })
}
function assertHandled(result: ReturnType<typeof cli>, context: string, message: RegExp) {
  assert.equal(result.error, undefined, 'failure must terminate without timeout')
  assert.equal(result.status, 1, result.stderr)
  assert.match(result.stderr, message)
  assert.equal(result.stderr.split(`[agent-harness-kit] ${context}:`).length - 1, 1)
  assert.doesNotMatch(result.stderr, /UnhandledPromise|uncaught|\n\s+at /i)
}

function interactiveCli(args: string[], cwd: string, responses: [string, string][]) {
  return new Promise<{ status: number | null; output: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd, env: FIXTURE_ENV })
    let output = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`CLI did not finish: ${output}`))
    }, 15000)
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.stderr.on('data', chunk => { output += chunk.toString() })
    child.stdout.on('data', chunk => {
      output += chunk.toString()
      if (responses[0] && output.includes(responses[0][0])) {
        child.stdin.write(responses.shift()![1] + '\r')
        if (!responses.length) child.stdin.end()
      }
    })
    child.on('close', status => { clearTimeout(timer); resolve({ status, output }) })
  })
}

const V2_ROLES = ['lead', 'explorer', 'consultant', 'builder', 'reviewer']
async function assertInheritedV2(cwd: string) {
  const config = await loadConfig(cwd)
  assert.deepEqual(config.agentPreferences?.['opencode-v2'], Object.fromEntries(V2_ROLES.map(role => [role, { model: 'inherit' }])))
  for (const role of V2_ROLES) assert.doesNotMatch(readFileSync(join(cwd, `.opencode/agents/${role}.md`), 'utf8').match(/^---\n([\s\S]*?)\n---/)![1], /^model:/m)
}

test('OpenCode V2 init and provider migration inherit all roles without model prompts', async () => {
  const initialized = project('v2-init')
  const result = await interactiveCli(['init', '--provider', 'opencode-v2', '--name', 'V2 test', '--docs', './docs', '--storage-scope', 'local', '--no-notifications', '--no-notification-hooks'], initialized, [
    ['Short description (shown to agents as context)', 'CLI inheritance fixture'],
    ['Add your first task now?', ''],
  ])
  assert.equal(result.status, 0, result.output)
  assert.doesNotMatch(result.output, /OpenCode V2 model for/)
  await assertInheritedV2(initialized)

  const migrated = project('v2-migrate')
  writeFileSync(join(migrated, 'agent-harness-kit.config.json'), JSON.stringify({ provider: 'opencode', project: { name: 'Migration test', description: 'test', docsPath: './docs' } }))
  const migration = cli(['migrate', 'provider', '--to', 'opencode-v2'], migrated)
  assert.equal(migration.error, undefined)
  assert.equal(migration.status, 0, migration.stderr || migration.stdout)
  assert.doesNotMatch(migration.stdout, /OpenCode V2 model for/)
  await assertInheritedV2(migrated)
})

test('OpenCode V2 build and sync preserve partial saved models and fill inheritance without prompts in every force mode', () => {
  const modes = [['build'], ['build', '--force'], ['sync'], ['sync', '--force'], ['sync', '--force', '--keep-models']]
  for (const [index, args] of modes.entries()) {
    const cwd = project(`v2-regenerate-${index}`)
    const path = join(cwd, 'agent-harness-kit.config.json')
    const original = JSON.stringify({ provider: 'opencode-v2', project: { name: 'V2 regenerate', description: 'test', docsPath: './docs' }, agentPreferences: { 'opencode-v2': { builder: { model: 'team/model#high' } } } })
    writeFileSync(path, original)
    const result = cli(args, cwd)
    assert.equal(result.error, undefined, args.join(' '))
    assert.equal(result.status, 0, result.stderr || result.stdout)
    assert.doesNotMatch(result.stdout, /OpenCode V2 model for/)
    assert.equal(readFileSync(path, 'utf8'), original)
    const saved = JSON.parse(readFileSync(join(cwd, 'agent-harness-kit.config.local.json'), 'utf8')).agentPreferences['opencode-v2']
    assert.deepEqual(saved, Object.fromEntries(V2_ROLES.map(role => [role, { model: role === 'builder' ? 'team/model#high' : 'inherit' }])))
    assert.match(readFileSync(join(cwd, '.opencode/agents/builder.md'), 'utf8'), /^model: "team\/model#high"$/m)
    assert.doesNotMatch(readFileSync(join(cwd, '.opencode/agents/lead.md'), 'utf8'), /^model:/m)
  }
})

test('ahk models still prompts all OpenCode V2 roles and accepts Enter as inherit', async () => {
  const cwd = project('v2-models')
  writeFileSync(join(cwd, 'agent-harness-kit.config.json'), JSON.stringify({ provider: 'opencode-v2', project: { name: 'Models test', description: 'test', docsPath: './docs' } }))
  const result = await interactiveCli(['models'], cwd, V2_ROLES.map(role => [`OpenCode V2 model for ${role} (blank = inherit)`, '']))
  assert.equal(result.status, 0, result.output)
  for (const role of V2_ROLES) assert.match(result.output, new RegExp(`OpenCode V2 model for ${role}`))
  await assertInheritedV2(cwd)
})

test('ahk models apply-defaults applies inheritance without prompts', async () => {
  const cwd = project('v2-apply-defaults')
  writeFileSync(join(cwd, 'agent-harness-kit.config.json'), JSON.stringify({ provider: 'opencode-v2', project: { name: 'Models defaults', description: 'test', docsPath: './docs' } }))
  const result = cli(['models', 'apply-defaults'], cwd)
  assert.equal(result.error, undefined)
  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.match(result.stdout, /builder: inherit/)
  assert.doesNotMatch(result.stdout, /OpenCode V2 model for/)
  await assertInheritedV2(cwd)
})

test('capture retains original causes for sync throws and awaited non-Error rejections', async () => {
  const cause = { code: 'EXPECTED_REJECTION' }
  const synchronous = await capture(() => {
    throw cause
  }, 'sync operation')
  const asynchronous = await capture(async () => {
    await Promise.resolve()
    throw cause
  }, 'async operation')
  for (const result of [synchronous, asynchronous]) {
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.error.cause, cause)
  }
})

test('advisory rejection and reporting failure preserve completed operation status', async (t) => {
  let stderr = ''
  t.mock.method(process.stderr, 'write', (chunk: string) => {
    stderr += chunk
    return true
  })
  const initialExitCode = process.exitCode
  const failed = capture(async () => {
    throw new Error('Advisory lookup failed')
  }, 'update check')
  let reports = 0
  await reportCliAdvisory(failed, () => {
    reports++
  })
  await reportCliAdvisory(
    capture(() => 'ready', 'update check'),
    () => {
      throw new Error('Advisory display failed')
    }
  )
  assert.equal(reports, 0)
  assert.equal(process.exitCode, initialExitCode)
  assert.equal(stderr.match(/\[agent-harness-kit\] Advisory /g)?.length, 2)
  assert.match(stderr, /lookup failed/)
  assert.match(stderr, /display failed/)
})

test('actual async CLI action failure is contextual, emitted once and exits nonzero', () => {
  const cwd = project('async-action')
  const result = cli(['migrate', 'specs'], cwd)
  assertHandled(result, 'ahk migrate specs', /No agent-harness-kit.config found/)
  assert.equal(result.stdout, '')
})

test('serve startup rejection terminates even after a socket opens, with stderr-only output', () => {
  const cwd = project('serve-startup')
  writeFileSync(
    join(cwd, 'agent-harness-kit.config.mjs'),
    `
    import { createServer } from 'node:net'
    const server = createServer()
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    throw new Error('Socket startup rejected')
  `
  )
  const result = cli(['serve'], cwd)
  assertHandled(result, 'ahk serve', /Socket startup rejected/)
  assert.equal(result.stdout, '')
})

test('Commander help/version/parse errors retain their normal exits and output', () => {
  const cwd = project('commander')
  for (const arg of ['--help', '--version']) {
    const result = cli([arg], cwd)
    assert.equal(result.status, 0, result.stderr)
    assert.notEqual(result.stdout, '')
    assert.equal(result.stderr, '')
  }
  const invalid = cli(['serve', '--port', 'abc'], cwd)
  assert.equal(invalid.status, 1)
  assert.match(invalid.stderr, /must be an integer between 1 and 65535/)
  assert.doesNotMatch(invalid.stderr, /\[agent-harness-kit\]/)
})

test('watch async reload failure is consumed once, closes and terminates without forcing files', async () => {
  const cwd = project('watch')
  const configPath = join(cwd, 'agent-harness-kit.config.json')
  writeFileSync(
    configPath,
    JSON.stringify({
      project: { name: 'watch-test', description: 'test', docsPath: './docs' },
      provider: 'opencode',
      tools: {
        mcp: { enabled: false, port: 3742 },
        scripts: { enabled: false, outputDir: '.harness/scripts' },
      },
    })
  )
  mkdirSync(join(cwd, '.opencode/agents'), { recursive: true })
  const custom = join(cwd, '.opencode/agents/builder.md')
  writeFileSync(custom, '# User-owned builder\nPreserve this content.\n')
  const child = spawn(process.execPath, [CLI, 'build', '--watch'], {
    cwd,
    env: FIXTURE_ENV,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = '',
    stderr = '',
    changed = false
  const code = await new Promise<number | null>((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`Watch failure did not terminate: ${stdout} ${stderr}`))
    }, 10000)
    child.on('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
      if (!changed && stdout.includes('Watching agent-harness-kit.config')) {
        changed = true
        writeFileSync(configPath, '{ invalid JSON')
      }
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('exit', (status) => {
      clearTimeout(timeout)
      resolve(status)
    })
  })
  assert.equal(changed, true, stdout + stderr)
  assert.equal(code, 1, stdout + stderr)
  assert.equal(stderr.split('[agent-harness-kit] ahk build --watch rebuild:').length - 1, 1)
  assert.match(stderr, /is not valid JSON/)
  assert.doesNotMatch(stderr, /UnhandledPromise|uncaught|\n\s+at /i)
  assert.equal(readFileSync(custom, 'utf8'), '# User-owned builder\nPreserve this content.\n')
})


test('doctor DB diagnostics are opt-in, stderr-only and do not create a missing SQLite database', () => {
  const cwd = project('optional-db-doctor')
  const result = cli(['doctor', '--db'], cwd)
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stderr, /Optional database diagnostics are unavailable/)
  assert.equal(existsSync(join(cwd, '.harness/harness.db')), false)
  const ordinary = cli(['doctor'], cwd)
  assert.equal(ordinary.status, 0)
  assert.doesNotMatch(ordinary.stderr, /database diagnostics/)
})

test('actual JSON CLI keeps stdout parseable and passive DB notices on stderr', () => {
  const cwd = project('json-db-notice')
  const config = {
    project: { name: 'json', description: '', docsPath: './docs' }, provider: 'codex-cli', database: { type: 'sqlite' },
    databaseDiagnostics: { minSamples: 1, minSlow: 1, slowMs: 1 },
    storage: { scope: 'local', projectId: 'json-db', dir: '.harness' },
  }
  writeFileSync(join(cwd, 'agent-harness-kit.config.mjs'), `let time=0; Object.defineProperty(performance, 'now', { value: () => (time += 600) }); export default ${JSON.stringify(config)}`)
  const result = cli(['task', 'list', '--json'], cwd)
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), [])
  assert.match(result.stderr, /Recent database calls were repeatedly slow \(1\/1 calls >=1ms/)
  assert.doesNotMatch(result.stdout, /database|slow/)
})


test('internal notification hooks stay quiet and benign on malformed/oversized/default-off input', () => {
  const cwd = project('quiet-notifications')
  for (const [args, input] of [
    [['notifications', 'hook', '--provider', 'cursor', '--event', 'stop'], '{ invalid'],
    [['notifications', 'hook', '--provider', 'invalid', '--event', 'Stop'], '{}'],
    [['notifications', 'hook', '--provider', 'codex-cli', '--event', 'Stop'], 'x'.repeat(262145)],
    [['notifications', 'hook', '--provider', 'cursor', '--event', 'stop'], '{"status":"completed","conversation_id":"s","generation_id":"t"}'],
  ] as [string[], string][]) {
    const result = spawnSync(process.execPath, [CLI, ...args], { cwd, input, encoding: 'utf8', timeout: 5000, env: FIXTURE_ENV })
    assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(JSON.parse(result.stdout), {}); assert.equal(result.stderr, '')
  }
  const disabled = cli(['notifications', 'deliver', '--event-id', 'none', '--ledger-path', join(cwd, 'must-not-create/notifications.db'), '--settings', '{"enabled":false}'], cwd)
  assert.equal(disabled.status, 0); assert.equal(disabled.stdout, ''); assert.equal(disabled.stderr, '')
  assert.equal(existsSync(join(cwd, 'must-not-create')), false)
  const status = cli(['notifications', 'status', '--json'], cwd)
  assert.equal(status.status, 0, status.stderr); assert.equal(JSON.parse(status.stdout).enabled, false)
  assert.equal(existsSync(join(cwd, '.config')), false)
})
