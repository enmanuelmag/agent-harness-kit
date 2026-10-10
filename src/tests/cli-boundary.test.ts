import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { after, before, test } from 'node:test'

import { reportCliAdvisory } from '@/core/cli-boundary'
import { capture } from '@/core/result'

const ROOT = join(import.meta.dirname, '../..')
const TMP = mkdtempSync(join(ROOT, '.tmp-cli-boundary-'))
const CLI = join(TMP, 'dist/cli.js')

before(() => {
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
    { cwd: ROOT, encoding: 'utf8' }
  )
  assert.equal(built.status, 0, built.stderr || built.stdout)
  cpSync(join(ROOT, 'src/core/materializer/agent-templates'), join(TMP, 'dist/agent-templates'), {
    recursive: true,
  })
  cpSync(join(ROOT, 'src/core/materializer/skills'), join(TMP, 'dist/skills'), { recursive: true })
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
