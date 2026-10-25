import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { applyConfigDefaults } from '../commands/init-helpers'
import { executeHealthCheck, healthCommand } from '../core/health-check'
import { MaintenanceService } from '../core/maintenance/operations'

test('Windows health invocation keeps the pathname out of command text and parent environment', () => {
  const script = 'C:\\project & (checks) ! %TEMP%\\health.bat'
  const before = process.env.AHK_INTERNAL_HEALTH_SCRIPT_PATH
  const invocation = healthCommand(script, 'win32')
  assert.equal(invocation.options.windowsVerbatimArguments, true)
  assert.equal(invocation.options.env?.AHK_INTERNAL_HEALTH_SCRIPT_PATH, script)
  assert.ok(invocation.args.every((arg) => !arg.includes(script)))
  assert.equal(process.env.AHK_INTERNAL_HEALTH_SCRIPT_PATH, before)
})

for (const directory of ['workspace with spaces', 'workspace & (checks) ! %TEMP%']) {
  for (const status of [0, 17]) {
    test(`native health runners retain output and exit ${status} in ${directory}`, async () => {
      const root = realpathSync(mkdtempSync(join(tmpdir(), 'ahk-native-health-')))
      const cwd = join(root, directory)
      mkdirSync(join(cwd, '.opencode', 'agents'), { recursive: true })
      mkdirSync(join(cwd, '.harness'), { recursive: true })
      for (const role of ['lead', 'explorer', 'consultant', 'builder', 'reviewer']) {
        writeFileSync(join(cwd, '.opencode', 'agents', `${role}.md`), role)
      }
      // Stateless health checks existence, without opening the fixture database.
      writeFileSync(join(cwd, '.harness', 'harness.db'), '')
      const config = applyConfigDefaults({
        name: 'Native health fixture',
        description: 'Isolated execution regression',
        provider: 'opencode',
        docsPath: './docs',
        scope: 'local',
      })
      config.tools.mcp.enabled = false
      const configPath = join(cwd, 'agent-harness-kit.config.json')
      const configContent = JSON.stringify(config)
      writeFileSync(configPath, configContent)
      const scriptPath = join(cwd, process.platform === 'win32' ? 'health.bat' : 'health.sh')
      const scriptContent =
        process.platform === 'win32'
          ? `@echo off\r\necho native-health-stdout\r\n>&2 echo native-health-stderr\r\nexit /b ${status}\r\n`
          : `#!/usr/bin/env bash\necho native-health-stdout\necho native-health-stderr >&2\nexit ${status}\n`
      writeFileSync(scriptPath, scriptContent)
      const service = new MaintenanceService(cwd, {
        getConfig: async () => config,
        homeDir: join(root, 'fake-home'),
      })
      try {
        const taskHealth = executeHealthCheck(cwd, scriptPath)
        assert.equal(taskHealth.error, undefined)
        assert.equal(taskHealth.status, status, taskHealth.tail)
        assert.match(taskHealth.tail, /native-health-stdout/)
        assert.match(taskHealth.tail, /native-health-stderr/)
        assert.match(readFileSync(taskHealth.logPath, 'utf8'), /native-health-stdout/)

        const manualHealth = await service.execute('health')
        assert.equal(manualHealth.ok, status === 0, JSON.stringify(manualHealth))
        assert.equal(manualHealth.code, status === 0 ? 'ok' : 'health_failed')
        assert.equal(manualHealth.data?.status, status)
        assert.match(String(manualHealth.data?.tail), /native-health-stdout/)
        assert.match(String(manualHealth.data?.tail), /native-health-stderr/)
        assert.match(
          readFileSync(String(manualHealth.data?.logPath), 'utf8'),
          /native-health-stdout/
        )
        assert.equal(readFileSync(scriptPath, 'utf8'), scriptContent)
        assert.equal(readFileSync(configPath, 'utf8'), configContent)
      } finally {
        await service.dispose()
        rmSync(root, { recursive: true, force: true })
      }
    })
  }
}
