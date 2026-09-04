import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

export const SPEC_KINDS = ['use-case', 'technical'] as const
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
  relatedSpecs: SpecRelation[]
}

export interface SpecDocument {
  metadata: SpecMetadata
  content: string
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

function ensureSlug(value: string, field = 'slug'): string {
  if (!SLUG.test(value)) throw new Error(`${field} must be lowercase letters, numbers, and single hyphens`)
  return value
}

function asString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`)
  if (value.includes('\n') || value.includes('\r')) throw new Error(`${field} must be one line`)
  return value.trim()
}

function parseScalar(value: string): string {
  const trimmed = value.trim()
  if (trimmed.startsWith('"')) {
    try {
      const parsed = JSON.parse(trimmed)
      if (typeof parsed === 'string') return parsed
    } catch {
      // The error below names the field rather than leaking parser internals.
    }
    throw new Error('frontmatter contains an invalid quoted value')
  }
  return trimmed
}

function statusFor(kind: SpecKind, status: string): SpecStatus {
  const permitted = kind === 'use-case' ? USE_CASE_STATUSES : TECHNICAL_STATUSES
  if (!permitted.includes(status as never)) throw new Error(`status '${status}' is invalid for ${kind}`)
  return status as SpecStatus
}

function parseMetadata(header: string): SpecMetadata {
  const values = new Map<string, string>()
  const relations: SpecRelation[] = []
  let pending: Partial<SpecRelation> | null = null

  for (const raw of header.split('\n')) {
    if (!raw.trim()) continue
    const relationStart = raw.match(/^\s{2}-\s+slug:\s*(.+)$/)
    if (relationStart) {
      if (pending?.slug || pending?.relationship) throw new Error('related_specs entry is incomplete')
      pending = { slug: parseScalar(relationStart[1]) }
      continue
    }
    const relationField = raw.match(/^\s{4}relationship:\s*(.+)$/)
    if (relationField) {
      if (!pending?.slug) throw new Error('related_specs relationship must follow a slug')
      const relationship = parseScalar(relationField[1]) as Relationship
      if (!RELATIONSHIPS.includes(relationship)) throw new Error(`invalid relationship '${relationship}'`)
      relations.push({ slug: ensureSlug(pending.slug, 'related_specs.slug'), relationship })
      pending = null
      continue
    }
    const field = raw.match(/^([a-z_]+):\s*(.*)$/)
    if (!field) throw new Error(`unsupported frontmatter line: ${raw}`)
    if (field[1] === 'related_specs') continue
    if (pending) throw new Error('related_specs entry is incomplete')
    values.set(field[1], parseScalar(field[2]))
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
  for (const field of values.keys()) if (!known.has(field)) throw new Error(`unsupported frontmatter field '${field}'`)

  const specKind = asString(values.get('spec_kind'), 'spec_kind') as SpecKind
  if (!SPEC_KINDS.includes(specKind)) throw new Error(`invalid spec_kind '${specKind}'`)
  const sourceSpec = values.get('source_spec')
  if (specKind === 'technical' && !sourceSpec) throw new Error('source_spec is required for technical specs')
  if (specKind === 'use-case' && sourceSpec) throw new Error('source_spec is only valid for technical specs')
  return {
    slug: ensureSlug(asString(values.get('slug'), 'slug')),
    title: asString(values.get('title'), 'title'),
    description: asString(values.get('description'), 'description'),
    specKind,
    status: statusFor(specKind, asString(values.get('status'), 'status')),
    createdAt: asString(values.get('created_at'), 'created_at'),
    lastUpdated: asString(values.get('last_updated'), 'last_updated'),
    sourceSpec: sourceSpec ? ensureSlug(sourceSpec, 'source_spec') : undefined,
    relatedSpecs: relations,
  }
}

function parseDocument(raw: string): SpecDocument {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) throw new Error('spec must begin with a YAML frontmatter block')
  return { metadata: parseMetadata(match[1]), content: match[2] }
}

function yaml(value: string): string {
  return JSON.stringify(value)
}

function serialize(doc: SpecDocument): string {
  const { metadata, content } = doc
  const lines = [
    '---',
    `slug: ${yaml(metadata.slug)}`,
    `title: ${yaml(metadata.title)}`,
    `description: ${yaml(metadata.description)}`,
    `spec_kind: ${metadata.specKind}`,
    `status: ${metadata.status}`,
    `created_at: ${yaml(metadata.createdAt)}`,
    `last_updated: ${yaml(metadata.lastUpdated)}`,
  ]
  if (metadata.sourceSpec) lines.push(`source_spec: ${metadata.sourceSpec}`)
  if (metadata.relatedSpecs.length) {
    lines.push('related_specs:')
    for (const relation of metadata.relatedSpecs) {
      lines.push(`  - slug: ${relation.slug}`, `    relationship: ${relation.relationship}`)
    }
  }
  lines.push('---', '')
  return lines.join('\n') + content
}

function now(): string {
  return new Date().toISOString()
}

export class SpecStore {
  readonly root: string

  constructor(docsPath: string) {
    this.root = resolve(docsPath, 'specs')
  }

  private path(slug: string): string {
    return join(this.root, `${ensureSlug(slug)}.md`)
  }

  private write(doc: SpecDocument): void {
    mkdirSync(this.root, { recursive: true })
    const destination = this.path(doc.metadata.slug)
    const temporary = `${destination}.${process.pid}.tmp`
    writeFileSync(temporary, serialize(doc), 'utf8')
    renameSync(temporary, destination)
  }

  get(slug: string): SpecDocument {
    const path = this.path(slug)
    if (!existsSync(path)) throw new Error(`spec '${slug}' was not found`)
    const document = parseDocument(readFileSync(path, 'utf8'))
    if (document.metadata.slug !== slug) throw new Error(`spec filename and slug disagree for '${slug}'`)
    return document
  }

  list(): SpecDocument[] {
    if (!existsSync(this.root)) return []
    return readdirSync(this.root)
      .filter((file) => file.endsWith('.md'))
      .sort()
      .map((file) => this.get(file.slice(0, -3)))
  }

  create(input: Omit<SpecMetadata, 'createdAt' | 'lastUpdated'> & { content: string }): SpecDocument {
    ensureSlug(input.slug)
    if (existsSync(this.path(input.slug))) throw new Error(`spec '${input.slug}' already exists`)
    if (input.specKind === 'technical') this.requireApprovedSource(input.sourceSpec)
    const timestamp = now()
    const document: SpecDocument = {
      metadata: { ...input, createdAt: timestamp, lastUpdated: timestamp },
      content: input.content,
    }
    this.write(document)
    return document
  }

  updateMetadata(slug: string, changes: Partial<Omit<SpecMetadata, 'slug' | 'createdAt'>>): SpecDocument {
    const document = this.get(slug)
    const metadata = { ...document.metadata, ...changes, lastUpdated: now() }
    if (metadata.specKind === 'technical') this.requireApprovedSource(metadata.sourceSpec)
    this.invalidateTechnicalSpecs(document.metadata)
    if (document.metadata.status === 'needs-decision') metadata.status = 'needs-decision'
    document.metadata = metadata
    this.write(document)
    return document
  }

  updateContent(slug: string, content: string): SpecDocument {
    const document = this.get(slug)
    this.invalidateTechnicalSpecs(document.metadata)
    document.content = content
    document.metadata.lastUpdated = now()
    this.write(document)
    return document
  }

  transition(slug: string, status: SpecStatus): SpecDocument {
    const document = this.get(slug)
    document.metadata.status = statusFor(document.metadata.specKind, status)
    if (document.metadata.specKind === 'technical' && status === 'approved') {
      this.requireApprovedSource(document.metadata.sourceSpec)
    }
    document.metadata.lastUpdated = now()
    this.write(document)
    return document
  }

  link(slug: string, targetSlug: string, relationship: Relationship): void {
    const source = this.get(slug)
    const target = this.get(targetSlug)
    if (slug === targetSlug) throw new Error('a spec cannot relate to itself')
    if (!RELATIONSHIPS.includes(relationship)) throw new Error(`invalid relationship '${relationship}'`)
    this.addRelation(source, { slug: targetSlug, relationship })
    this.addRelation(target, { slug, relationship: inverse[relationship] })
    source.metadata.lastUpdated = now()
    target.metadata.lastUpdated = now()
    this.write(source)
    this.write(target)
  }

  unlink(slug: string, targetSlug: string, relationship: Relationship): void {
    const source = this.get(slug)
    const target = this.get(targetSlug)
    source.metadata.relatedSpecs = source.metadata.relatedSpecs.filter(
      (entry) => entry.slug !== targetSlug || entry.relationship !== relationship
    )
    target.metadata.relatedSpecs = target.metadata.relatedSpecs.filter(
      (entry) => entry.slug !== slug || entry.relationship !== inverse[relationship]
    )
    source.metadata.lastUpdated = now()
    target.metadata.lastUpdated = now()
    this.write(source)
    this.write(target)
  }

  validate(): string[] {
    const documents = this.list()
    const known = new Set(documents.map((document) => document.metadata.slug))
    const errors: string[] = []
    for (const document of documents) {
      const { metadata } = document
      if (metadata.sourceSpec && !known.has(metadata.sourceSpec)) errors.push(`${metadata.slug}: source_spec is missing`)
      for (const relation of metadata.relatedSpecs) {
        if (!known.has(relation.slug)) errors.push(`${metadata.slug}: related spec '${relation.slug}' is missing`)
      }
    }
    return errors
  }

  private addRelation(document: SpecDocument, relation: SpecRelation): void {
    if (!document.metadata.relatedSpecs.some((entry) => entry.slug === relation.slug && entry.relationship === relation.relationship)) {
      document.metadata.relatedSpecs.push(relation)
    }
  }

  private requireApprovedSource(sourceSpec: string | undefined): void {
    if (!sourceSpec) throw new Error('source_spec is required for technical specs')
    const source = this.get(sourceSpec)
    if (source.metadata.specKind !== 'use-case' || source.metadata.status !== 'approved') {
      throw new Error(`source_spec '${sourceSpec}' must be an approved use-case spec`)
    }
  }

  private invalidateTechnicalSpecs(changed: SpecMetadata): void {
    if (changed.specKind !== 'use-case' || changed.status !== 'approved') return
    for (const candidate of this.list()) {
      if (candidate.metadata.specKind === 'technical' && candidate.metadata.sourceSpec === changed.slug) {
        candidate.metadata.status = 'needs-reconciliation'
        candidate.metadata.lastUpdated = now()
        this.write(candidate)
      }
    }
    changed.status = 'needs-decision'
  }
}

export function specHeader(document: SpecDocument): SpecMetadata {
  return document.metadata
}
