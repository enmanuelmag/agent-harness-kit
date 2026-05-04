import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mergeClaudeMcpJson, mergeOpencodeJson } from '../core/materializer/mcp-merge.js'
import { featureListJson } from '../core/materializer/templates.js'

const TMP = join(import.meta.dirname, '../../.tmp-templates')

function setup() { mkdirSync(TMP, { recursive: true }) }
function teardown() { rmSync(TMP, { recursive: true, force: true }) }

describe('mergeClaudeMcpJson', () => {
  test('creates file when it does not exist', () => {
    setup()
    const path = join(TMP, 'mcp.json')
    mergeClaudeMcpJson(path, 3456)
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    assert.ok(parsed.mcpServers['agent-harness-kit'])
    assert.equal(parsed.mcpServers['agent-harness-kit'].args[3], '3456')
    teardown()
  })

  test('preserves existing mcpServers entries', () => {
    setup()
    const path = join(TMP, 'mcp2.json')
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
    assert.ok(parsed.mcp.servers['agent-harness-kit'])
    teardown()
  })

  test('preserves existing mcp.servers entries', () => {
    setup()
    const path = join(TMP, 'opencode2.json')
    const initial = { mcp: { servers: { 'other': { command: 'bar', args: [] } } } }
    writeFileSync(path, JSON.stringify(initial))
    mergeOpencodeJson(path, 3456)
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    assert.ok(parsed.mcp.servers['other'])
    assert.ok(parsed.mcp.servers['agent-harness-kit'])
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
