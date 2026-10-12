import assert from 'node:assert/strict'
import { test } from 'node:test'

import { readNotificationMarkers } from '../core/notifications/marker'
import { normalizeProviderHook, OpenCodeTurnTracker } from '../core/notifications/providers'

test('Cursor parses only full JSON and joins actual conversation/generation; failed stops are ignored', () => {
  const marker = { notificationSchemaVersion: 1, events: [] }
  const payload = {
    conversation_id: 'c',
    generation_id: 'g',
    result_json: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(marker) }] }),
  }
  assert.equal(normalizeProviderHook('cursor', 'afterMCPExecution', payload)[0]?.type, 'bind')
  assert.deepEqual(
    normalizeProviderHook('cursor', 'afterMCPExecution', {
      ...payload,
      result_json: `prose ${payload.result_json}`,
    }),
    []
  )
  assert.deepEqual(
    normalizeProviderHook('cursor', 'afterMCPExecution', { ...payload, generation_id: undefined }),
    []
  )
  assert.deepEqual(normalizeProviderHook('cursor', 'stop', { ...payload, status: 'error' }), [])
  assert.equal(
    normalizeProviderHook('cursor', 'stop', { ...payload, status: 'completed' })[0]?.type,
    'complete'
  )
})

test('Claude and Codex never infer turn IDs; actionable attention remains independent', () => {
  for (const provider of ['claude-code', 'codex-cli'] as const) {
    assert.deepEqual(
      normalizeProviderHook(provider, 'PostToolUse', {
        session_id: 's',
        tool_name: 'mcp__ahk__tasks_update',
        tool_response: {},
      }),
      []
    )
    const complete = normalizeProviderHook(provider, 'Stop', { session_id: 's' })[0]
    assert.equal(complete.type, 'complete')
    assert.equal('turn' in complete ? complete.turn : 'bad', undefined)
    assert.deepEqual(
      normalizeProviderHook(provider, 'Stop', { session_id: 's', agent_id: 'sub' }),
      []
    )
  }
  assert.deepEqual(
    normalizeProviderHook('claude-code', 'Notification', { notification_type: 'auth_success' }),
    []
  )
  assert.equal(
    normalizeProviderHook('claude-code', 'Notification', {
      notification_type: 'permission_prompt',
    })[0]?.type,
    'attention'
  )
  assert.equal(
    normalizeProviderHook('codex-cli', 'PermissionRequest', { request_id: 'r' })[0]?.type,
    'attention'
  )
  for (const provider of ['claude-code', 'codex-cli', 'opencode'] as const) {
    const event =
      provider === 'claude-code'
        ? 'Notification'
        : provider === 'codex-cli'
          ? 'PermissionRequest'
          : 'attention'
    const payload = {
      session_id: 's',
      prompt_id: 'p',
      turn_id: 't',
      notification_type: 'permission_prompt',
    }
    const first = normalizeProviderHook(provider, event, payload)[0]
    const second = normalizeProviderHook(provider, event, payload)[0]
    assert.equal(first.type, 'attention')
    assert.equal(second.type, 'attention')
    if (first.type === 'attention' && second.type === 'attention')
      assert.notEqual(first.requestId, second.requestId)
  }
})

