import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { applyConfigDefaults } from '@/commands/init-helpers'
import { openDB } from '@/core/db'
import { getMaterializer } from '@/core/materializer'

test('init/build lifecycle stores a task in the MCP database without task/session mirror files', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'ahk-mcp-only-'))
  const config = applyConfigDefaults({
    name: 'test', description: 'test', provider: 'claude-code', docsPath: './docs', tasksAdapter: 'mcp',
  })
  const forbidden = ['feature' + '_list.json', 'current' + '.md']
  try {
    await getMaterializer('claude-code').scaffold(config, { cwd })
    const db = await openDB(config, cwd)
    await db.addTask({ slug: 'mcp-only', title: 'MCP only' })
    await db.close()
    for (const name of forbidden) {
      assert.equal(existsSync(join(cwd, '.harness', name)), false)
      assert.equal(existsSync(join(cwd, name)), false)
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})
