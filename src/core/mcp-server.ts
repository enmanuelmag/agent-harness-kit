import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { type CallToolResult, McpServer } from '@modelcontextprotocol/server'
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'

import { type HarnessDB, openDB } from './db'
import { getDoctorStatus } from './doctor'
import { detectPackageManager, getRunOnceCommandParts } from './materializer/detect-package-manager'
import { slugify } from './materializer/scaffold-utils'
import {
  inputContracts,
  outputContracts,
  sdkInputContracts,
  structuredResult,
} from './mcp-contracts'
import {
  assertNormalized,
  boundedInt,
  num,
  optionalStr,
  optionalStringArray,
  requiredStringArray,
  str,
} from './mcp-normalizers'
import { TOOLS } from './mcp-tools'
import {
  collectOperationalNotices,
  createNoticeSession,
  noticesForDelivery,
} from './operational-notices'
import { pkg } from './package-data'
import { checkPermissionsSync } from './permissions-check'
import {
  type Relationship,
  RELATIONSHIPS,
  SPEC_KINDS,
  type SpecKind,
  type SpecMetadata,
  SpecStore,
} from './specs'
import { runTaskHealthCheck } from './task-health'
import { warmUpdateCache } from './update-check'

import type { ActionStatus, AgentName, HarnessConfig, TaskStatus } from '@/types'

// ─── Server ───────────────────────────────────────────────────────────────────

export async function startMcpServer(config: HarnessConfig, cwd: string): Promise<void> {
  const db = await openDB(config, cwd)
  const docsPath = resolve(cwd, config.project.docsPath)

  const server = createMcpServer(config, cwd, db, docsPath)
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

/** Registration is also exposed for real protocol tests with an isolated database. */
export function createMcpServer(
  config: HarnessConfig,
  cwd: string,
  db: HarnessDB,
  docsPath = resolve(cwd, config.project.docsPath)
): McpServer {
  const server = new McpServer({ name: 'agent-harness-kit', version: pkg.version })
  warmUpdateCache()
  const noticeSession = createNoticeSession()
  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: sdkInputContracts[tool.name],
        outputSchema: outputContracts[tool.name],
      },
      async (args) => {
        const a = args as Record<string, unknown>
        try {
          assertNormalized(a)
          const result = await execute(tool.name, a, db, docsPath, cwd, config)
          return attachOperationalNotices(
            tool.name,
            a,
            cwd,
            config.provider,
            structuredResult(tool.name, result),
            noticeSession
          )
        } catch (err) {
          return attachOperationalNotices(
            tool.name,
            a,
            cwd,
            config.provider,
            ok(`Error: ${err instanceof Error ? err.message : String(err)}`, true),
            noticeSession
          )
        }
      }
    )
  }
  return server
}

// ─── Dispatch ─────────────────────────────────────────────────────────────────

export async function dispatch(
  name: string,
  args: Record<string, unknown>,
  db: HarnessDB,
  docsPath: string,
  cwd: string,
  config: HarnessConfig
): Promise<CallToolResult> {
  const contract = inputContracts[name]
  const normalized = contract ? contract.parse(args) : args
  assertNormalized(normalized)
  return structuredResult(name, await execute(name, normalized, db, docsPath, cwd, config))
}

