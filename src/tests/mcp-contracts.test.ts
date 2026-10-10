import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { z } from 'zod'

import { openDB } from '@/core/db'
import {
  compileContract,
  deriveInputContract,
  inputContracts,
  outputContracts,
  structuredResult,
} from '@/core/mcp-contracts'
import { recover } from '@/core/mcp-field-recovery'
import {
  assertNormalized,
  boundedInt,
  num,
  optionalStr,
  optionalStringArray,
  requiredStringArray,
  str,
} from '@/core/mcp-normalizers'
import { createMcpServer, dispatch } from '@/core/mcp-server'

import type { HarnessConfig } from '@/types'

const TMP = join(import.meta.dirname, '../../.tmp-mcp-contracts')
const config: HarnessConfig = {
  project: { name: 'test', description: 'test', docsPath: './docs' },
  provider: 'codex-cli',
  database: { type: 'sqlite' },
  storage: {
    scope: 'local',
    dir: '.harness',
    projectId: 'mcp-contracts',
    sqlitePath: join(TMP, 'harness.db'),
    sections: {
      toolsUsed: true,
      filesModified: true,
      result: true,
      blockers: true,
      nextSteps: true,
    },
  },
  health: { scriptPath: './health.sh', required: true },
  tools: {
    mcp: { enabled: true, port: 3742 },
    scripts: { enabled: false, outputDir: '.harness/scripts' },
  },
}

function text(result: { content: unknown }): string {
  return (result.content as { text: string }[])[0].text
}

test('legacy normalizers retain falsy, numeric, null, JSON and presence quirks', () => {
  for (const value of [undefined, null, '', false, 0, NaN])
    assert.throws(() => str({ x: value }, 'x'), /x is required/)
  assert.equal(str({ x: [] }, 'x'), '')
  assert.equal(str({ x: { toString: () => 'object' } }, 'x'), 'object')
  for (const [value, expected] of [
    [null, 0],
    ['', 0],
    [false, 0],
    ['1.5', 1.5],
    [Infinity, Infinity],
  ] as const)
    assert.equal(num({ x: value }, 'x'), expected)
  assert.throws(() => num({}, 'x'), /x must be a number/)
  assert.equal(optionalStr({ x: null }, 'x'), 'null')
  assert.equal(optionalStr({}, 'x'), undefined)
  assert.equal(boundedInt({}, 'x', 5, 1, 10), 5)
  assert.equal(boundedInt({ x: ' 2 ' }, 'x', 5, 1, 10), 2)
  for (const value of [null, false, '', ' ', 1.5, Infinity, '11'])
    assert.throws(() => boundedInt({ x: value }, 'x', 5, 1, 10), /integer between/)
  assert.equal(optionalStringArray({}, 'x'), undefined)
  assert.deepEqual(optionalStringArray({ x: null }, 'x'), [])
  assert.deepEqual(optionalStringArray({ x: '[" a ", " ", null, false, 2]' }, 'x'), [
    ' a ',
    'null',
    'false',
    '2',
  ])
  assert.deepEqual(requiredStringArray({ x: undefined }, 'x'), [])
  assert.throws(() => requiredStringArray({}, 'x'), /required/)
  for (const value of ['[', '{}', false])
    assert.throws(() => optionalStringArray({ x: value }, 'x'), /array of non-empty strings/)
})

test('compiled input contracts preserve property membership and normalize coercible objects once', () => {
  const absent = inputContracts['specs.update_metadata'].parse({ slug: 'x', extra: true })
  assert.equal('title' in absent, false)
  assert.equal('extra' in absent, false)
  const present = inputContracts['specs.update_metadata'].parse({
    slug: 'x',
    title: undefined,
    sourceUseCases: null,
  })
  assert.equal('title' in present, true)
  assert.throws(() => assertNormalized(present), /title is required/)
  let conversions = 0
  const normalized = inputContracts['actions.write'].parse({
    actionId: '1',
    sectionType: 'result',
    content: {
      toString: () => {
        conversions++
        return ''
      },
    },
  })
  assertNormalized(normalized)
  assert.equal(str(normalized, 'content'), '')
  assert.equal(conversions, 1)
  const unsupported = z.string().refine(async () => true)
  assert.equal(compileContract(unsupported), unsupported)
  assert.equal(outputContracts['actions.start'].safeParse({ actionId: 'wrong' }).success, false)
  const dto = structuredResult('actions.start', {
    content: [{ type: 'text', text: '{"actionId":1,"extra":true}' }],
    isError: false,
  })
  assert.deepEqual(dto.structuredContent, { actionId: 1 })
  assert.equal(text(dto), '{"actionId":1,"extra":true}')
})