test('OpenCode observed idle transition establishes stable generation, consumed on idle; restart isolates it', () => {
  const tracker = new OpenCodeTurnTracker('epoch-a')
  tracker.observeSession({id:'s',projectID:'p',directory:'/project',title:'Session',version:'1',slug:'s',time:{created:1,updated:1}})
  const run = (event: string, props: Record<string, unknown> = {}) =>
    tracker.process(event, { sessionID: 's', ...props })
  run('session.status', { status: { type: 'busy' } })
  assert.deepEqual(
    run('tool.execute.after', {
      output: { output: '{"notificationSchemaVersion":1,"events":[]}' },
    }),
    []
  )
  assert.equal(run('session.status', { status: { type: 'idle' } })[0]?.type, 'complete')
  run('session.status', { status: { type: 'busy' } })
  const first = run('tool.execute.after', {
    output: { output: '{"notificationSchemaVersion":1,"events":[]}' },
  })[0]
  assert.equal(first.type, 'bind')
  run('session.status', { status: { type: 'retry' } })
  const second = run('tool.execute.after', {
    output: { metadata: { notificationSchemaVersion: 1, events: [] } },
  })[0]
  assert.equal(first.turn, second.turn)
  assert.equal(run('permission.asked', { id: 'request' })[0]?.type, 'attention')
  assert.equal(run('session.status', { status: { type: 'idle' } })[0]?.turn, first.turn)
  assert.deepEqual(run('session.status', { status: { type: 'idle' } }), [])
  const restarted = new OpenCodeTurnTracker('epoch-b')
  restarted.process('session.status', { sessionID: 's', status: 'idle' })
  restarted.process('session.status', { sessionID: 's', status: 'busy' })
  const fresh = restarted.process('tool.execute.after', {
    sessionID: 's',
    output: { output: '{"notificationSchemaVersion":1,"events":[]}' },
  })[0]
  assert.notEqual(fresh.turn, first.turn)
  run('session.status', { status: 'busy' })
  run('session.error')
  assert.deepEqual(run('session.status', { status: 'idle' }), [])
})

test('OpenCode direct metadata and full JSON transport preserve exact marker boundaries', () => {
  const tracker = new OpenCodeTurnTracker('transport')
  tracker.process('session.status', { sessionID: 's', status: 'idle' })
  tracker.process('session.status', { sessionID: 's', status: 'busy' })
  const event = {
    eventId: 'e4932efa-ab95-4d6c-90c3-0052c153a014',
    kind: 'task.completed',
    projectKey: 'a'.repeat(64),
    delivery: 'played',
  }
  const marker = { notificationSchemaVersion: 1, events: [event] }
  for (const output of [
    { metadata: marker },
    { metadata: { content: [{ type: 'text', text: JSON.stringify(marker) }] } },
    { output: JSON.stringify(marker) },
  ]) {
    const action = tracker.process('tool.execute.after', { sessionID: 's', output })[0]
    assert.equal(action.type, 'bind')
    if (action.type === 'bind') assert.deepEqual(readNotificationMarkers(action.response), [event])
  }
  assert.deepEqual(
    tracker.process('tool.execute.after', {
      sessionID: 's',
      output: { output: `Narrative ${JSON.stringify(marker)}` },
    }),
    []
  )
})

test('Secondary agent MCP binds use only reported true IDs; completion filtering does not drop attention', () => {
  for (const provider of ['claude-code', 'codex-cli'] as const) {
    const payload = {
      session_id: 's',
      prompt_id: 'subturn',
      turn_id: 'subturn',
      agent_id: 'sub',
      tool_name: 'mcp__ahk__tasks_update',
      tool_response: { content: [] },
    }
    const bind = normalizeProviderHook(provider, 'PostToolUse', payload)[0]
    assert.equal(bind.type, 'bind')
    assert.equal(bind.turn, 'subturn')
    const main = normalizeProviderHook(provider, 'Stop', {
      session_id: 's',
      prompt_id: 'mainturn',
      turn_id: 'mainturn',
    })[0]
    assert.equal(main.type, 'complete')
    assert.notEqual(main.turn, bind.turn)
    assert.deepEqual(
      normalizeProviderHook(provider, 'PostToolUse', {
        ...payload,
        prompt_id: undefined,
        turn_id: undefined,
      }),
      []
    )
    assert.deepEqual(normalizeProviderHook(provider, 'Stop', payload), [])
    const attention = normalizeProviderHook(
      provider,
      provider === 'claude-code' ? 'Notification' : 'PermissionRequest',
      { ...payload, notification_type: 'permission_prompt' }
    )[0]
    assert.equal(attention.type, 'attention')
  }
})
