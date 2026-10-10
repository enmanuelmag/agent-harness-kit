import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

/** Legacy names remain readable so existing project documents never disappear. */
export const SPEC_KINDS = ['use-case', 'spec', 'feature', 'fix', 'spec-tech', 'technical'] as const
export const PRODUCT_SPEC_KINDS = ['spec', 'feature', 'fix', 'use-case'] as const
export const FUNCTIONAL_SPEC_KINDS = ['spec', 'feature', 'fix'] as const
export const TECHNICAL_SPEC_KINDS = ['spec-tech', 'technical'] as const
export const USE_CASE_STATUSES = ['draft', 'needs-decision', 'approved', 'superseded'] as const
export const TECHNICAL_STATUSES = [
  'draft',
  'needs-reconciliation',
  'approved',
  'superseded',
] as const
export const RELATIONSHIPS = [
  'depends-on',
  'required-by',
  'extends',
  'extended-by',
  'supersedes',
  'superseded-by',
  'conflicts-with',
  'informs',
  'informed-by',
] as const
export type SpecKind = (typeof SPEC_KINDS)[number]
export type SpecStatus = (typeof USE_CASE_STATUSES)[number] | (typeof TECHNICAL_STATUSES)[number]
export type Relationship = (typeof RELATIONSHIPS)[number]
export interface SpecRelation {
  slug: string
  relationship: Relationship
}
export interface SpecMetadata {
  slug: string
  title: string
  description: string
  specKind: SpecKind
  status: SpecStatus
  createdAt: string
  lastUpdated: string
  sourceSpec?: string
  sourceUseCases: string[]
  relatedSpecs: SpecRelation[]
}
export interface SpecDocument {
  metadata: SpecMetadata
  content: string
}
export interface SpecListingDiagnostic {
  path: string
  message: string
}
export interface SpecListingScan {
  documents: SpecDocument[]
  diagnostics: SpecListingDiagnostic[]
}
export interface SpecSearchResult {
  document: SpecDocument
  excerpt: string
}
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const inverse: Record<Relationship, Relationship> = {
  'depends-on': 'required-by',
  'required-by': 'depends-on',
  extends: 'extended-by',
  'extended-by': 'extends',
  supersedes: 'superseded-by',
  'superseded-by': 'supersedes',
  'conflicts-with': 'conflicts-with',
  informs: 'informed-by',
  'informed-by': 'informs',
}
const technical = (k: SpecKind) => TECHNICAL_SPEC_KINDS.includes(k as never)
const trueUseCase = (k: SpecKind) => k === 'use-case'
const functional = (k: SpecKind) => FUNCTIONAL_SPEC_KINDS.includes(k as never) || k === 'use-case'
function ensureSlug(value: string, field = 'slug') {
  if (!SLUG.test(value))
    throw new Error(`${field} must be lowercase letters, numbers, and single hyphens`)
  return value
}
function asString(value: unknown, field: string) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`)
  if (/\r|\n/.test(value)) throw new Error(`${field} must be one line`)
  return value.trim()
}
function scalar(v: string) {
  const t = v.trim()
  if (t.startsWith('"')) {
    try {
      const p = JSON.parse(t)
      if (typeof p === 'string') return p
    } catch {}
    throw new Error('frontmatter contains an invalid quoted value')
  }
  return t
}
function statusFor(kind: SpecKind, status: string): SpecStatus {
  const allowed = technical(kind) ? TECHNICAL_STATUSES : USE_CASE_STATUSES
  if (!allowed.includes(status as never))
    throw new Error(`status '${status}' is invalid for ${kind}`)
  return status as SpecStatus
}
function parseMetadata(header: string): SpecMetadata {
  const values = new Map<string, string>(),
    relations: SpecRelation[] = []
  let pending: Partial<SpecRelation> | null = null
  const sourceUseCases: string[] = []
  let listMode = false
  for (const raw of header.split('\n')) {
    if (!raw.trim()) continue
    if (/^source_use_cases:\s*$/.test(raw)) {
      listMode = true
      continue
    }
    const uc = raw.match(/^\s{2}-\s+(.+)$/)
    if (listMode && uc) {
      sourceUseCases.push(ensureSlug(scalar(uc[1]), 'source_use_cases'))
      continue
    }
    listMode = false
    const rs = raw.match(/^\s{2}-\s+slug:\s*(.+)$/)
    if (rs) {
      if (pending?.slug || pending?.relationship)
        throw new Error('related_specs entry is incomplete')
      pending = { slug: scalar(rs[1]) }
      continue
    }
    const rf = raw.match(/^\s{4}relationship:\s*(.+)$/)
    if (rf) {
      if (!pending?.slug) throw new Error('related_specs relationship must follow a slug')
      const relationship = scalar(rf[1]) as Relationship
      if (!RELATIONSHIPS.includes(relationship))
        throw new Error(`invalid relationship '${relationship}'`)
      relations.push({ slug: ensureSlug(pending.slug, 'related_specs.slug'), relationship })
      pending = null
      continue
    }
    const f = raw.match(/^([a-z_]+):\s*(.*)$/)
    if (!f) throw new Error(`unsupported frontmatter line: ${raw}`)
    if (f[1] === 'related_specs') continue
    if (pending) throw new Error('related_specs entry is incomplete')
    values.set(f[1], scalar(f[2]))
  }
  if (pending) throw new Error('related_specs entry is incomplete')
  const known = new Set([
    'slug',
    'title',
    'description',
    'spec_kind',
    'status',
    'created_at',
    'last_updated',
    'source_spec',
  ])
  for (const key of values.keys())
    if (!known.has(key)) throw new Error(`unsupported frontmatter field '${key}'`)
  const specKind = asString(values.get('spec_kind'), 'spec_kind') as SpecKind
  if (!SPEC_KINDS.includes(specKind)) throw new Error(`invalid spec_kind '${specKind}'`)
  const sourceSpec = values.get('source_spec')
  if (technical(specKind) && !sourceSpec)
    throw new Error('source_spec is required for technical specs')
  if (!technical(specKind) && sourceSpec)
    throw new Error('source_spec is only valid for technical specs')
  if (!functional(specKind) && sourceUseCases.length)
    throw new Error('source_use_cases is only valid for functional specs')
  return {
    slug: ensureSlug(asString(values.get('slug'), 'slug')),
    title: asString(values.get('title'), 'title'),
    description: asString(values.get('description'), 'description'),
    specKind,
    status: statusFor(specKind, asString(values.get('status'), 'status')),
    createdAt: asString(values.get('created_at'), 'created_at'),
    lastUpdated: asString(values.get('last_updated'), 'last_updated'),
    sourceSpec: sourceSpec ? ensureSlug(sourceSpec, 'source_spec') : undefined,
    sourceUseCases: [...new Set(sourceUseCases)],
    relatedSpecs: relations,
  }
}
function parseDocument(raw: string): SpecDocument {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!m) throw new Error('spec must begin with a YAML frontmatter block')
  return { metadata: parseMetadata(m[1]), content: m[2] }
}
function serialize(doc: SpecDocument) {
  const m = doc.metadata,
    lines = [
      '---',
      `slug: ${JSON.stringify(m.slug)}`,
      `title: ${JSON.stringify(m.title)}`,
      `description: ${JSON.stringify(m.description)}`,
      `spec_kind: ${m.specKind}`,
      `status: ${m.status}`,
      `created_at: ${JSON.stringify(m.createdAt)}`,
      `last_updated: ${JSON.stringify(m.lastUpdated)}`,
    ]
  if (m.sourceSpec) lines.push(`source_spec: ${m.sourceSpec}`)
  if (m.sourceUseCases.length) {
    lines.push('source_use_cases:')
    for (const s of m.sourceUseCases) lines.push(`  - ${s}`)
  }
  if (m.relatedSpecs.length) {
    lines.push('related_specs:')
    for (const r of m.relatedSpecs)
      lines.push(`  - slug: ${r.slug}`, `    relationship: ${r.relationship}`)
  }
  return lines.concat(['---', '']).join('\n') + doc.content
}
const now = () => new Date().toISOString()
export class SpecStore {
  private readonly docsPath: string
  readonly root: string
  readonly useCasesRoot: string
  constructor(docsPath: string) {
    this.docsPath = resolve(docsPath)
    this.root = resolve(docsPath, 'specs')
    this.useCasesRoot = resolve(docsPath, 'use-cases')
  }
  private roots() {
    return [this.useCasesRoot, this.root]
  }
  private paths(slug: string) {
    ensureSlug(slug)
    return this.roots().map((root) => join(root, `${slug}.md`))
  }
  private location(doc: SpecDocument) {
    return trueUseCase(doc.metadata.specKind) ? this.useCasesRoot : this.root
  }
  private write(doc: SpecDocument) {
    mkdirSync(this.location(doc), { recursive: true })
    const dest = join(this.location(doc), `${doc.metadata.slug}.md`),
      tmp = `${dest}.${process.pid}.tmp`
    writeFileSync(tmp, serialize(doc), 'utf8')
    renameSync(tmp, dest)
  }
  private located(slug: string) {
    const paths = this.paths(slug).filter(existsSync)
    if (!paths.length) throw new Error(`spec '${slug}' was not found`)
    if (paths.length > 1)
      throw new Error(`spec slug '${slug}' is ambiguous across docs/use-cases and docs/specs`)
    return paths[0]
  }
  get(slug: string) {
    const path = this.located(slug),
      d = parseDocument(readFileSync(path, 'utf8'))
    if (d.metadata.slug !== slug) throw new Error(`spec filename and slug disagree for '${slug}'`)
    this.validateRoot(path, d)
    return d
  }
  private candidates() {
    return this.roots().flatMap((root) =>
      existsSync(root)
        ? readdirSync(root)
            .filter((file) => file.endsWith('.md') && file.toLowerCase() !== 'readme.md')
            .sort()
            .map((file) => ({ file, path: join(root, file) }))
        : []
    )
  }
  private readCandidate(path: string, file: string) {
    const document = parseDocument(readFileSync(path, 'utf8'))
    if (document.metadata.slug !== file.slice(0, -3))
      throw new Error(`spec filename and slug disagree for '${file}'`)
    this.validateRoot(path, document)
    return document
  }
  list() {
    const docs: SpecDocument[] = []
    const seen = new Set<string>()
    for (const { file, path } of this.candidates()) {
      const document = this.readCandidate(path, file)
      if (seen.has(document.metadata.slug))
        throw new Error(
          `spec slug '${document.metadata.slug}' is ambiguous across docs/use-cases and docs/specs`
        )
      seen.add(document.metadata.slug)
      docs.push(document)
    }
    return docs.sort((a, b) => a.metadata.slug.localeCompare(b.metadata.slug))
  }
  /** Discovery only: strict domain consumers continue to use list()/get(). */
  scanForListing(): SpecListingScan {
    const candidates = this.candidates()
    const counts = new Map<string, number>()
    for (const { file } of candidates) counts.set(file, (counts.get(file) ?? 0) + 1)
    const documents: SpecDocument[] = []
    const diagnostics: SpecListingDiagnostic[] = []
    for (const { file, path } of candidates) {
      const problems: string[] = []
      let document: SpecDocument | undefined
      try {
        document = this.readCandidate(path, file)
      } catch (error) {
        problems.push(error instanceof Error ? error.message : String(error))
      }
      // get() rejects both paths even if one twin has invalid frontmatter.
      if (counts.get(file)! > 1)
        problems.push(
          `spec slug '${file.slice(0, -3)}' is ambiguous across docs/use-cases and docs/specs`
        )
      if (problems.length)
        diagnostics.push({
          path: relative(this.docsPath, path).split(sep).join('/'),
          message: problems.join('; '),
        })
      else documents.push(document!)
    }
    return {
      documents: documents.sort((a, b) => a.metadata.slug.localeCompare(b.metadata.slug)),
      diagnostics,
    }
  }
  search(query: string) {
    const needle = asString(query, 'query').toLowerCase()
    return this.list().flatMap((document) => {
      const h = `${document.metadata.slug}\n${document.metadata.title}\n${document.metadata.description}\n${document.content}`,
        i = h.toLowerCase().indexOf(needle)
      return i < 0
        ? []
        : [
            {
              document,
              excerpt: h
                .slice(Math.max(0, i - 80), Math.min(h.length, i + needle.length + 160))
                .replace(/\s+/g, ' ')
                .trim(),
            },
          ]
    })
  }
  create(
    input: Omit<SpecMetadata, 'createdAt' | 'lastUpdated' | 'sourceUseCases'> & {
      sourceUseCases?: string[]
      content: string
    }
  ) {
    ensureSlug(input.slug)
    if (this.paths(input.slug).some(existsSync))
      throw new Error(`spec '${input.slug}' already exists`)
    const doc = {
      metadata: {
        ...input,
        sourceUseCases: input.sourceUseCases ?? [],
        createdAt: now(),
        lastUpdated: now(),
      },
      content: input.content,
    }
    this.validateInput(doc)
    this.write(doc)
    return doc
  }
  updateMetadata(slug: string, changes: Partial<Omit<SpecMetadata, 'slug' | 'createdAt'>>) {
    const d = this.get(slug),
      before = { ...d.metadata }
    d.metadata = {
      ...d.metadata,
      ...changes,
      sourceUseCases: changes.sourceUseCases ?? d.metadata.sourceUseCases,
      lastUpdated: now(),
    }
    this.validateInput(d)
    this.invalidateFromChange(before, d)
    this.write(d)
    return d
  }
  updateContent(slug: string, content: string) {
    const d = this.get(slug),
      before = { ...d.metadata }
    d.content = content
    d.metadata.lastUpdated = now()
    this.invalidateFromChange(before, d)
    this.write(d)
    return d
  }
  transition(slug: string, status: SpecStatus) {
    const d = this.get(slug)
    d.metadata.status = statusFor(d.metadata.specKind, status)
    if (technical(d.metadata.specKind) && status === 'approved')
      this.requireApprovedSource(d.metadata.sourceSpec)
    if (functional(d.metadata.specKind) && status === 'approved')
      this.requireApprovedUseCases(d.metadata.sourceUseCases)
    d.metadata.lastUpdated = now()
    this.write(d)
    return d
  }
  link(slug: string, targetSlug: string, relationship: Relationship) {
    const a = this.get(slug),
      b = this.get(targetSlug)
    if (slug === targetSlug) throw new Error('a spec cannot relate to itself')
    if (!RELATIONSHIPS.includes(relationship))
      throw new Error(`invalid relationship '${relationship}'`)
    this.add(a, { slug: targetSlug, relationship })
    this.add(b, { slug, relationship: inverse[relationship] })
    a.metadata.lastUpdated = b.metadata.lastUpdated = now()
    this.write(a)
    this.write(b)
  }
  unlink(slug: string, targetSlug: string, relationship: Relationship) {
    const a = this.get(slug),
      b = this.get(targetSlug)
    a.metadata.relatedSpecs = a.metadata.relatedSpecs.filter(
      (x) => x.slug !== targetSlug || x.relationship !== relationship
    )
    b.metadata.relatedSpecs = b.metadata.relatedSpecs.filter(
      (x) => x.slug !== slug || x.relationship !== inverse[relationship]
    )
    a.metadata.lastUpdated = b.metadata.lastUpdated = now()
    this.write(a)
    this.write(b)
  }
  validate() {
    const docs = this.list(),
      known = new Map(docs.map((d) => [d.metadata.slug, d]))
    const errors: string[] = []
    for (const d of docs) {
      const m = d.metadata
      if (m.sourceSpec && !known.has(m.sourceSpec)) errors.push(`${m.slug}: source_spec is missing`)
      for (const uc of m.sourceUseCases) {
        const source = known.get(uc)
        if (!source) errors.push(`${m.slug}: source use-case '${uc}' is missing`)
        else if (!trueUseCase(source.metadata.specKind))
          errors.push(`${m.slug}: source use-case '${uc}' is not a use-case`)
      }
      for (const r of m.relatedSpecs)
        if (!known.has(r.slug)) errors.push(`${m.slug}: related spec '${r.slug}' is missing`)
    }
    return errors
  }
  private validateInput(doc: SpecDocument) {
    const m = doc.metadata
    if (technical(m.specKind)) this.requireApprovedSource(m.sourceSpec)
    if (m.sourceUseCases.length)
      for (const slug of m.sourceUseCases) {
        const source = this.get(slug)
        if (!trueUseCase(source.metadata.specKind))
          throw new Error(`source_use_cases '${slug}' must be a use-case`)
      }
  }
  private validateRoot(path: string, doc: SpecDocument) {
    const inUseCases = path.startsWith(`${this.useCasesRoot}/`)
    if (inUseCases && !trueUseCase(doc.metadata.specKind))
      throw new Error(`${doc.metadata.slug}: use-case documents belong in docs/use-cases`)
    if (!inUseCases && trueUseCase(doc.metadata.specKind)) {
      /* legacy docs/specs use-case is intentionally readable as a functional spec until explicit migration */
    }
  }
  private requireApprovedSource(source: string | undefined) {
    if (!source) throw new Error('source_spec is required for technical specs')
    const d = this.get(source)
    if (!functional(d.metadata.specKind) || d.metadata.status !== 'approved')
      throw new Error(`source_spec '${source}' must be an approved spec, feature, or fix spec`)
  }
  private requireApprovedUseCases(slugs: string[]) {
    for (const slug of slugs) {
      const d = this.get(slug)
      if (!trueUseCase(d.metadata.specKind) || d.metadata.status !== 'approved')
        throw new Error(`source_use_cases '${slug}' must be an approved use-case`)
    }
  }
  private add(d: SpecDocument, r: SpecRelation) {
    if (
      !d.metadata.relatedSpecs.some((x) => x.slug === r.slug && x.relationship === r.relationship)
    )
      d.metadata.relatedSpecs.push(r)
  }
  private invalidateFromChange(changed: SpecMetadata, current: SpecDocument) {
    if (changed.status !== 'approved') return
    const docs = this.list()
    const isRealUseCase =
      trueUseCase(changed.specKind) && existsSync(join(this.useCasesRoot, `${changed.slug}.md`))
    if (isRealUseCase) {
      current.metadata.status = 'needs-decision'
      for (const techDoc of docs)
        if (technical(techDoc.metadata.specKind) && techDoc.metadata.sourceSpec === changed.slug) {
          techDoc.metadata.status = 'needs-reconciliation'
          techDoc.metadata.lastUpdated = now()
          this.write(techDoc)
        }
      for (const d of docs)
        if (functional(d.metadata.specKind) && d.metadata.sourceUseCases.includes(changed.slug)) {
          d.metadata.status = 'needs-decision'
          d.metadata.lastUpdated = now()
          this.write(d)
          for (const techDoc of docs)
            if (
              technical(techDoc.metadata.specKind) &&
              techDoc.metadata.sourceSpec === d.metadata.slug
            ) {
              techDoc.metadata.status = 'needs-reconciliation'
              techDoc.metadata.lastUpdated = now()
              this.write(techDoc)
            }
        }
    } else if (functional(changed.specKind)) {
      current.metadata.status = 'needs-decision'
      for (const d of docs)
        if (technical(d.metadata.specKind) && d.metadata.sourceSpec === changed.slug) {
          d.metadata.status = 'needs-reconciliation'
          d.metadata.lastUpdated = now()
          this.write(d)
        }
    }
  }
}
export function specHeader(document: SpecDocument) {
  return document.metadata
}