test('one authored Zod definition drives guidance and tolerant recovery without leaking metadata', () => {
  const authored = z.object({
    count: recover(z.number().describe('Canonical count'), num),
    labels: recover(z.array(z.string()).optional(), optionalStringArray),
    raw: z.string().optional(),
  })
  const published = z.toJSONSchema(authored, { io: 'input' })
  assert.equal(
    (published.properties!.count as { description: string }).description,
    'Canonical count'
  )
  assert.deepEqual(published.required, ['count'])
  assert.doesNotMatch(JSON.stringify(published), /normalize|order|recovery|function/)
  const derived = deriveInputContract(authored)
  const recovered = derived.parse({
    count: 'Infinity',
    labels: '[" a ", "", 2]',
    raw: null,
    extra: true,
  })
  assertNormalized(recovered)
  assert.equal(recovered.count, Infinity)
  assert.deepEqual(recovered.labels, [' a ', '2'])
  assert.equal(recovered.raw, null)
  assert.equal('extra' in recovered, false)
  assert.equal('labels' in derived.parse({ count: 1.5 }), false)
  assert.equal(derived.parse({ count: null }).count, 0)
  assert.equal(derived.parse({ count: Infinity }).count, Infinity)
  const changed = z.object({
    renamed: recover(z.number().optional().describe('Updated count'), num),
  })
  assert.equal('count' in z.toJSONSchema(changed, { io: 'input' }).properties!, false)
  const result = deriveInputContract(changed).parse({ renamed: '2.5' })
  assertNormalized(result)
  assert.equal(result.renamed, 2.5)
})

