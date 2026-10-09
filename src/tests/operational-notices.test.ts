import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, test } from 'node:test'

import { openDB } from '@/core/db'
import { attachOperationalNotices, dispatch } from '@/core/mcp-server'
import { collectOperationalNotices, createNoticeSession, noticesForDelivery } from '@/core/operational-notices'
import { __configureUpdateCheckForTests } from '@/core/update-check'

import type { HarnessConfig } from '@/types'

const TMP = join(import.meta.dirname, '../../.tmp-operational-notices')

afterEach(() => { rmSync(TMP, { recursive: true, force: true }) })
beforeEach(() => {
  __configureUpdateCheckForTests({
    fetch: async () => new Response(JSON.stringify({ version: '2.31.0' }), { status: 200 }),
  })
})

describe('operational notices', () => {
  test('unknown legacy-looking skills without state are not falsely reported pending', () => {
    mkdirSync(join(TMP, '.opencode/skills/ahk-use-cases'), { recursive: true })
    const notices = collectOperationalNotices(TMP, 'opencode') as { code: string; command?: string }[]
    assert.equal(notices.length, 0)
  })

  test('an active root is inspected even when migration state belongs to another provider', () => {
    const outside = join(TMP, 'outside-skills')
    mkdirSync(outside, { recursive: true })
    mkdirSync(join(TMP, '.opencode'), { recursive: true })
    symlinkSync(outside, join(TMP, '.opencode/skills'))
    mkdirSync(join(TMP, '.harness'), { recursive: true })
    writeFileSync(
      join(TMP, '.harness/skills-state.json'),
      JSON.stringify({ roots: { _agents_skills: { version: '2.31.0', applied: [], inventory: {}, pendingPreservation: [] } } })
    )
    assert.equal(
      (collectOperationalNotices(TMP, 'opencode') as { code: string }[]).at(0)?.code,
      'skills-migration-state-invalid'
    )
  })

  test('interrupted and custom migration state is surfaced without changing it', () => {
    mkdirSync(join(TMP, '.harness'), { recursive: true })
    const path = join(TMP, '.harness/skills-state.json')
    const state = { roots: { _agents_skills: { version: '2.30.0', migrationVersion: '2.31.0', applied: [], inventory: {}, pendingInventory: { 'ahk-spec/SKILL.md': 'x' }, pendingPreservation: ['.agents/skills/old/SKILL.md'] } } }
    writeFileSync(path, JSON.stringify(state))
    const before = JSON.stringify(state)
    const notices = collectOperationalNotices(TMP, 'codex-cli') as { code: string }[]
    assert.ok(notices.some((notice) => notice.code === 'skills-migration-interrupted'))
    assert.ok(notices.some((notice) => notice.code === 'skills-customized-preserved'))
    assert.equal(readFileSync(path, 'utf8'), before)
  })

  test('a newer skill state asks for a CLI update instead of a rebuild', () => {
    mkdirSync(join(TMP, '.harness'), { recursive: true })
    writeFileSync(join(TMP, '.harness/skills-state.json'), JSON.stringify({ roots: { _agents_skills: { version: '99.0.0', applied: [], inventory: {}, pendingPreservation: [] } } }))
    const notices = collectOperationalNotices(TMP, 'codex-cli') as { code: string; command?: string }[]
    const notice = notices.find((item) => item.code === 'skills-state-newer-than-cli')
    assert.equal(notice?.command, 'ahk --version')
  })

  test('persisted state follows SemVer prerelease precedence', () => {
    mkdirSync(join(TMP, '.harness'), { recursive: true })
    const statePath = join(TMP, '.harness/skills-state.json')
    const root = { applied: [], inventory: {}, pendingPreservation: [] }
    writeFileSync(statePath, JSON.stringify({ roots: { _agents_skills: { ...root, version: '2.31.0-beta.1' } } }))
    assert.equal(
      (collectOperationalNotices(TMP, 'codex-cli') as { code: string }[]).at(0)?.code,
      'skills-migration-pending'
    )
    writeFileSync(statePath, JSON.stringify({ roots: { _agents_skills: { ...root, version: '2.31.1-beta.1' } } }))
    assert.equal(
      (collectOperationalNotices(TMP, 'codex-cli') as { code: string }[]).at(0)?.code,
      'skills-state-newer-than-cli'
    )
    writeFileSync(statePath, JSON.stringify({ roots: { _agents_skills: { ...root, version: '2.31.0+local' } } }))
    assert.deepEqual(collectOperationalNotices(TMP, 'codex-cli'), [])
  })

  test('malformed root state is reported safely', () => {
    mkdirSync(join(TMP, '.harness'), { recursive: true })
    writeFileSync(join(TMP, '.harness/skills-state.json'), JSON.stringify({ roots: { _agents_skills: { version: 42 } } }))
    const notices = collectOperationalNotices(TMP, 'codex-cli') as { code: string; command?: string }[]
    assert.deepEqual(notices.map((notice) => notice.code), ['skills-migration-state-invalid'])
    assert.equal(notices[0]?.command, 'ahk doctor')
  })

  test('invalid persisted SemVer values are rejected consistently', () => {
    mkdirSync(join(TMP, '.harness'), { recursive: true })
    writeFileSync(
      join(TMP, '.harness/skills-state.json'),
      JSON.stringify({ roots: { _agents_skills: { version: '1.0.0-01', applied: [], inventory: {}, pendingPreservation: [] } } })
    )
    assert.deepEqual(
      (collectOperationalNotices(TMP, 'codex-cli') as { code: string }[]).map((notice) => notice.code),
      ['skills-migration-state-invalid']
    )
  })

  test('deduplication suppresses only an unchanged lifecycle fingerprint', () => {
    const notices = [{ code: 'test', severity: 'info' as const, scope: 'skills' as const, message: 'test' }]
    const one = createNoticeSession(), two = createNoticeSession()
    assert.equal(noticesForDelivery(one, TMP, 'codex-cli', notices).length, 1)
    assert.equal(noticesForDelivery(one, TMP, 'codex-cli', notices).length, 0)
    assert.equal(noticesForDelivery(two, TMP, 'codex-cli', notices).length, 1)
    assert.equal(noticesForDelivery(one, TMP, 'codex-cli', [{ ...notices[0], command: 'ahk build' }]).length, 1)
    const warning = [{ ...notices[0], severity: 'warning' as const }]
    assert.equal(noticesForDelivery(one, TMP, 'codex-cli', warning).length, 1)
    assert.equal(noticesForDelivery(one, TMP, 'codex-cli', warning).length, 1)
  })

  test('MCP attachment preserves primary text and error state', async () => {
    mkdirSync(join(TMP, '.harness'), { recursive: true })
    writeFileSync(join(TMP, '.harness/skills-state.json'), '{ invalid')
    const primary = { content: [{ type: 'text' as const, text: '{"error":"original"}' }], isError: true }
    const result = await attachOperationalNotices('tasks.claim', {}, TMP, 'opencode', primary, createNoticeSession())
    assert.equal(result.isError, true)
    assert.equal(result.content[0]?.type, 'text')
    assert.equal(
      result.content[0]?.type === 'text' ? result.content[0].text : undefined,
      primary.content[0].text
    )
    assert.equal(result.content.length, 2)
    assert.equal(result.content[1]?.type, 'text')
    assert.match(
      result.content[1]?.type === 'text' ? result.content[1].text : '',
      /noticeSchemaVersion/
    )
  })

  test('non-done task updates never receive a lifecycle notice', async () => {
    const primary = { content: [{ type: 'text' as const, text: '{"error":"original"}' }], isError: true }
    const result = await attachOperationalNotices('tasks.update', { status: 'pending' }, TMP, 'opencode', primary, createNoticeSession())
    assert.deepEqual(result, primary)
  })

  test('collector failures preserve primary content and error state', async () => {
    const outside = join(TMP, 'outside-skills')
    mkdirSync(outside, { recursive: true })
    mkdirSync(join(TMP, '.agents'), { recursive: true })
    rmSync(join(TMP, '.agents'), { recursive: true, force: true })
    symlinkSync(outside, join(TMP, '.agents'))
    const primary = { content: [{ type: 'text' as const, text: '{"error":"original"}' }], isError: true }
    const result = await attachOperationalNotices('tasks.claim', {}, TMP, 'codex-cli', primary, createNoticeSession())
    assert.deepEqual(result, primary)
  })

  test('attaches notices across the full MCP lifecycle without changing each primary result', async () => {
    const config: HarnessConfig = {
      project: { name: 'test', description: 'test', docsPath: './docs' },
      provider: 'opencode',
      database: { type: 'sqlite' },
      storage: {
        dir: '.harness',
        sections: { toolsUsed: true, filesModified: true, result: true, blockers: true, nextSteps: false },
        scope: 'local',
        projectId: 'operational-notices',
        sqlitePath: join(TMP, 'harness.db'),
      },
      health: { scriptPath: './health.sh', required: false },
      tools: { mcp: { enabled: false, port: 3456 }, scripts: { enabled: false, outputDir: '.harness/scripts' } },
    }
    mkdirSync(join(TMP, '.harness'), { recursive: true })
    writeFileSync(join(TMP, '.harness/skills-state.json'), '{ invalid')
    writeFileSync(join(TMP, 'health.sh'), '#!/usr/bin/env bash\nexit 0\n')
    const db = await openDB(config, TMP)
    try {
      const taskId = (await db.addTask({ slug: 'lifecycle', title: 'Lifecycle' })).id
      const invoke = async (name: string, args: Record<string, unknown>) => {
        const primary = await dispatch(name, args, db, TMP, TMP, config)
        const attached = await attachOperationalNotices(name, args, TMP, config.provider, primary, createNoticeSession())
        assert.equal(attached.isError, primary.isError, `${name} preserves isError`)
        assert.deepEqual(attached.content[0], primary.content[0], `${name} preserves primary content`)
        assert.equal(attached.content.length, 2, `${name} receives a lifecycle notice`)
        return primary
      }

      await invoke('health.run', { taskId })
      await invoke('tasks.claim', { id: taskId, agent: 'lead' })
      const action = await invoke('actions.start', { taskId, agent: 'builder' })
      const actionId = JSON.parse((action.content[0] as { text: string }).text).actionId as number
      await invoke('actions.complete', { actionId, summary: 'Done' })
      await invoke('tasks.update', { id: taskId, status: 'done' })
      await invoke('ahk.doctor', {})
    } finally {
      await db.close()
    }
  })

  test('a dispatch throw is converted to an error primary that keeps its content when notices attach', async () => {
    const config = {
      project: { name: 'test', description: 'test', docsPath: './docs' }, provider: 'opencode',
      database: { type: 'sqlite' },
      storage: { dir: '.harness', sections: {}, scope: 'local', projectId: 'dispatch-throw', sqlitePath: join(TMP, 'harness.db') },
      health: { scriptPath: './health.sh', required: false },
      tools: { mcp: { enabled: false, port: 3456 }, scripts: { enabled: false, outputDir: '.harness/scripts' } },
    } as HarnessConfig
    mkdirSync(join(TMP, '.harness'), { recursive: true })
    writeFileSync(join(TMP, '.harness/skills-state.json'), '{ invalid')
    const db = await openDB(config, TMP)
    try {
      let error: Error | undefined
      try {
        await dispatch('tasks.claim', {}, db, TMP, TMP, config)
      } catch (caught) {
        error = caught as Error
      }
      if (!error) throw new Error('expected dispatch to throw')
      assert.match(error.message, /id must be a number/)
      const primary = { content: [{ type: 'text' as const, text: `Error: ${error.message}` }], isError: true }
      const attached = await attachOperationalNotices('tasks.claim', {}, TMP, config.provider, primary, createNoticeSession())
      assert.equal(attached.isError, true)
      assert.deepEqual(attached.content[0], primary.content[0])
      assert.equal(attached.content.length, 2)
    } finally {
      await db.close()
    }
  })
})
