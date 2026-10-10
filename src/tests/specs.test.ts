import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
  test('keeps real use cases in their own root and reconciles a linked spec and tech transitively', () => {
    const specs = store()
    createUseCase(specs, 'member-export')
    specs.create({
      slug: 'member-export-spec',
      title: 'Member export',
      description: 'Scope',
      specKind: 'spec',
      status: 'approved',
      sourceUseCases: ['member-export'],
      relatedSpecs: [],
      content: 'Draft first.',
    })
    specs.create({
      slug: 'member-export-tech',
      title: 'Member export technical',
      description: 'Design',
      specKind: 'spec-tech',
      status: 'approved',
      sourceSpec: 'member-export-spec',
      relatedSpecs: [],
      content: 'Design.',
    })
    specs.updateContent('member-export', 'Changed scenario.')
    assert.equal(specs.get('member-export').metadata.status, 'needs-decision')
    assert.equal(specs.get('member-export-spec').metadata.status, 'needs-decision')
    assert.equal(specs.get('member-export-tech').metadata.status, 'needs-reconciliation')
  })

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

test('listing scan keeps valid documents and reports each invalid candidate without recursing', () => {
  const specs = store()
  createProductSpec(specs, 'feature', 'alpha', 'draft')
  createUseCase(specs, 'zulu', 'draft')
  const raw = readFileSync(join(specs.root, 'alpha.md'), 'utf8')
  writeFileSync(join(specs.root, 'README.md'), '# Index')
  writeFileSync(join(specs.useCasesRoot, 'ReAdMe.md'), '# Index')
  writeFileSync(join(specs.root, 'index.md'), '# Ordinary Markdown')
  writeFileSync(
    join(specs.root, 'malformed.md'),
    raw.replace('spec_kind: feature', 'spec_kind: unknown')
  )
  writeFileSync(join(specs.root, 'disagree.md'), raw)
  writeFileSync(join(specs.useCasesRoot, 'misplaced.md'), raw.replace('"alpha"', '"misplaced"'))
  mkdirSync(join(specs.root, 'nested'))
  writeFileSync(join(specs.root, 'nested/ignored.md'), '# Nested')
  const scan = specs.scanForListing()
  assert.deepEqual(
    scan.documents.map(({ metadata }) => metadata.slug),
    ['alpha', 'zulu']
  )
  assert.deepEqual(
    scan.diagnostics.map(({ path }) => path),
    ['use-cases/misplaced.md', 'specs/disagree.md', 'specs/index.md', 'specs/malformed.md']
  )
  assert.match(scan.diagnostics[0].message, /use-case documents belong/)
  assert.match(scan.diagnostics[1].message, /filename and slug disagree/)
  assert.match(scan.diagnostics[2].message, /YAML frontmatter/)
  assert.match(scan.diagnostics[3].message, /invalid spec_kind/)
  assert.throws(() => specs.list(), /use-case documents belong/)
})

test('README indexes are ignored by shared discovery without weakening strict consumers', () => {
  const specs = store()
  createProductSpec(specs, 'feature', 'source')
  mkdirSync(specs.useCasesRoot)
  writeFileSync(join(specs.root, 'readme.md'), '# Index')
  writeFileSync(join(specs.useCasesRoot, 'README.md'), '# Index')
  assert.deepEqual(specs.scanForListing().diagnostics, [])
  assert.deepEqual(
    specs.list().map(({ metadata }) => metadata.slug),
    ['source']
  )
  assert.equal(specs.search('searchable evidence').length, 1)
  assert.deepEqual(specs.validate(), [])
})

test('duplicate paths exclude every twin, including a valid document with a malformed twin', () => {
  const specs = store()
  createUseCase(specs, 'duplicate', 'draft')
  createUseCase(specs, 'invalid-twin', 'draft')
  mkdirSync(specs.root)
  writeFileSync(
    join(specs.root, 'duplicate.md'),
    readFileSync(join(specs.useCasesRoot, 'duplicate.md'))
  )
  writeFileSync(join(specs.root, 'invalid-twin.md'), '# Malformed twin')
  const scan = specs.scanForListing()
  assert.deepEqual(scan.documents, [])
  assert.equal(scan.diagnostics.length, 4)
  for (const diagnostic of scan.diagnostics) assert.match(diagnostic.message, /ambiguous/)
  assert.match(
    scan.diagnostics.find(({ path }) => path === 'specs/invalid-twin.md')!.message,
    /YAML frontmatter/
  )
  assert.throws(() => specs.get('duplicate'), /ambiguous/)
  assert.throws(() => specs.get('invalid-twin'), /ambiguous/)
})

test('invalid files still fail strict validation and guarded mutations leave bytes unchanged', () => {
  const specs = store()
  createProductSpec(specs, 'feature', 'source')
  const sourcePath = join(specs.root, 'source.md')
  const brokenPath = join(specs.root, 'broken.md')
  const before = readFileSync(sourcePath, 'utf8')
  writeFileSync(brokenPath, '# Missing frontmatter')
  assert.throws(() => specs.validate(), /YAML frontmatter/)
  assert.throws(() => specs.search('source'), /YAML frontmatter/)
  assert.throws(() => specs.updateContent('source', 'Changed'), /YAML frontmatter/)
  assert.throws(() => specs.updateMetadata('broken', { title: 'Changed' }), /YAML frontmatter/)
  assert.throws(
    () =>
      specs.create({
        slug: 'broken-tech',
        title: 'Technical',
        description: 'Design',
        specKind: 'technical',
        status: 'draft',
        sourceSpec: 'broken',
        relatedSpecs: [],
        content: '',
      }),
    /YAML frontmatter/
  )
  assert.equal(readFileSync(sourcePath, 'utf8'), before)
  assert.equal(readFileSync(brokenPath, 'utf8'), '# Missing frontmatter')
  assert.equal(existsSync(join(specs.root, 'broken-tech.md')), false)
})
