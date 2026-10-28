import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
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

test('MCP returns actual docs-relative filePath outside metadata in discovery and mutation DTOs', async () => {
  const call = (name: string, args: Record<string, unknown>) =>
    dispatch(name, args, db, TMP, TMP, config)
  const created = await call('specs.create', {
    slug: 'located',
    title: 'Original',
    description: 'Description',
    specKind: 'feature',
    content: 'Searchable text',
  })
  const dto = body(created)
  assert.match(dto.filePath as string, /^specs\/\d{4}-\d{2}-\d{2}-located\.md$/)
  assert.equal(existsSync(join(TMP, dto.filePath as string)), true)
  assert.equal('filePath' in (dto.metadata as object), false)
  assert.equal((created.structuredContent as { filePath: string }).filePath, dto.filePath)
  const legacy = 'specs/located.md'
  renameSync(join(TMP, dto.filePath as string), join(TMP, legacy))
  for (const [name, args] of [
    ['specs.get', { slug: 'located' }],
    ['specs.update_content', { slug: 'located', content: 'Updated searchable text' }],
    ['specs.update_metadata', { slug: 'located', title: 'Updated' }],
    ['specs.transition', { slug: 'located', status: 'draft' }],
  ] as const) {
    const result = await call(name, args)
    assert.equal(body(result).filePath, legacy)
    assert.deepEqual(result.structuredContent, body(result))
  }
  const listing = body(await call('specs.list', {}))
  assert.equal((listing.items as { filePath: string }[])[0].filePath, legacy)
  const search = await call('specs.search', { query: 'searchable' })
  assert.equal((body(search).items as { filePath: string }[])[0].filePath, legacy)
  assert.deepEqual(search.structuredContent, body(search))
  assert.doesNotMatch(readFileSync(join(TMP, legacy), 'utf8'), /filePath|file_path/)
})
