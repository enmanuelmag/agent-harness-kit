import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'

import { mergeClaudeMcpJson, mergeOpencodeJson } from '@/core/materializer/mcp-merge'
import { featureListJson } from '@/core/materializer/templates'

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