async function execute(
  name: string,
  args: Record<string, unknown>,
  db: HarnessDB,
  docsPath: string,
  cwd: string,
  config: HarnessConfig
): Promise<CallToolResult> {
  const specs = new SpecStore(docsPath)
  switch (name) {
    case 'specs.list': {
      const specKind = optionalStr(args, 'specKind')
      if (specKind && !SPEC_KINDS.includes(specKind as SpecKind))
        throw new Error(`invalid specKind '${specKind}'`)
      const query = optionalStr(args, 'query')?.toLowerCase()
      const offset = boundedInt(args, 'offset', 0, 0, Number.MAX_SAFE_INTEGER)
      const limit = boundedInt(args, 'limit', 50, 1, 100)
      const scan = specs.scanForListing()
      const matches = scan.documents.filter(
        ({ metadata }) =>
          (!specKind || metadata.specKind === specKind) &&
          (!optionalStr(args, 'status') || metadata.status === optionalStr(args, 'status')) &&
          (!query ||
            `${metadata.slug} ${metadata.title} ${metadata.description}`
              .toLowerCase()
              .includes(query))
      )
      return ok(
        JSON.stringify({
          items: matches.slice(offset, offset + limit).map((doc) => doc.metadata),
          diagnostics: scan.diagnostics,
          nextOffset: offset + limit < matches.length ? offset + limit : null,
        })
      )
    }
    case 'specs.get': {
      const document = specs.get(str(args, 'slug'))
      const offset = boundedInt(args, 'offset', 0, 0, Number.MAX_SAFE_INTEGER)
      const limit = boundedInt(args, 'limit', 8000, 1, 12000)
      const content = document.content.slice(offset, offset + limit)
      const nextOffset = offset + content.length
      return ok(
        JSON.stringify({
          metadata: document.metadata,
          content,
          truncated: nextOffset < document.content.length,
          nextOffset: nextOffset < document.content.length ? nextOffset : null,
        })
      )
    }
    case 'specs.search': {
      const specKind = optionalStr(args, 'specKind')
      if (specKind && !SPEC_KINDS.includes(specKind as SpecKind))
        throw new Error(`invalid specKind '${specKind}'`)
      const status = optionalStr(args, 'status')
      const offset = boundedInt(args, 'offset', 0, 0, Number.MAX_SAFE_INTEGER)
      const limit = boundedInt(args, 'limit', 50, 1, 100)
      const matches = specs
        .search(str(args, 'query'))
        .filter(
          ({ document }) =>
            (!specKind || document.metadata.specKind === specKind) &&
            (!status || document.metadata.status === status)
        )
      return ok(
        JSON.stringify({
          items: matches.slice(offset, offset + limit).map(({ document, excerpt }) => ({
            metadata: document.metadata,
            excerpt,
          })),
          nextOffset: offset + limit < matches.length ? offset + limit : null,
        })
      )
    }
    case 'specs.related': {
      const slug = str(args, 'slug')
      specs.get(slug)
      const relationships = optionalStringArray(args, 'relationships')
      if (relationships?.some((value) => !RELATIONSHIPS.includes(value as Relationship)))
        throw new Error('relationships contains an invalid relationship')
      const related = specs.list().flatMap(({ metadata }) =>
        metadata.relatedSpecs
          .filter((relation) => relation.slug === slug || metadata.slug === slug)
          .filter((relation) => !relationships || relationships.includes(relation.relationship))
          .map((relation) => ({
            metadata: metadata.slug === slug ? specs.get(relation.slug).metadata : metadata,
            relationship: relation.relationship,
            direction: metadata.slug === slug ? 'outgoing' : 'incoming',
          }))
      )
      return ok(JSON.stringify({ slug, items: related }))
    }
    case 'specs.create': {
      const kind = str(args, 'specKind') as SpecKind
      if (!SPEC_KINDS.includes(kind)) throw new Error(`invalid specKind '${kind}'`)
      const document = specs.create({
        slug: str(args, 'slug'),
        title: str(args, 'title'),
        description: str(args, 'description'),
        specKind: kind,
        status: (optionalStr(args, 'status') ?? 'draft') as SpecMetadata['status'],
        sourceSpec: optionalStr(args, 'sourceSpec'),
        sourceUseCases: optionalStringArray(args, 'sourceUseCases') ?? [],
        relatedSpecs: [],
        content: str(args, 'content'),
      })
      return ok(JSON.stringify({ metadata: document.metadata }))
    }
    case 'specs.update_metadata': {
      const changes: Partial<Omit<SpecMetadata, 'slug' | 'createdAt'>> = {}
      if ('title' in args) changes.title = str(args, 'title')
      if ('description' in args) changes.description = str(args, 'description')
      if ('status' in args) changes.status = str(args, 'status') as SpecMetadata['status']
      if ('sourceSpec' in args) changes.sourceSpec = str(args, 'sourceSpec')
      if ('sourceUseCases' in args)
        changes.sourceUseCases = optionalStringArray(args, 'sourceUseCases') ?? []
      const document = specs.updateMetadata(str(args, 'slug'), changes)
      return ok(JSON.stringify({ metadata: document.metadata }))
    }
    case 'specs.update_content': {
      const document = specs.updateContent(str(args, 'slug'), str(args, 'content'))
      return ok(JSON.stringify({ metadata: document.metadata }))
    }
    case 'specs.transition': {
      const document = specs.transition(
        str(args, 'slug'),
        str(args, 'status') as SpecMetadata['status']
      )
      return ok(JSON.stringify({ metadata: document.metadata }))
    }
    case 'specs.link':
      specs.link(
        str(args, 'slug'),
        str(args, 'targetSlug'),
        str(args, 'relationship') as Relationship
      )
      return ok(JSON.stringify({ linked: true }))
    case 'specs.unlink':
      specs.unlink(
        str(args, 'slug'),
        str(args, 'targetSlug'),
        str(args, 'relationship') as Relationship
      )
      return ok(JSON.stringify({ unlinked: true }))
    case 'specs.validate':
      return ok(JSON.stringify({ valid: specs.validate().length === 0, errors: specs.validate() }))
    case 'actions.start': {
      const taskId = num(args, 'taskId')
      const agent = str(args, 'agent') as AgentName
      await db.assertActionCanStart(taskId, agent)
      const action = await db.startAction(taskId, agent)
      return ok(JSON.stringify({ actionId: action.id }))
    }

    case 'actions.write': {
      const actionId = num(args, 'actionId')
      const sectionType = str(args, 'sectionType')
      if (sectionType === 'handoff')
        throw new Error('handoff sections must be written with actions.handoff.write')
      const content = str(args, 'content')
      await db.writeSection(actionId, sectionType, content)
      return ok(JSON.stringify({ recorded: true }))
    }

    case 'actions.complete': {
      const actionId = num(args, 'actionId')
      const summary = str(args, 'summary')
      const action = await db.completeAction(actionId, summary)
      return ok(JSON.stringify({ status: action.status, completedAt: action.completed_at }))
    }

    case 'actions.get': {
      const taskId = num(args, 'taskId')
      const actions = await db.getActionsForTask(taskId)
      const full = await Promise.all(
        actions.map(async (a) => {
          const sections = await db.getActionSections(a.id)
          return {
            id: a.id,
            agent: a.agent,
            status: a.status,
            created_at: a.created_at,
            completed_at: a.completed_at,
            summary: a.summary,
            sections: sections.map((s) => ({
              id: s.id,
              section_type: s.section_type,
              content: s.content,
              created_at: s.created_at,
            })),
          }
        })
      )
      return ok(JSON.stringify(full))
    }

    case 'actions.list': {
      const taskId = num(args, 'taskId')
      const limit = boundedInt(args, 'limit', 20, 1, 100)
      const rows = await db.listActionsForTask(taskId, {
        agent: optionalAgent(args, 'agent'),
        status: optionalActionStatus(args, 'status'),
        cursor: decodeActionCursor(optionalStr(args, 'cursor')),
        limit,
      })
      const last = rows.at(-1)
      return ok(
        JSON.stringify({
          items: rows.map((row) => ({
            id: row.id,
            agent: row.agent,
            status: row.status,
            createdAt: row.created_at,
            completedAt: row.completed_at,
            summaryPreview: preview(row.summary),
            sectionCount: Number(row.section_count),
          })),
          nextCursor:
            rows.length === limit && last ? encodeActionCursor(last.created_at, last.id) : null,
        })
      )
    }

    case 'actions.get_by_id': {
      const actionId = num(args, 'actionId')
      const action = await db.getAction(actionId)
      if (!action) return ok(JSON.stringify({ error: 'ACTION_NOT_FOUND', actionId }), true)
      const sections = await db.listActionSections(actionId, { limit: 100 })
      return ok(
        JSON.stringify({
          id: action.id,
          taskId: action.task_id,
          agent: action.agent,
          status: action.status,
          summary: action.summary,
          createdAt: action.created_at,
          completedAt: action.completed_at,
          sections: sections.map(sectionIndex),
        })
      )
    }

    case 'actions.sections.list': {
      const actionId = num(args, 'actionId')
      const limit = boundedInt(args, 'limit', 20, 1, 100)
      const rows = await db.listActionSections(actionId, {
        types: optionalStringArray(args, 'types'),
        cursor: decodeSectionCursor(optionalStr(args, 'cursor')),
        limit,
      })
      const last = rows.at(-1)
      return ok(
        JSON.stringify({
          items: rows.map(sectionIndex),
          nextCursor: rows.length === limit && last ? encodeSectionCursor(last.id) : null,
        })
      )
    }

    case 'actions.sections.get': {
      const sectionId = num(args, 'sectionId')
      const offset = boundedInt(args, 'offset', 0, 0, Number.MAX_SAFE_INTEGER)
      const length = boundedInt(args, 'length', 8000, 1, 12000)
      const section = await db.getActionSection(sectionId)
      if (!section) return ok(JSON.stringify({ error: 'SECTION_NOT_FOUND', sectionId }), true)
      const content = section.content.slice(offset, offset + length)
      const nextOffset = offset + content.length
      return ok(
        JSON.stringify({
          sectionId: section.id,
          type: section.section_type,
          content,
          truncated: nextOffset < section.content.length,
          nextOffset: nextOffset < section.content.length ? nextOffset : null,
        })
      )
    }

    case 'actions.handoff.write': {
      const actionId = num(args, 'actionId')
      const recipient = recipientRole(args['recipient'])
      const handoff = handoffFromArgs(args)
      const serialized = JSON.stringify({ version: 1, recipient, handoff })
      if (Buffer.byteLength(serialized, 'utf8') > 12_000)
        throw new Error('handoff must not exceed 12000 UTF-8 bytes')
      await db.writeSection(actionId, 'handoff', serialized)
      return ok(JSON.stringify({ recorded: true, recipient }))
    }

    case 'actions.handoff.get': {
      const taskId = num(args, 'taskId')
      const recipient = recipientRole(args['recipient'] ?? 'builder')
      for (const candidate of await db.getCompletedHandoffSections(taskId)) {
        const decoded = decodeHandoff(candidate.content)
        if (decoded?.recipient !== recipient) continue
        return ok(
          JSON.stringify({
            found: true,
            taskId,
            sourceActionId: candidate.action_id,
            sourceAgent: candidate.agent,
            recipient,
            createdAt: candidate.created_at,
            handoff: decoded.handoff,
          })
        )
      }
      return ok(JSON.stringify({ found: false, reason: 'HANDOFF_NOT_FOUND' }))
    }

    case 'tasks.get': {
      const status = args['status'] as string | undefined
      const includeArchived = args['includeArchived'] as boolean | undefined
      const tasks = status
        ? await db.getTasks(status as TaskStatus, includeArchived ?? false)
        : await db.getTasks(undefined, includeArchived ?? false)
      return ok(JSON.stringify(tasks))
    }

    case 'health.run': {
      const taskId = num(args, 'taskId')
      if (taskId < 1) throw new Error('taskId must be a positive integer')
      const result = await runTaskHealthCheck(db, cwd, config, taskId)
      const task = await db.resolveHealthMode(taskId, result, 'manual')
      return ok(
        JSON.stringify({ ...result, executionMode: task?.execution_mode ?? null }),
        result.state !== 'passed'
      )
    }

    case 'tasks.claim': {
      const id = num(args, 'id')
      const agent = str(args, 'agent')
      const task = await db.claimTask(id, agent)
      if (!task) {
        return ok(JSON.stringify({ error: 'task_already_claimed', taskId: id }))
      }
      const health = await runTaskHealthCheck(db, cwd, config, task.id)
      const resolved = await db.resolveHealthMode(task.id, health, 'claim')
      return ok(
        JSON.stringify({ task: resolved, health, executionMode: resolved?.execution_mode ?? null }),
        health.state !== 'passed'
      )
    }

    case 'tasks.add': {
      const title = str(args, 'title')
      const slug = (args['slug'] as string | undefined) ?? slugify(title)
      const description = args['description'] as string | undefined
      const acceptance = args['acceptance'] as string[] | undefined
      const task = await db.addTask({ slug, title, description, acceptance })
      return ok(JSON.stringify(task))
    }

    case 'tasks.update': {
      const id = num(args, 'id')
      const status = str(args, 'status') as TaskStatus
      if (status === 'done') {
        const reserved = await db.beginVerification(id)
        if (!reserved)
          return ok(JSON.stringify({ error: 'task_not_open_for_verification', taskId: id }), true)
        const health = await runTaskHealthCheck(db, cwd, config, id)
        const afterHealth = await db.resolveHealthMode(id, health, 'verify')
        const task = await db.finalizeVerifiedTask(id, health)
        if (!task) {
          return ok(
            JSON.stringify({
              error: 'final_health_failed',
              taskId: id,
              health,
              executionMode: afterHealth?.execution_mode ?? null,
            }),
            true
          )
        }
        return ok(JSON.stringify({ task, health }))
      }
      if (status === 'in_progress') {
        return ok(JSON.stringify({ error: 'claim_required', taskId: id }), true)
      }
      const task = await db.updateTaskStatus(id, status)
      return ok(JSON.stringify(task))
    }

    case 'tasks.repair.begin': {
      const taskId = num(args, 'taskId')
      const actor = str(args, 'actor').trim()
      const reason = str(args, 'reason').trim()
      const scope = str(args, 'scope').trim()
      if (
        !actor ||
        actor.length > 255 ||
        !reason ||
        reason.length > 2000 ||
        !scope ||
        scope.length > 2000
      )
        return ok(JSON.stringify({ error: 'invalid_repair_audit', taskId }), true)
      const repair = await db.beginRepair(taskId, actor, reason, scope)
      if (repair === 'duplicate')
        return ok(JSON.stringify({ error: 'repair_already_active', taskId }), true)
      if (!repair) return ok(JSON.stringify({ error: 'failed_health_required', taskId }), true)
      return ok(JSON.stringify(repair))
    }

    case 'docs.search': {
      const query = str(args, 'query')
      const results = searchDocs(docsPath, query)
      return ok(JSON.stringify(results))
    }

    case 'tasks.acceptance.update': {
      const criterionId = num(args, 'criterionId')
      await db.markAcceptanceMet(criterionId)
      return ok(JSON.stringify({ criterionId, met: true }))
    }

    case 'tasks.acceptance.get': {
      const taskId = num(args, 'taskId')
      const criteria = await db.getTaskAcceptance(taskId)
      return ok(JSON.stringify(criteria))
    }

    case 'tasks.edit': {
      const id = num(args, 'id')
      const title = args['title'] as string | undefined
      const description = args['description'] as string | null | undefined
      const acceptance = args['acceptance'] as string[] | null | undefined

      const task = await db.getTaskById(id)
      if (!task) return ok(JSON.stringify({ error: 'Task not found', taskId: id }), true)

      await db.updateTask(id, {
        title,
        description: description !== undefined ? description : undefined,
      })
      if (acceptance !== undefined && acceptance !== null) {
        await db.updateTaskAcceptance(id, acceptance)
      }
      const updated = await db.getTaskById(id)
      return ok(JSON.stringify(updated))
    }

    case 'tasks.archive': {
      const id = num(args, 'id')
      const task = await db.archiveTask(id)
      return ok(JSON.stringify(task))
    }

    case 'tasks.unarchive': {
      const id = num(args, 'id')
      const task = await db.unarchiveTask(id)
      return ok(JSON.stringify(task))
    }

    case 'permissions.check': {
      const result = checkPermissionsSync(cwd, config)
      return ok(JSON.stringify(result))
    }

    case 'deps.snapshot': {
      const pkgPath = join(cwd, 'package.json')
      if (!existsSync(pkgPath)) {
        return ok('package.json not found in project root', true)
      }
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
        dependencies?: Record<string, string>
        devDependencies?: Record<string, string>
      }
      const snapshot = {
        capturedAt: new Date().toISOString(),
        dependencies: pkg.dependencies ?? {},
        devDependencies: pkg.devDependencies ?? {},
      }
      const harnessDir = join(cwd, '.harness')
      mkdirSync(harnessDir, { recursive: true })
      writeFileSync(join(harnessDir, 'deps-lock.json'), JSON.stringify(snapshot, null, 2), 'utf8')
      return ok(
        JSON.stringify({
          message: 'Snapshot saved to .harness/deps-lock.json',
          capturedAt: snapshot.capturedAt,
        })
      )
    }

    case 'deps.check': {
      const pkgPath = join(cwd, 'package.json')
      const lockPath = join(cwd, '.harness', 'deps-lock.json')
      if (!existsSync(pkgPath)) {
        return ok('package.json not found in project root', true)
      }
      if (!existsSync(lockPath)) {
        return ok(
          JSON.stringify({
            status: 'no-snapshot',
            message: 'No deps-lock.json found. Run deps.snapshot first to establish a baseline.',
          })
        )
      }
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
        dependencies?: Record<string, string>
        devDependencies?: Record<string, string>
      }
      const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as {
        capturedAt: string
        dependencies: Record<string, string>
        devDependencies: Record<string, string>
      }
      const current = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }
      const previous = { ...(lock.dependencies ?? {}), ...(lock.devDependencies ?? {}) }

      const added: string[] = []
      const removed: string[] = []
      const majorBumps: Array<{ name: string; from: string; to: string }> = []

      for (const [name, version] of Object.entries(current)) {
        if (!(name in previous)) {
          added.push(`${name}@${version}`)
        } else {
          const prevMajor = parseInt(
            previous[name].replace(/^[\^~>=v]/, '').split('.')[0] ?? '0',
            10
          )
          const curMajor = parseInt(version.replace(/^[\^~>=v]/, '').split('.')[0] ?? '0', 10)
          if (!isNaN(prevMajor) && !isNaN(curMajor) && curMajor > prevMajor) {
            majorBumps.push({ name, from: previous[name], to: version })
          }
        }
      }
      for (const depName of Object.keys(previous)) {
        if (!(depName in current)) {
          removed.push(depName)
        }
      }

      const significant = added.length > 0 || removed.length > 0 || majorBumps.length > 0
      const pm = detectPackageManager(cwd)
      const runOnce = getRunOnceCommandParts(pm, 'autoskills').join(' ')
      const advisory = significant
        ? `Significant dependency changes detected. Consider running \`${runOnce}\` to refresh agent skills. Clearing stale skills before re-running is recommended.`
        : 'No significant dependency changes detected.'

      return ok(
        JSON.stringify({
          significant,
          added,
          removed,
          majorBumps,
          advisory,
          snapshotDate: lock.capturedAt,
        })
      )
    }

    case 'ahk.doctor': {
      const status = await getDoctorStatus(cwd)
      const result = {
        lib: {
          current: status.lib.current,
          latest: status.lib.latest,
          outdated: status.lib.outdated,
        },
        // Agents are existence-checked only — there is no `outdated` bucket.
        // Hand-edited agent definitions are supported and must not be flagged.
        agents: {
          missing: status.agents.filter((a) => a.status === 'missing').map((a) => a.name),
          ok: status.agents.filter((a) => a.status === 'ok').map((a) => a.name),
        },
        skills: {
          missing: status.skills.filter((s) => s.status === 'missing').map((s) => s.name),
          outdated: status.skills.filter((s) => s.status === 'outdated').map((s) => s.name),
          ok: status.skills.filter((s) => s.status === 'ok').map((s) => s.name),
        },
      }
      return ok(JSON.stringify(result))
    }

    default:
      return ok(`Unknown tool: ${name}`, true)
  }
}

