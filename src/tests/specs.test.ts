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
function createUseCase(specs: SpecStore, slug = 'export-members', status: 'draft' | 'approved' = 'approved') {
  return specs.create({ slug, title: 'Export members', description: 'Export members safely', specKind: 'use-case', status, relatedSpecs: [], content: '# Goal\nExport.' })
}
afterEach(() => { while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true }) })

describe('filesystem specifications', () => {
  test('creates a technical spec only from an approved use-case and paginates its body', () => {
    const specs = store()
    createUseCase(specs)
    specs.create({ slug: 'export-members-tech', title: 'Export members technical', description: 'Technical design', specKind: 'technical', status: 'draft', sourceSpec: 'export-members', relatedSpecs: [], content: 'abcdef' })
    assert.equal(specs.get('export-members-tech').content.slice(2, 5), 'cde')
    assert.throws(() => specs.create({ slug: 'bad-tech', title: 'Bad', description: 'Bad', specKind: 'technical', status: 'draft', sourceSpec: 'missing', relatedSpecs: [], content: '' }), /was not found/)
  })

  test('writes inverse relations and invalidates technical work after approved functional changes', () => {
    const specs = store()
    createUseCase(specs, 'source')
    createUseCase(specs, 'dependency')
    specs.create({ slug: 'source-tech', title: 'Source technical', description: 'Technical design', specKind: 'technical', status: 'approved', sourceSpec: 'source', relatedSpecs: [], content: '' })
    specs.link('source', 'dependency', 'depends-on')
    assert.deepEqual(specs.get('dependency').metadata.relatedSpecs, [{ slug: 'source', relationship: 'required-by' }])
    specs.updateContent('source', 'changed')
    assert.equal(specs.get('source').metadata.status, 'needs-decision')
    assert.equal(specs.get('source-tech').metadata.status, 'needs-reconciliation')
  })
})
