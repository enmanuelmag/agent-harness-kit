import assert from 'node:assert/strict'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, test } from 'node:test'

import { type HarnessDB, openDB } from '@/core/db'
import { dispatch } from '@/core/mcp-server'

import type { HarnessConfig } from '@/types'

const TMP = join(import.meta.dirname, '../../.tmp-mcp-action-reads')
const config: HarnessConfig = {
  project: { name: 'test', description: 'test', docsPath: './docs' },
  provider: 'claude-code',
  database: { type: 'sqlite' },
  storage: {
    dir: '.harness',
    tasks: { adapter: 'local' },
    sections: {
      toolsUsed: true,
      filesModified: true,
      result: true,
      blockers: true,
      nextSteps: false,
    },
    markdownFallback: { enabled: false, path: join(TMP, 'current.md') },
    scope: 'local',
    projectId: 'mcp-reads-test',
    sqlitePath: join(TMP, 'harness.db'),
  },
  health: { scriptPath: './health.sh', required: false },
  tools: {
    mcp: { enabled: false, port: 3456 },
    scripts: { enabled: false, outputDir: '.harness/scripts' },
  },
}

function text(result: Awaited<ReturnType<typeof dispatch>>) {
  const item = result.content[0]
  assert.equal(item.type, 'text')
  return JSON.parse(item.text) as Record<string, unknown>
}

describe('compact action MCP reads', () => {
  let db: HarnessDB
  let taskId: number
  let leadId: number
  let builderId: number

  beforeEach(async () => {
    mkdirSync(TMP, { recursive: true })
    db = await openDB(config, TMP)
    const task = await db.addTask({ slug: 'compact-reads', title: 'Compact reads' })
    taskId = task.id
    const lead = await db.startAction(taskId, 'lead')
    leadId = lead.id
    await db.writeSection(leadId, 'result', 'A long plan that must not appear in compact indexes.')
    await db.writeSection(leadId, 'decisions', 'Use cursors.')
    await db.completeAction(leadId, 'Plan complete')
    const consultant = await db.startAction(taskId, 'consultant')
    await db.completeAction(consultant.id, 'Consultant role is accepted')
    const builder = await db.startAction(taskId, 'builder')
    builderId = builder.id
    await db.writeSection(builderId, 'result', 'Builder result')
  })

  afterEach(async () => {
    await db.close()
    rmSync(TMP, { recursive: true, force: true })
  })

  test('actions.list is paginated metadata while actions.get stays full history', async () => {
    const page = text(await dispatch('actions.list', { taskId, limit: 1 }, db, TMP, TMP, config))
    const items = page.items as Array<Record<string, unknown>>
    assert.equal(items.length, 1)
    assert.equal(items[0].agent, 'builder')
    assert.equal(items[0].sectionCount, 1)
    assert.equal('sections' in items[0], false)
    assert.ok(typeof page.nextCursor === 'string')

    const filtered = text(
      await dispatch('actions.list', { taskId, agent: 'lead' }, db, TMP, TMP, config)
    )
    assert.equal((filtered.items as Array<Record<string, unknown>>)[0].id, leadId)

    const legacy = text(
      await dispatch('actions.get', { taskId }, db, TMP, TMP, config)
    ) as unknown as Array<Record<string, unknown>>
    assert.equal(legacy.length, 3)
    assert.equal(
      (legacy[0].sections as Array<Record<string, unknown>>)[0].content,
      'A long plan that must not appear in compact indexes.'
    )
  })

  test('action and section indexes omit contents, while ranged section reads report what remains', async () => {
    const action = text(
      await dispatch('actions.get_by_id', { actionId: leadId }, db, TMP, TMP, config)
    )
    const sections = action.sections as Array<Record<string, unknown>>
    assert.equal(sections.length, 2)
    assert.equal('content' in sections[0], false)

    const listed = text(
      await dispatch(
        'actions.sections.list',
        { actionId: leadId, types: ['result'] },
        db,
        TMP,
        TMP,
        config
      )
    )
    const section = (listed.items as Array<Record<string, unknown>>)[0]
    assert.equal(section.type, 'result')
    const content = text(
      await dispatch(
        'actions.sections.get',
        { sectionId: section.id, length: 6 },
        db,
        TMP,
        TMP,
        config
      )
    )
    assert.equal(content.content, 'A long')
    assert.equal(content.truncated, true)
    assert.equal(content.nextOffset, 6)
  })

  test('handoffs are structured, bounded, recipient-directed, and never fall back to history', async () => {
    const missing = text(
      await dispatch('actions.handoff.get', { taskId, recipient: 'builder' }, db, TMP, TMP, config)
    )
    assert.deepEqual(missing, { found: false, reason: 'HANDOFF_NOT_FOUND' })

    await dispatch(
      'actions.handoff.write',
      {
        actionId: leadId,
        recipient: 'builder',
        goal: 'Implement compact reads',
        completed: ['Mapped data layer'],
        decisions: ['Preserve actions.get'],
        files: ['src/core/mcp-server.ts'],
        verification: ['pnpm test'],
        blockers: [],
        nextStep: 'Implement tests',
      },
      db,
      TMP,
      TMP,
      config
    )
    const handoff = text(await dispatch('actions.handoff.get', { taskId }, db, TMP, TMP, config))
    assert.equal(handoff.found, true)
    assert.equal(handoff.sourceActionId, leadId)
    assert.equal(handoff.sourceAgent, 'lead')
    assert.equal((handoff.handoff as Record<string, unknown>).nextStep, 'Implement tests')

    await assert.rejects(
      () =>
        dispatch(
          'actions.write',
          { actionId: builderId, sectionType: 'handoff', content: 'free text' },
          db,
          TMP,
          TMP,
          config
        ),
      /actions\.handoff\.write/
    )
    await assert.rejects(
      () =>
        dispatch(
          'actions.handoff.write',
          {
            actionId: leadId,
            recipient: 'builder',
            goal: 'x'.repeat(12_001),
            completed: [],
            decisions: [],
            files: [],
            verification: [],
            blockers: [],
            nextStep: 'next',
          },
          db,
          TMP,
          TMP,
          config
        ),
      /12000 UTF-8 bytes/
    )
  })
})
