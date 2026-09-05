import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

import { applyConfigDefaults } from '@/commands/init-helpers'
import { agentsMd } from '@/core/materializer/templates'

test('generated configuration fixes the task adapter to MCP', () => {
  const config = applyConfigDefaults({
    name: 'test',
    description: 'test',
    provider: 'codex-cli',
    docsPath: './docs',
    tasksAdapter: 'mcp',
  })
  assert.equal(config.storage.tasks?.adapter, 'mcp')
})

test('generated agent instructions require MCP repair when unavailable', () => {
  const text = agentsMd(
    applyConfigDefaults({
      name: 'test',
      description: 'test',
      provider: 'codex-cli',
      docsPath: './docs',
      tasksAdapter: 'mcp',
    })
  )
  assert.match(text, /ask the user to restore the MCP connection/)
})

test('init, build, and storage migration contain no task/session mirror writers', () => {
  const root = process.cwd()
  const forbidden = [
    'feature' + '_list.json',
    'current' + '.md',
  ]
  const files = [
    'src/commands/init.ts',
    'src/core/materializer/claude-code.ts',
    'src/core/materializer/codex-cli.ts',
    'src/core/materializer/grok.ts',
    'src/core/materializer/opencode.ts',
    'src/commands/migrate-storage.ts',
  ]

  for (const file of files) {
    const source = readFileSync(join(root, file), 'utf8')
    for (const name of forbidden) {
      assert.equal(source.includes(name), false, `${file} must not create or move ${name}`)
    }
  }
})
