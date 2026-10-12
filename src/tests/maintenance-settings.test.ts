import assert from 'node:assert/strict'
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { loadConfig } from '../core/config'
import {
  configureNotifications,
  loadManagedConfig,
  MANAGED_CONFIG_NAME,
  notificationConfigurationStatus,
  updateManagedConfig,
} from '../core/maintenance/config'
import { NotificationService } from '../core/notifications/runtime'

function fixture() {
  const cwd = mkdtempSync(join(realpathSync(tmpdir()), 'ahk-settings-'))
  const globalPath = join(cwd, 'global.json')
  return { cwd, globalPath, close: () => rmSync(cwd, { recursive: true, force: true }) }
}
test('managed overlay preserves base bytes and replaces role objects while merging providers', async () => {
  const f = fixture()
  try {
    const path = join(f.cwd, 'agent-harness-kit.config.json')
    const raw = JSON.stringify({
      provider: 'cursor',
      project: { name: 'fixture' },
      storage: { projectId: 'fixed' },
      agentPreferences: {
        cursor: { lead: { model: 'a', reasoningEffort: 'high' }, builder: { model: 'b' } },
      },
    })
    writeFileSync(path, raw)
    assert.equal(
      (
        await updateManagedConfig(f.cwd, {
          agentPreferences: { cursor: { lead: { model: 'inherit' } } },
        })
      ).ok,
      true
    )
    const config = await loadConfig(f.cwd)
    assert.deepEqual(config.agentPreferences?.cursor?.lead, { model: 'inherit' })
    assert.deepEqual(config.agentPreferences?.cursor?.builder, { model: 'b' })
    assert.equal(readFileSync(path, 'utf8'), raw)
  } finally {
    f.close()
  }
})
test('global merge preserves unrelated data and private mode; project override and unset restore source', async () => {
  const f = fixture()
  try {
    writeFileSync(f.globalPath, JSON.stringify({ extension: { retained: true }, enabled: false }), {
      mode: 0o640,
    })
    assert.equal(
      (
        await configureNotifications(
          f.cwd,
          { scope: 'global', patch: { enabled: true, categories: { 'health.blocked': false } } },
          { globalPath: f.globalPath }
        )
      ).ok,
      true
    )
    assert.deepEqual(JSON.parse(readFileSync(f.globalPath, 'utf8')).extension, { retained: true })
    assert.equal(statSync(f.globalPath).mode & 0o777, 0o640)
    const project = await configureNotifications(
      f.cwd,
      { scope: 'project', patch: { enabled: false } },
      { globalPath: f.globalPath }
    )
    assert.equal(project.data?.source, 'project-overlay')
    assert.equal(project.data?.globalEnabledOverridden, true)
    const unset = await configureNotifications(
      f.cwd,
      { scope: 'project', unset: ['enabled'] },
      { globalPath: f.globalPath }
    )
    assert.equal(unset.data?.source, 'global')
    assert.equal((unset.data?.effective as { enabled: boolean }).enabled, true)
  } finally {
    f.close()
  }
})
test('malformed JSON, symlinks, concurrent locks and invalid booleans never overwrite settings', async () => {
  const f = fixture()
  try {
    writeFileSync(f.globalPath, '{bad')
    const request = { scope: 'global' as const, patch: { enabled: true } }
    assert.equal(
      (await configureNotifications(f.cwd, request, { globalPath: f.globalPath })).ok,
      false
    )
    assert.equal(readFileSync(f.globalPath, 'utf8'), '{bad')
    rmSync(f.globalPath)
    const target = join(f.cwd, 'target')
    writeFileSync(target, '{}')
    symlinkSync(target, f.globalPath)
    assert.equal(
      (await configureNotifications(f.cwd, request, { globalPath: f.globalPath })).code,
      'unsafe_path'
    )
    assert.equal(readFileSync(target, 'utf8'), '{}')
    rmSync(f.globalPath)
    writeFileSync(`${f.globalPath}.lock`, 'held')
    assert.equal(
      (await configureNotifications(f.cwd, request, { globalPath: f.globalPath })).code,
      'concurrent_edit'
    )
    rmSync(`${f.globalPath}.lock`)
    assert.equal(
      (
        await configureNotifications(
          f.cwd,
          { scope: 'global', patch: { enabled: 'false' } },
          { globalPath: f.globalPath }
        )
      ).code,
      'invalid_settings'
    )
    assert.equal(
      (
        await configureNotifications(
          f.cwd,
          { scope: 'project', patch: { maxRecords: 20 } },
          { globalPath: f.globalPath }
        )
      ).code,
      'global_setting'
    )
  } finally {
    f.close()
  }
})
test('already-created notification service reflects project enable/disable and unset without spawning', async () => {
  const f = fixture()
  try {
    writeFileSync(
      join(f.cwd, 'agent-harness-kit.config.json'),
      JSON.stringify({
        project: { name: 'fixture' },
        storage: { projectId: 'fixed' },
        notifications: { enabled: false },
      })
    )
    const config = await loadConfig(f.cwd)
    const service = new NotificationService(config, f.cwd, {
      homeDir: f.cwd,
      dispatch: () => assert.fail('no audio expected'),
    })
    assert.equal(service.settings.enabled, false)
    await configureNotifications(
      f.cwd,
      { scope: 'project', patch: { enabled: true } },
      { globalPath: f.globalPath }
    )
    assert.equal(service.settings.enabled, true)
    await configureNotifications(
      f.cwd,
      { scope: 'project', patch: { enabled: false } },
      { globalPath: f.globalPath }
    )
    assert.equal(service.settings.enabled, false)
    await configureNotifications(
      f.cwd,
      { scope: 'project', unset: ['enabled'] },
      { globalPath: f.globalPath }
    )
    assert.equal(service.settings.enabled, false)
    assert.equal(loadManagedConfig(f.cwd).ok, true)
  } finally {
    f.close()
  }
})
test('status reports malformed global config and oversized overlay without writes', async () => {
  const f = fixture()
  try {
    writeFileSync(f.globalPath, '[bad')
    assert.equal(
      (await notificationConfigurationStatus(f.cwd, { globalPath: f.globalPath })).code,
      'invalid_settings'
    )
    writeFileSync(join(f.cwd, MANAGED_CONFIG_NAME), ' '.repeat(16385))
    assert.equal(loadManagedConfig(f.cwd).ok, false)
  } finally {
    f.close()
  }
})