// ─── docs.search implementation ───────────────────────────────────────────────

interface DocSnippet {
  file: string
  line: number
  text: string
}

function searchDocs(docsPath: string, query: string, maxResults = 10): DocSnippet[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  const results: DocSnippet[] = []

  try {
    const files = collectMarkdownFiles(docsPath)
    for (const file of files) {
      if (results.length >= maxResults) break
      try {
        const content = readFileSync(file, 'utf8')
        const lines = content.split('\n')
        for (let i = 0; i < lines.length; i++) {
          const lower = lines[i].toLowerCase()
          if (terms.every((t) => lower.includes(t))) {
            results.push({
              file: file.replace(docsPath + '/', ''),
              line: i + 1,
              text: lines[i].trim(),
            })
            if (results.length >= maxResults) break
          }
        }
      } catch {
        // skip unreadable files
      }
    }
  } catch {
    return [{ file: '', line: 0, text: `docs path not found: ${docsPath}` }]
  }

  return results
}

function collectMarkdownFiles(dir: string): string[] {
  const files: string[] = []
  try {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      const stat = statSync(full)
      if (stat.isDirectory()) {
        files.push(...collectMarkdownFiles(full))
      } else if (entry.endsWith('.md') || entry.endsWith('.txt')) {
        files.push(full)
      }
    }
  } catch {
    // directory may not exist yet
  }
  return files
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const NOTICE_TOOLS = new Set([
  'tasks.claim',
  'health.run',
  'tasks.update',
  'actions.start',
  'actions.complete',
  'ahk.doctor',
])

