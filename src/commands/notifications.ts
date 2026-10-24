import { randomUUID } from 'node:crypto'

import { loadConfig } from '../core/config'
import {
  configureNotifications,
  notificationConfigurationStatus,
  type SettingsOutcome,
} from '../core/maintenance/config'
import { withMaintenanceLock } from '../core/maintenance/plans'
import { normalizeNotifications } from '../core/notifications/config'
import { installNotificationHooks, uninstallNotificationHooks } from '../core/notifications/install'
import { resolveSoundAsset } from '../core/notifications/player'
import { normalizeProviderHook, type NotificationProvider } from '../core/notifications/providers'
import { notificationCliPath, NotificationService } from '../core/notifications/runtime'
import { deliverEvent } from '../core/notifications/worker'
import { capture } from '../core/result'

const providers = ['cursor', 'claude-code', 'codex-cli', 'opencode', 'opencode-v2'] as const
export function notificationProvider(value: string): NotificationProvider {
  if (!providers.includes(value as NotificationProvider))
    throw new Error('Provider must be cursor, claude-code, codex-cli opencode or opencode-v2')
  return value as NotificationProvider
}
async function service(cwd: string): Promise<NotificationService> {
  let config
  try {
    config = await loadConfig(cwd)
  } catch {
    config = { storage: { projectId: '' }, notifications: undefined }
  }
  return new NotificationService(config, cwd)
}
export async function notificationStatus(cwd: string, json = false): Promise<void> {
  const instance = await service(cwd)
  const status = {
    enabled: instance.settings.enabled,
    projectKey: instance.projectKey,
    ledgerPath: instance.ledgerPath,
    settings: instance.settings,
    configuration: await notificationConfigurationStatus(cwd),
    assets: Object.fromEntries(
      Object.entries(instance.settings.sounds).map(([kind, name]) => [
        kind,
        resolveSoundAsset(name),
      ])
    ),
  }
  if (json) process.stdout.write(JSON.stringify(status) + '\n')
  else
    process.stdout.write(
      `Notifications ${status.enabled ? 'enabled' : 'disabled'}. Ledger: ${status.ledgerPath}\n`
    )
}
export async function notificationInstall(
  cwd: string,
  provider: NotificationProvider,
  uninstall = false
): Promise<void> {
  const result = await withMaintenanceLock(cwd, async () => uninstall
    ? await uninstallNotificationHooks(cwd, provider)
    : await installNotificationHooks(cwd, provider, {
        node: process.execPath,
        cli: notificationCliPath(),
      }))
  if (!result.ok) throw result.error.cause
  process.stdout.write(JSON.stringify(result.value, null, 2) + '\n')
}
export async function notificationAttention(cwd: string, requestId: string): Promise<void> {
  const instance = await service(cwd)
  instance.attention('workflow', requestId)
}
function readInput(): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    let size = 0,
      settled = false
    const finish = (value?: unknown) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      process.stdin.removeAllListeners('data')
      process.stdin.pause()
      resolve(value)
    }
    const timer = setTimeout(() => finish(), 1000)
    process.stdin.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 262144) finish()
      else chunks.push(chunk)
    })
    process.stdin.once('end', () => {
      try {
        finish(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        finish()
      }
    })
    process.stdin.once('error', () => finish())
    process.stdin.resume()
  })
}
/** Notification protocol bypasses Commander and fatal/update reporting even on malformed input. */
export async function runNotificationInternal(cwd: string, argv: string[]): Promise<void> {
  const result = await capture(async () => {
    const verb = argv[0]
    const values: Record<string, string> = {}
    for (let i = 1; i < argv.length; i += 2) {
      if (!argv[i].startsWith('--') || !argv[i + 1]) return
      values[argv[i].slice(2)] = argv[i + 1]
    }
    if (verb === 'deliver') {
      if (!values['event-id'] || !values['ledger-path'] || !values.settings) return
      const raw = JSON.parse(values.settings)
      const settings = normalizeNotifications(raw, raw)
      await deliverEvent(
        values['event-id'],
        settings,
        values['ledger-path'],
        values['player-command'] ? { command: values['player-command'] } : undefined
      )
    } else if (verb === 'hook') {
      const provider = notificationProvider(values.provider ?? '')
      const payload = await readInput()
      if (!payload) return
      const instance = await service(cwd)
      if (!instance.settings.enabled) return
      for (const action of normalizeProviderHook(provider, values.event ?? '', payload)) {
        if (action.type === 'bind')
          instance.bindResponse(action.response, provider, action.session, action.turn)
        else if (action.type === 'complete')
          await instance.completeTurn(
            provider,
            action.session,
            action.turn,
            action.requestId ?? randomUUID()
          )
        else instance.attention(provider, action.requestId, action.session, action.turn)
      }
    }
  }, 'notification hook')
  // A failure is intentionally benign. Empty JSON is neutral for command-hook hosts.
  void result
  if (argv[0] === 'hook') process.stdout.write('{}\n')
}

export async function notificationConfigure(
  cwd: string,
  scope: 'project' | 'global',
  patch?: unknown,
  unset?: string[]
): Promise<SettingsOutcome> {
  return configureNotifications(cwd, { scope, patch, unset })
}
export async function notificationEnable(
  cwd: string,
  scope: 'project' | 'global',
  enabled = true
): Promise<SettingsOutcome> {
  return notificationConfigure(cwd, scope, { enabled })
}
