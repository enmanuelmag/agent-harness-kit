import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, test } from 'node:test'

import { SpecStore } from '@/core/specs'

const roots: string[] = []
function store(): SpecStore {
  const root = mkdtempSync(join(tmpdir(), 'ahk-specs-'))
  roots.push(root)
  return new SpecStore(join(root, 'docs'))
}
function createUseCase(
  specs: SpecStore,
  slug = 'export-members',
  status: 'draft' | 'approved' = 'approved'
) {
  return specs.create({
    slug,
    title: 'Export members',
    description: 'Export members safely',
    specKind: 'use-case',
    status,
    relatedSpecs: [],
    content: '# Goal\nExport.',
  })
}
function createProductSpec(
  specs: SpecStore,
  specKind: 'feature' | 'fix',
  slug: string,
  status: 'draft' | 'approved' = 'approved'
) {
  return specs.create({
    slug,
    title: `${specKind} specification`,
    description: `${specKind} context`,
    specKind,
    status,
    relatedSpecs: [],
    content: `# ${specKind}\nBody-only searchable evidence.`,
  })
}
afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

describe('filesystem specifications', () => {
  test('creates a technical spec only from an approved use-case and paginates its body', () => {
    const specs = store()
    createUseCase(specs)
    specs.create({
      slug: 'export-members-tech',
      title: 'Export members technical',
      description: 'Technical design',
      specKind: 'technical',
      status: 'draft',
      sourceSpec: 'export-members',
      relatedSpecs: [],
      content: 'abcdef',
    })
    assert.equal(specs.get('export-members-tech').content.slice(2, 5), 'cde')
    assert.throws(
      () =>
        specs.create({
          slug: 'bad-tech',
          title: 'Bad',
          description: 'Bad',
          specKind: 'technical',
          status: 'draft',
          sourceSpec: 'missing',
          relatedSpecs: [],
          content: '',
        }),
      /was not found/
    )
  })

  test('writes inverse relations and invalidates technical work after approved functional changes', () => {
    const specs = store()
    createUseCase(specs, 'source')
    createUseCase(specs, 'dependency')
    specs.create({
      slug: 'source-tech',
      title: 'Source technical',
      description: 'Technical design',
      specKind: 'technical',
      status: 'approved',
      sourceSpec: 'source',
      relatedSpecs: [],
      content: '',
    })
    specs.link('source', 'dependency', 'depends-on')
    assert.deepEqual(specs.get('dependency').metadata.relatedSpecs, [
      { slug: 'source', relationship: 'required-by' },
    ])
    specs.updateContent('source', 'changed')
    assert.equal(specs.get('source').metadata.status, 'needs-decision')
    assert.equal(specs.get('source-tech').metadata.status, 'needs-reconciliation')
  })

  test('accepts approved feature and fix sources, invalidates their technical work, and searches bodies', () => {
    const specs = store()
    for (const kind of ['feature', 'fix'] as const) {
      const slug = `${kind}-source`
      createProductSpec(specs, kind, slug)
      specs.create({
        slug: `${slug}-tech`,
        title: `${kind} technical`,
        description: 'Technical design',
        specKind: 'technical',
        status: 'draft',
        sourceSpec: slug,
        relatedSpecs: [],
        content: '',
      })
      specs.updateContent(slug, 'updated body')
      assert.equal(specs.get(slug).metadata.status, 'needs-decision')
      assert.equal(specs.get(`${slug}-tech`).metadata.status, 'needs-reconciliation')
    }
    createProductSpec(specs, 'feature', 'searchable-feature')
    assert.deepEqual(
      specs.search('searchable evidence').map(({ document }) => document.metadata.slug),
      ['searchable-feature']
    )
  })

  test('rejects a technical specification sourced from an unapproved feature', () => {
    const specs = store()
    createProductSpec(specs, 'feature', 'unapproved-feature', 'draft')
    assert.throws(
      () =>
        specs.create({
          slug: 'unapproved-feature-tech',
          title: 'Technical design',
          description: 'Technical design',
          specKind: 'technical',
          status: 'draft',
          sourceSpec: 'unapproved-feature',
          relatedSpecs: [],
          content: '',
        }),
      /must be an approved/
    )
  })
})