test('real SDK tools/list and tools/call preserve recovery, mutations, errors, notices and output contracts', async () => {
  mkdirSync(TMP, { recursive: true })
  writeFileSync(join(TMP, 'health.sh'), '#!/bin/sh\n# actual test health script\nexit 0\n', {
    mode: 0o755,
  })
  mkdirSync(join(TMP, '.harness'), { recursive: true })
  writeFileSync(join(TMP, '.harness/skills-state.json'), '{ invalid')
  const db = await openDB(config, TMP)
  const server = createMcpServer(config, TMP, db)
  const client = new Client({ name: 'contract-test', version: '1' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  try {
    await server.connect(serverTransport)
    await client.connect(clientTransport)
    const listed = await client.listTools()
    assert.equal(listed.tools.length, Object.keys(inputContracts).length)
    for (const tool of listed.tools) {
      assert.ok(tool.inputSchema)
      assert.ok(tool.outputSchema)
    }
    const startSchema = listed.tools.find((tool) => tool.name === 'actions.start')!.inputSchema
    assert.deepEqual(startSchema.required, ['taskId', 'agent'])
    assert.equal((startSchema.properties!.taskId as { type: string }).type, 'number')
    assert.equal(
      (startSchema.properties!.taskId as { description: string }).description,
      'The task ID from tasks.get'
    )
    assert.deepEqual(
      (
        listed.tools.find((tool) => tool.name === 'tasks.update')!.inputSchema.properties!
          .status as { enum: string[] }
      ).enum,
      ['pending', 'in_progress', 'done', 'blocked']
    )
    assert.doesNotMatch(
      JSON.stringify(listed.tools.map((tool) => tool.inputSchema)),
      /normalize|recovery|INPUT_RULES/
    )
    const recoveredInfinity = await client.callTool({
      name: 'tasks.acceptance.update',
      arguments: { criterionId: 'Infinity' },
    })
    assert.equal(recoveredInfinity.isError, false)
    assert.equal(text(recoveredInfinity), '{"criterionId":null,"met":true}')
    const invalid = await client.callTool({ name: 'tasks.add', arguments: { title: false } })
    assert.equal(invalid.isError, true)
    assert.equal(text(invalid), 'Error: title is required')
    assert.equal((await db.getTasks()).length, 0)
    const invalidClaim = await client.callTool({ name: 'tasks.claim', arguments: {} })
    assert.equal(text(invalidClaim), 'Error: id must be a number')
    assert.equal((invalidClaim.content as unknown[]).length, 2)
    assert.equal(
      JSON.parse((invalidClaim.content as { text: string }[])[1].text).noticeSchemaVersion,
      1
    )
    const added = await client.callTool({
      name: 'tasks.add',
      arguments: { title: 42, extra: 'discard' },
    })
    assert.equal(added.isError, false)
    const task = JSON.parse(text(added))
    assert.equal(task.title, '42')
    assert.deepEqual(added.structuredContent, task)
    const array = await client.callTool({ name: 'tasks.get', arguments: {} })
    assert.deepEqual(array.structuredContent, { items: JSON.parse(text(array)) })
    await dispatch('tasks.edit', { id: task.id, acceptance: ['keep'] }, db, TMP, TMP, config)
    await dispatch(
      'tasks.edit',
      { id: task.id, acceptance: null, description: null },
      db,
      TMP,
      TMP,
      config
    )
    assert.equal((await db.getTaskAcceptance(task.id)).length, 1)
    await dispatch('tasks.edit', { id: task.id, acceptance: [] }, db, TMP, TMP, config)
    assert.equal((await db.getTaskAcceptance(task.id)).length, 0)
    const createdSpec = await client.callTool({
      name: 'specs.create',
      arguments: {
        slug: 'presence',
        title: 'Title',
        description: 'Description',
        specKind: 'use-case',
        content: 'Body',
      },
    })
    assert.equal(createdSpec.isError, false)
    const preserved = await client.callTool({
      name: 'specs.update_metadata',
      arguments: { slug: 'presence', extra: 'discard' },
    })
    assert.equal(JSON.parse(text(preserved)).metadata.title, 'Title')
    const invalidUpdate = await client.callTool({
      name: 'specs.update_metadata',
      arguments: { slug: 'presence', title: null },
    })
    assert.equal(text(invalidUpdate), 'Error: title is required')
    const unchanged = await client.callTool({ name: 'specs.get', arguments: { slug: 'presence' } })
    assert.equal(JSON.parse(text(unchanged)).metadata.title, 'Title')
    const cleared = await client.callTool({
      name: 'specs.update_metadata',
      arguments: { slug: 'presence', sourceUseCases: null },
    })
    assert.deepEqual(JSON.parse(text(cleared)).metadata.sourceUseCases, [])
    const missingArchive = await dispatch('tasks.archive', { id: 999999 }, db, TMP, TMP, config)
    assert.equal(text(missingArchive), 'null')
    assert.deepEqual(missingArchive.structuredContent, { value: null })
    const claimed = await client.callTool({
      name: 'tasks.claim',
      arguments: { id: String(task.id), agent: 'lead' },
    })
    assert.equal(claimed.isError, false)
    const action = await client.callTool({
      name: 'actions.start',
      arguments: { taskId: String(task.id), agent: 'lead' },
    })
    assert.equal(action.isError, false)
    const actionId = JSON.parse(text(action)).actionId
    const handoff = await client.callTool({
      name: 'actions.handoff.write',
      arguments: {
        actionId: String(actionId),
        recipient: 'builder',
        goal: 'g',
        nextStep: 'n',
        completed: null,
        decisions: '[1," a ",""]',
        files: [],
        verification: [],
        blockers: [],
      },
    })
    assert.equal(handoff.isError, false)
    const missingArray = await client.callTool({
      name: 'actions.handoff.write',
      arguments: { actionId, recipient: 'builder', goal: 'g', nextStep: 'n' },
    })
    assert.equal(text(missingArray), 'Error: completed is required')
    const malformed = await client.callTool({
      name: 'actions.sections.list',
      arguments: { actionId, types: '[' },
    })
    assert.match(text(malformed), /^Error: types must be an array/)
    const bounded = await client.callTool({
      name: 'actions.list',
      arguments: { taskId: task.id, limit: '1.5' },
    })
    assert.equal(text(bounded), 'Error: limit must be an integer between 1 and 100')
    const direct = await dispatch(
      'actions.list',
      { taskId: String(task.id), limit: '1', extra: true },
      db,
      TMP,
      TMP,
      config
    )
    const wire = await client.callTool({
      name: 'actions.list',
      arguments: { taskId: String(task.id), limit: '1', extra: true },
    })
    assert.equal(text(wire), text(direct))
    assert.deepEqual(wire.structuredContent, direct.structuredContent)
    const recovered = await client.callTool({
      name: 'actions.list',
      arguments: { taskId: task.id, agent: ['lead'], status: ['in_progress'] },
    })
    assert.equal(recovered.isError, false)
    assert.equal(JSON.parse(text(recovered)).items.length, 1)
    const recoveredDirect = await dispatch(
      'actions.list',
      { taskId: task.id, agent: ['lead'], status: ['in_progress'] },
      db,
      TMP,
      TMP,
      config
    )
    assert.equal(text(recovered), text(recoveredDirect))
    const completed = await client.callTool({
      name: 'tasks.update',
      arguments: { id: String(task.id), status: 'done' },
    })
    assert.equal(completed.isError, false)
    assert.equal(JSON.parse(text(completed)).task.status, 'done')
    await assert.rejects(
      () => client.callTool({ name: 'does.not.exist', arguments: {} }),
      /not found/
    )
  } finally {
    await client.close()
    await server.close()
    await db.close()
    rmSync(TMP, { recursive: true, force: true })
  }
})

test('freshly built source CLI serves validated MCP calls over stdio without project dist', async () => {
  const cwd = TMP + '-stdio'
  mkdirSync(cwd, { recursive: true })
  writeFileSync(
    join(cwd, 'agent-harness-kit.config.cjs'),
    'module.exports = ' +
      JSON.stringify({
        ...config,
        storage: { ...config.storage, sqlitePath: join(cwd, 'harness.db') },
      })
  )
  const client = new Client({ name: 'stdio-test', version: '1' })
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(cwd, 'dist/cli.js'), 'serve'],
    cwd,
    stderr: 'pipe',
  })
  try {
    const root = join(import.meta.dirname, '../..')
    // Build only current source into the disposable fixture. CI runs tests
    // before the project build, so neither bin/ahk.js nor root dist is used.
    writeFileSync(join(cwd, 'package.json'), readFileSync(join(root, 'package.json')))
    const require = createRequire(import.meta.url)
    const tsupPackagePath = require.resolve('tsup/package.json')
    const tsupPackage = JSON.parse(readFileSync(tsupPackagePath, 'utf8')) as {
      bin: { tsup: string }
    }
    const built = spawnSync(
      process.execPath,
      [
        join(dirname(tsupPackagePath), tsupPackage.bin.tsup),
        join(root, 'src/cli.ts'),
        '--out-dir',
        join(cwd, 'dist'),
        '--tsconfig',
        join(root, 'tsconfig.json'),
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
      { cwd: root, encoding: 'utf8' }
    )
    assert.equal(built.status, 0, built.stderr || built.stdout || built.error?.message)
    await client.connect(transport)
    const listed = await client.listTools()
    assert.equal(listed.tools.length, Object.keys(inputContracts).length)
    const result = await client.callTool({
      name: 'tasks.add',
      arguments: { title: 'stdio task', ignored: 'extra' },
    })
    assert.equal(result.isError, false)
    assert.deepEqual(result.structuredContent, JSON.parse(text(result)))
  } finally {
    await client.close()
    await transport.close()
    rmSync(cwd, { recursive: true, force: true })
  }
})
