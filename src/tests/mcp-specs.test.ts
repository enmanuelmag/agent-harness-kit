import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, test } from 'node:test'

import { type HarnessDB, openDB } from '@/core/db'
import { dispatch } from '@/core/mcp-server'

import type { HarnessConfig } from '@/types'

const TMP = join(import.meta.dirname, '../../.tmp-mcp-specs')
const config: HarnessConfig = {
  project: { name: 'test', description: 'test', docsPath: './docs' },
  provider: 'claude-code',
  database: { type: 'sqlite' },
  storage: {
    dir: '.harness',
    sections: {
      toolsUsed: true,
      filesModified: true,
      result: true,
      blockers: true,
      nextSteps: false,
    },
    scope: 'local',
    projectId: 'mcp-specs-test',
    sqlitePath: join(TMP, 'harness.db'),
  },
  health: { scriptPath: './health.sh', required: false },
  tools: {
    mcp: { enabled: false, port: 3456 },
    scripts: { enabled: false, outputDir: '.harness/scripts' },
  },
}

function body(result: Awaited<ReturnType<typeof dispatch>>) {
  const item = result.content[0]
  assert.equal(item.type, 'text')
  return JSON.parse(item.text) as Record<string, unknown>
}

let db: HarnessDB
beforeEach(async () => {
  mkdirSync(TMP, { recursive: true })
  db = await openDB(config, TMP)
})
afterEach(async () => {
  await db.close()
  rmSync(TMP, { recursive: true, force: true })
})

test('MCP creates feature/fix specs, searches body content, and derives technical work', async () => {
  await dispatch(
    'specs.create',
    {
      slug: 'export-failure',
      title: 'Export failure',
      description: 'Export issue',
      specKind: 'fix',
      content: 'Observed only in the monthly reconciliation workflow.',
    },
    db,
    TMP,
    TMP,
    config
  )
  await dispatch(
    'specs.transition',
    { slug: 'export-failure', status: 'approved' },
    db,
    TMP,
    TMP,
    config
  )
  const found = body(
    await dispatch('specs.search', { query: 'monthly reconciliation' }, db, TMP, TMP, config)
  )
  const items = found.items as Array<{ metadata: { slug: string }; excerpt: string }>
  assert.equal(items[0].metadata.slug, 'export-failure')
  assert.match(items[0].excerpt, /monthly reconciliation/)

  await dispatch(
    'specs.create',
    {
      slug: 'export-failure-tech',
      title: 'Export failure technical',
      description: 'Technical design',
      specKind: 'technical',
      sourceSpec: 'export-failure',
      content: 'Design.',
    },
    db,
    TMP,
    TMP,
    config
  )
  const validation = body(await dispatch('specs.validate', {}, db, TMP, TMP, config))
  assert.equal(validation.valid, true)
})

test('MCP listing returns partial results and all diagnostics across filters and pages', async () => {
  for (const slug of ['alpha', 'zulu'])
    await dispatch(
      'specs.create',
      { slug, title: slug, description: 'Valid', specKind: 'feature', content: 'Body' },
      db,
      TMP,
      TMP,
      config
    )
  mkdirSync(join(TMP, 'use-cases'))
  writeFileSync(join(TMP, 'specs/broken.md'), '# Plain Markdown')
  writeFileSync(join(TMP, 'use-cases/README.md'), '# Index')
  const first = await dispatch('specs.list', { limit: 1 }, db, TMP, TMP, config)
  assert.equal(first.isError, false)
  const dto = body(first)
  assert.deepEqual(
    (dto.items as { slug: string }[]).map(({ slug }) => slug),
    ['alpha']
  )
  assert.equal(dto.nextOffset, 1)
  assert.deepEqual(dto.diagnostics, [
    { path: 'specs/broken.md', message: 'spec must begin with a YAML frontmatter block' },
  ])
  assert.deepEqual(first.structuredContent, dto)
  const second = body(await dispatch('specs.list', { offset: 1, limit: 1 }, db, TMP, TMP, config))
  assert.deepEqual(
    (second.items as { slug: string }[]).map(({ slug }) => slug),
    ['zulu']
  )
  assert.equal(second.nextOffset, null)
  assert.deepEqual(second.diagnostics, dto.diagnostics)
  const filtered = body(
    await dispatch(
      'specs.list',
      { specKind: 'use-case', status: 'approved', query: 'missing', offset: 100 },
      db,
      TMP,
      TMP,
      config
    )
  )
  assert.deepEqual(filtered.items, [])
  assert.equal(filtered.nextOffset, null)
  assert.deepEqual(filtered.diagnostics, dto.diagnostics)
  await assert.rejects(
    () => dispatch('specs.get', { slug: 'broken' }, db, TMP, TMP, config),
    /YAML frontmatter/
  )
})
