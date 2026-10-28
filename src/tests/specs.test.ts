import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, test } from 'node:test'

import { SPEC_KINDS, SpecStore } from '@/core/specs'

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
  const raw = readFileSync(join(specs.root, '..', specs.filePath('alpha')), 'utf8')
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
    readFileSync(join(specs.root, '..', specs.filePath('duplicate')))
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
  const sourcePath = join(specs.root, '..', specs.filePath('source'))
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

test('all kinds get a UTC creation-date filename while metadata identity and paths stay stable', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-29T00:30:00.000Z') })
  const specs = store()
  createUseCase(specs, 'approved-source')
  for (const specKind of SPEC_KINDS) {
    const slug = `document-${specKind}`
    const doc = specs.create({
      slug,
      title: 'Original title',
      description: 'Description',
      specKind,
      status: 'draft',
      sourceSpec:
        specKind === 'technical' || specKind === 'spec-tech' ? 'approved-source' : undefined,
      relatedSpecs: [],
      content: 'Original content',
    })
    const expected = `${specKind === 'use-case' ? 'use-cases' : 'specs'}/2026-10-29-${slug}.md`
    assert.equal(specs.filePath(slug), expected)
    assert.equal(doc.metadata.slug, slug)
    assert.equal(doc.metadata.title, 'Original title')
    assert.equal('filePath' in doc.metadata, false)
    assert.equal(doc.metadata.createdAt, '2026-10-29T00:30:00.000Z')
  }
  t.mock.timers.setTime(new Date('2026-11-03T00:00:00Z').getTime())
  for (const { metadata } of specs.list()) {
    if (metadata.slug === 'approved-source') continue
    const before = specs.filePath(metadata.slug)
    specs.updateContent(metadata.slug, 'Edited')
    specs.updateMetadata(metadata.slug, { title: 'Edited title' })
    specs.transition(metadata.slug, 'draft')
    assert.equal(specs.filePath(metadata.slug), before)
  }
  assert.deepEqual(specs.validate(), [])
})

test('legacy basenames and legacy use-case directories survive edits, relations and invalidation', () => {
  const specs = store()
  createUseCase(specs, 'legacy')
  createUseCase(specs, 'modern')
  mkdirSync(specs.root)
  renameSync(join(specs.root, '..', specs.filePath('legacy')), join(specs.root, 'legacy.md'))
  specs.create({
    slug: 'legacy-tech',
    title: 'Tech',
    description: 'Tech',
    specKind: 'spec-tech',
    status: 'approved',
    sourceSpec: 'legacy',
    relatedSpecs: [],
    content: 'Design',
  })
  const techPath = specs.filePath('legacy-tech')
  specs.link('legacy', 'modern', 'depends-on')
  specs.unlink('legacy', 'modern', 'depends-on')
  specs.updateMetadata('legacy', { title: 'Updated legacy' })
  specs.updateContent('legacy', 'Updated body')
  specs.transition('legacy', 'draft')
  assert.equal(specs.filePath('legacy'), 'specs/legacy.md')
  assert.equal(specs.filePath('legacy-tech'), techPath)
  assert.equal(specs.get('legacy-tech').metadata.status, 'needs-reconciliation')
  assert.equal(readdirSync(specs.useCasesRoot).length, 1)
  assert.equal(readdirSync(specs.root).length, 2)
  assert.deepEqual(specs.validate(), [])
})

test('different dates still reserve the same logical slug, even with a malformed twin', () => {
  const specs = store()
  createUseCase(specs, 'same')
  const originalPath = join(specs.root, '..', specs.filePath('same'))
  const original = readFileSync(originalPath, 'utf8')
  mkdirSync(specs.root)
  const twin = join(specs.root, '2000-01-01-same.md')
  writeFileSync(twin, original)
  assert.throws(() => specs.get('same'), /ambiguous/)
  assert.throws(() => createUseCase(specs, 'same'), /already exists/)
  assert.equal(specs.scanForListing().documents.length, 0)
  assert.equal(specs.scanForListing().diagnostics.length, 2)
  writeFileSync(twin, '# Broken twin')
  assert.throws(() => specs.updateContent('same', 'Unsafe'), /ambiguous/)
  assert.equal(readFileSync(originalPath, 'utf8'), original)
  assert.equal(specs.scanForListing().documents.length, 0)
})

test('date-looking logical slugs remain distinct from physical prefixes and invalid dates are diagnostic', () => {
  const specs = store()
  createUseCase(specs, '2020-01-01-alpha', 'draft')
  const dated = join(specs.root, '..', specs.filePath('2020-01-01-alpha'))
  renameSync(dated, join(specs.useCasesRoot, '2020-01-01-alpha.md'))
  createUseCase(specs, 'alpha', 'draft')
  assert.equal(specs.get('2020-01-01-alpha').metadata.slug, '2020-01-01-alpha')
  assert.equal(specs.scanForListing().documents.length, 2)
  const alpha = join(specs.root, '..', specs.filePath('alpha'))
  renameSync(alpha, join(specs.useCasesRoot, '2020-99-99-alpha.md'))
  assert.match(specs.scanForListing().diagnostics[0].message, /filename and slug disagree/)
})

test('a date-looking legacy slug cannot be overwritten by a new physical filename collision', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-28T00:00:00Z') })
  const specs = store()
  createUseCase(specs, '2026-10-28-alpha', 'draft')
  const path = join(specs.useCasesRoot, '2026-10-28-alpha.md')
  renameSync(join(specs.root, '..', specs.filePath('2026-10-28-alpha')), path)
  const before = readFileSync(path, 'utf8')
  assert.throws(() => createUseCase(specs, 'alpha', 'draft'), /filename.*already exists/)
  assert.equal(readFileSync(path, 'utf8'), before)
  assert.equal(specs.get('2026-10-28-alpha').metadata.slug, '2026-10-28-alpha')
  assert.equal(specs.list().length, 1)
})