test('actual CLI project enable, configure and disable persist without audio or base rewrites', async () => {
  const { spawnSync } = await import('node:child_process')
  const { createRequire } = await import('node:module')
  const require = createRequire(import.meta.url),
    root = join(import.meta.dirname, '../..')
  const f = fixture()
  try {
    writeFileSync(join(f.cwd, 'package.json'), '{"name":"@cardor/agent-harness-kit"}')
    const base = join(f.cwd, 'agent-harness-kit.config.json')
    writeFileSync(base, '{"project":{"name":"test"},"notifications":{"enabled":false}}')
    const before = readFileSync(base, 'utf8')
    for (const args of [
      ['enable', '--scope', 'project'],
      ['configure', '--scope', 'project', '--patch', '{"categories":{"health.blocked":false}}'],
      ['disable', '--scope', 'project'],
    ]) {
      const result = spawnSync(
        process.execPath,
        [
          '--import',
          require.resolve('tsx/esm'),
          join(root, 'src/cli.ts'),
          'notifications',
          ...args,
        ],
        {
          cwd: f.cwd,
          env: { ...process.env, TSX_TSCONFIG_PATH: join(root, 'tsconfig.json') },
          encoding: 'utf8',
          timeout: 8000,
        }
      )
      assert.equal(result.status, 0, result.stderr || result.stdout)
      assert.equal(JSON.parse(result.stdout).ok, true)
    }
    const overlay = JSON.parse(readFileSync(join(f.cwd, MANAGED_CONFIG_NAME), 'utf8'))
    assert.equal(overlay.notifications.enabled, false)
    assert.equal(overlay.notifications.categories['health.blocked'], false)
    assert.equal(readFileSync(base, 'utf8'), before)
  } finally {
    f.close()
  }
})