/** Adds a second, versioned text block while preserving primary content and isError exactly. */
export async function attachOperationalNotices(
  name: string,
  args: Record<string, unknown>,
  cwd: string,
  provider: HarnessConfig['provider'],
  result: CallToolResult,
  session: ReturnType<typeof createNoticeSession>,
  doctor = false
): Promise<CallToolResult> {
  const isDoctor = doctor || name === 'ahk.doctor'
  if (!NOTICE_TOOLS.has(name) || (name === 'tasks.update' && args.status !== 'done')) return result
  try {
    const collected = await collectOperationalNotices(cwd, provider, {
      doctor: isDoctor,
      waitForUpdate: isDoctor,
    })
    const notices = noticesForDelivery(session, cwd, provider, collected, isDoctor)
    if (!notices.length) return result
    return {
      ...result,
      content: [
        ...result.content,
        { type: 'text', text: JSON.stringify({ noticeSchemaVersion: 1, notices }) },
      ],
    }
  } catch {
    return result
  }
}

function ok(text: string, isError = false): CallToolResult {
  return { content: [{ type: 'text' as const, text }], isError }
}

const RECIPIENTS = ['lead', 'explorer', 'consultant', 'builder', 'reviewer'] as const
type HandoffRecipient = (typeof RECIPIENTS)[number]
interface Handoff {
  goal: string
  completed: string[]
  decisions: string[]
  files: string[]
  verification: string[]
  blockers: string[]
  nextStep: string
}
function recipientRole(value: unknown): HandoffRecipient {
  if (typeof value !== 'string' || !RECIPIENTS.includes(value as HandoffRecipient))
    throw new Error(`recipient must be one of: ${RECIPIENTS.join(', ')}`)
  return value as HandoffRecipient
}
function handoffFromArgs(args: Record<string, unknown>): Handoff {
  const goal = str(args, 'goal')
  const nextStep = str(args, 'nextStep')
  if (!goal.trim() || !nextStep.trim())
    throw new Error('goal and nextStep must be non-empty strings')
  return {
    goal,
    completed: requiredStringArray(args, 'completed'),
    decisions: requiredStringArray(args, 'decisions'),
    files: requiredStringArray(args, 'files'),
    verification: requiredStringArray(args, 'verification'),
    blockers: requiredStringArray(args, 'blockers'),
    nextStep,
  }
}
function decodeHandoff(content: string): { recipient: HandoffRecipient; handoff: Handoff } | null {
  try {
    const value = JSON.parse(content) as {
      version?: unknown
      recipient?: unknown
      handoff?: Record<string, unknown>
    }
    if (value.version !== 1 || !value.handoff) return null
    return { recipient: recipientRole(value.recipient), handoff: handoffFromArgs(value.handoff) }
  } catch {
    return null
  }
}
function optionalAgent(args: Record<string, unknown>, key: string): AgentName | undefined {
  const value = optionalStr(args, key)
  if (value === undefined) return undefined
  if (
    !['lead', 'explorer', 'consultant', 'builder', 'reviewer'].includes(value) &&
    !value.startsWith('custom:')
  )
    throw new Error('agent must be a known role or custom:<name>')
  return value as AgentName
}
function optionalActionStatus(
  args: Record<string, unknown>,
  key: string
): ActionStatus | undefined {
  const value = optionalStr(args, key)
  if (value === undefined) return undefined
  if (!['in_progress', 'completed', 'blocked'].includes(value))
    throw new Error('status must be in_progress, completed, or blocked')
  return value as ActionStatus
}
function encodeActionCursor(createdAt: string, id: number): string {
  return Buffer.from(JSON.stringify({ createdAt, id })).toString('base64url')
}
function decodeActionCursor(
  cursor: string | undefined
): { createdAt: string; id: number } | undefined {
  if (!cursor) return undefined
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      createdAt?: unknown
      id?: unknown
    }
    if (
      typeof value.createdAt !== 'string' ||
      typeof value.id !== 'number' ||
      !Number.isInteger(value.id)
    )
      throw new Error()
    return { createdAt: value.createdAt, id: value.id }
  } catch {
    throw new Error('cursor is invalid')
  }
}
function encodeSectionCursor(id: number): string {
  return Buffer.from(String(id)).toString('base64url')
}
function decodeSectionCursor(cursor: string | undefined): number | undefined {
  if (!cursor) return undefined
  const id = Number(Buffer.from(cursor, 'base64url').toString('utf8'))
  if (!Number.isInteger(id) || id < 1) throw new Error('cursor is invalid')
  return id
}
function preview(summary: string | null): string | null {
  return summary ? summary.slice(0, 240) : null
}
function sectionIndex(section: {
  id: number
  section_type: string
  chars: number
  created_at: string
}) {
  return {
    id: section.id,
    type: section.section_type,
    chars: Number(section.chars),
    createdAt: section.created_at,
  }
}
