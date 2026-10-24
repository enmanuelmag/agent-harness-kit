import { randomUUID } from 'node:crypto'
import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import { openCodeV2PreferenceSchema } from '@/schema/opencode-v2'

import { err, ok, type Result } from '../result'

export const MANAGED_CONFIG_NAME = 'agent-harness-kit.config.local.json'
export interface SettingsFailure {
  code: string
  message: string
  path?: string
}
export interface SettingsOutcome {
  ok: boolean
  operation: string
  code: string
  message?: string
  data?: Record<string, unknown>
  required?: string[]
}
const MAX_BYTES = 16384
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
function readObject(path: string): Result<Record<string, unknown>, SettingsFailure> {
  try {
    if (!existsSync(path)) {
      // lstat also catches dangling symlinks.
      try {
        if (lstatSync(path).isSymbolicLink())
          return err({ code: 'unsafe_path', message: 'Symbolic links are not supported.', path })
      } catch {
        /* absent */
      }
      return ok({})
    }
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.isSymbolicLink())
      return err({ code: 'unsafe_path', message: 'Settings must be a regular file.', path })
    if (stat.size > MAX_BYTES)
      return err({ code: 'settings_too_large', message: 'Settings exceed 16 KiB.', path })
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
    return object(value)
      ? ok(value)
      : err({ code: 'invalid_settings', message: 'Settings must contain a JSON object.', path })
  } catch (cause) {
    return err({
      code: 'invalid_settings',
      message: cause instanceof Error ? cause.message : String(cause),
      path,
    })
  }
}
/** Only known operational roots are writable; untouched extension keys remain intact. */
export function mergeManagedConfig(
  base: Record<string, unknown>,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const next = { ...base, ...patch }
  for (const key of ['notifications', 'storage', 'database', 'project', 'tools', 'health']) {
    if (object(base[key]) && object(patch[key])) next[key] = { ...base[key], ...patch[key] }
  }
  if (object(base.notifications) && object(patch.notifications)) {
    const notifications = next.notifications as Record<string, unknown>
    for (const key of ['categories', 'sounds'])
      if (object(base.notifications[key]) && object(patch.notifications[key]))
        notifications[key] = { ...base.notifications[key], ...patch.notifications[key] }
  }
  if (object(base.agentPreferences) && object(patch.agentPreferences)) {
    next.agentPreferences = { ...base.agentPreferences, ...patch.agentPreferences }
    for (const [provider, roles] of Object.entries(patch.agentPreferences))
      if (object(roles) && object(base.agentPreferences[provider]))
        (next.agentPreferences as Record<string, unknown>)[provider] = {
          ...base.agentPreferences[provider],
          ...roles,
        }
  }
  return next
}
export function loadManagedConfig(cwd: string): Result<Record<string, unknown>, SettingsFailure> {
  const read = readObject(join(cwd, MANAGED_CONFIG_NAME))
  if (!read.ok) return read
  const known = Object.fromEntries(
    Object.entries(read.value).filter(([key]) => MANAGED_FIELDS.includes(key))
  )
  const validated = validateManagedPatch(known)
  return validated.ok
    ? ok({ ...read.value, ...validated.value })
    : err({ ...validated.error, path: join(cwd, MANAGED_CONFIG_NAME) })
}
function assertParents(path: string): void {
  let parent = dirname(path)
  for (;;) {
    if (existsSync(parent) && lstatSync(parent).isSymbolicLink())
      throw new Error(`Symbolic link parent is not supported: ${parent}`)
    const next = dirname(parent)
    if (next === parent) break
    parent = next
  }
}
async function atomicUpdate(
  path: string,
  update: (current: Record<string, unknown>) => Record<string, unknown>
): Promise<Result<Record<string, unknown>, SettingsFailure>> {
  let lock: string | undefined, temp: string | undefined
  try {
    assertParents(path)
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    lock = `${path}.lock`
    try {
      const fd = openSync(lock, 'wx', 0o600)
      closeSync(fd)
    } catch {
      lock = undefined
      return err({
        code: 'concurrent_edit',
        message: 'Another process is updating settings. Retry after it completes.',
        path,
      })
    }
    const current = readObject(path)
    if (!current.ok) return current
    const before = existsSync(path) ? readFileSync(path) : undefined
    const next = update(current.value),
      raw = JSON.stringify(next, null, 2) + '\n'
    if (Buffer.byteLength(raw) > MAX_BYTES)
      return err({ code: 'settings_too_large', message: 'Settings exceed 16 KiB.', path })
    temp = join(dirname(path), `.${randomUUID()}.settings.tmp`)
    const mode = existsSync(path) ? lstatSync(path).mode & 0o777 : 0o600
    const fd = openSync(temp, 'wx', mode)
    try {
      writeFileSync(fd, raw)
      chmodSync(temp, mode)
    } finally {
      closeSync(fd)
    }
    const checked = readObject(path)
    if (!checked.ok) return checked
    if (before ? !existsSync(path) || !readFileSync(path).equals(before) : existsSync(path))
      return err({
        code: 'concurrent_edit',
        message: 'Settings changed during update; no changes were written.',
        path,
      })
    renameSync(temp, path)
    temp = undefined
    return ok(next)
  } catch (cause) {
    return err({
      code: 'settings_write_failed',
      message: cause instanceof Error ? cause.message : String(cause),
      path,
    })
  } finally {
    for (const item of [temp, lock])
      if (item)
        try {
          unlinkSync(item)
        } catch {
          /* bounded cleanup */
        }
  }
}
export async function updateManagedConfig(
  cwd: string,
  patch: Record<string, unknown>
): Promise<Result<Record<string, unknown>, SettingsFailure>> {
  const validated = validateManagedPatch(patch)
  if (!validated.ok) return validated
  return atomicUpdate(join(cwd, MANAGED_CONFIG_NAME), (current) =>
    mergeManagedConfig(current, validated.value)
  )
}
const MANAGED_FIELDS = [
  'provider',
  'agentPreferences',
  'notifications',
  'storage',
  'database',
  'project',
  'tools',
  'health',
]
function validateManagedPatch(
  patch: Record<string, unknown>
): Result<Record<string, unknown>, SettingsFailure> {
  if (!object(patch) || Object.keys(patch).some((k) => !MANAGED_FIELDS.includes(k)))
    return err({ code: 'invalid_settings', message: 'Unsupported managed configuration field.' })
  if (
    patch.provider !== undefined &&
    !['claude-code', 'codex-cli', 'cursor', 'opencode', 'opencode-v2', 'grok-cli'].includes(String(patch.provider))
  )
    return err({ code: 'invalid_settings', message: 'Unsupported provider.' })
  for (const key of ['storage', 'database', 'project', 'tools', 'health'])
    if (patch[key] !== undefined && !object(patch[key]))
      return err({ code: 'invalid_settings', message: `${key} must be an object.` })
  if (patch.notifications !== undefined) {
    const result = validateNotificationPatch(patch.notifications, 'project')
    if (!result.ok) return result
    patch = { ...patch, notifications: result.value }
  }
  if (patch.agentPreferences !== undefined) {
    if (!object(patch.agentPreferences))
      return err({ code: 'invalid_settings', message: 'agentPreferences must be an object.' })
    for (const [provider, roles] of Object.entries(patch.agentPreferences)) {
      if (
        !['claude-code', 'codex-cli', 'cursor', 'opencode', 'opencode-v2', 'grok-cli'].includes(provider) ||
        !object(roles)
      )
        return err({ code: 'invalid_settings', message: 'Invalid preference provider.' })
      for (const [role, preference] of Object.entries(roles))
        if (
          !['lead', 'explorer', 'consultant', 'builder', 'reviewer'].includes(role) ||
          !object(preference) ||
          typeof preference.model !== 'string' ||
          !preference.model.trim() ||
          preference.model.length > 256 ||
          (provider === 'opencode-v2' && !openCodeV2PreferenceSchema.safeParse(preference).success) ||
          (preference.reasoningEffort !== undefined &&
            typeof preference.reasoningEffort !== 'string')
        )
          return err({
            code: 'invalid_settings',
            message: `Invalid preference ${provider}.${role}.`,
          })
    }
  }
  return ok(patch)
}
const kinds = ['task.completed', 'health.blocked', 'provider.completed', 'attention.requested']
const sounds = ['task-completed.wav', 'health-blocked.wav', 'turn-completed.wav', 'attention.wav']
function validateNotificationPatch(
  patch: unknown,
  scope: string
): Result<Record<string, unknown>, SettingsFailure> {
  if (!object(patch))
    return err({ code: 'invalid_settings', message: 'Notification patch must be an object.' })
  const next: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'enabled') {
      if (typeof value !== 'boolean')
        return err({ code: 'invalid_settings', message: 'enabled must be a boolean.' })
      next[key] = value
    } else if (key === 'categories' || key === 'sounds') {
      if (!object(value))
        return err({ code: 'invalid_settings', message: `${key} must be an object.` })
      const nested: Record<string, unknown> = {}
      for (const [kind, entry] of Object.entries(value))
        if (kinds.includes(kind)) {
          if (
            key === 'categories'
              ? typeof entry !== 'boolean'
              : typeof entry !== 'string' || !sounds.includes(entry)
          )
            return err({ code: 'invalid_settings', message: `Invalid ${key}.${kind}.` })
          nested[kind] = entry
        }
      next[key] = nested
    } else if (
      ['maxRecords', 'maxAgeMs', 'leaseMs', 'playerTimeoutMs', 'pendingWaitMs'].includes(key)
    ) {
      if (scope !== 'global' && ['maxRecords', 'maxAgeMs'].includes(key))
        return err({ code: 'global_setting', message: `${key} is global only.` })
      const [min, max] =
        key === 'maxRecords'
          ? [10, 1000]
          : key === 'maxAgeMs'
            ? [1000, 86400000]
            : key === 'leaseMs'
              ? [5000, 5000]
              : key === 'pendingWaitMs'
                ? [0, 1500]
                : [100, 3000]
      if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max)
        return err({
          code: 'invalid_settings',
          message: `${key} must be an integer between ${min} and ${max}.`,
        })
      next[key] = value
    }
  }
  return ok(next)
}
export async function configureNotifications(
  cwd: string,
  request: { scope: 'project' | 'global'; patch?: unknown; unset?: string[] },
  options: { globalPath?: string } = {}
): Promise<SettingsOutcome> {
  const operation = 'notifications.configure'
  if (!['project', 'global'].includes(request.scope))
    return { ok: false, operation, code: 'needs_input', required: ['scope'] }
  const validated = validateNotificationPatch(request.patch ?? {}, request.scope)
  if (!validated.ok) return { ok: false, operation, ...validated.error }
  const unset = request.unset ?? []
  const allowed = [
    'enabled',
    'categories',
    'sounds',
    'maxRecords',
    'maxAgeMs',
    'leaseMs',
    'playerTimeoutMs',
    'pendingWaitMs',
  ]
  if (
    !Array.isArray(unset) ||
    unset.some(
      (k) =>
        typeof k !== 'string' ||
        !allowed.includes(k.split('.')[0]) ||
        (k.includes('.') &&
          (!['categories', 'sounds'].includes(k.split('.')[0]) ||
            !kinds.includes(k.slice(k.indexOf('.') + 1))))
    )
  )
    return { ok: false, operation, code: 'invalid_settings', message: 'Invalid unset field.' }
  if (request.scope === 'project' && unset.some((k) => ['maxRecords', 'maxAgeMs'].includes(k)))
    return {
      ok: false,
      operation,
      code: 'global_setting',
      message: 'Ledger limits are global only.',
    }
  const path =
    request.scope === 'global'
      ? (options.globalPath ?? join(homedir(), '.config/agent-harness-kit/notifications.json'))
      : join(cwd, MANAGED_CONFIG_NAME)
  const beforeStatus = await notificationConfigurationStatus(cwd, options)
  if (!beforeStatus.ok) return { ...beforeStatus, operation }
  const result = await atomicUpdate(path, (current) => {
    const notifications =
      request.scope === 'global'
        ? current
        : object(current.notifications)
          ? current.notifications
          : {}
    const next = mergeManagedConfig({ notifications }, { notifications: validated.value })
      .notifications as Record<string, unknown>
    for (const key of unset) {
      const index = key.indexOf('.')
      if (index < 0) delete next[key]
      else {
        const root = key.slice(0, index),
          field = key.slice(index + 1)
        if (object(next[root])) {
          next[root] = { ...next[root] }
          delete (next[root] as Record<string, unknown>)[field]
        }
      }
    }
    return request.scope === 'global' ? next : { ...current, notifications: next }
  })
  if (!result.ok) return { ok: false, operation, ...result.error }
  const status = await notificationConfigurationStatus(cwd, options)
  return status.ok
    ? {
        ok: true,
        operation,
        code: 'configured',
        data: { ...status.data, scope: request.scope, path, stored: result.value },
      }
    : { ...status, operation }
}

export async function notificationConfigurationStatus(
  cwd: string,
  options: { globalPath?: string } = {}
): Promise<SettingsOutcome> {
  const operation = 'notifications.status'
  const globalPath =
    options.globalPath ?? join(homedir(), '.config/agent-harness-kit/notifications.json')
  const global = readObject(globalPath),
    managed = loadManagedConfig(cwd)
  if (!global.ok) return { ok: false, operation, ...global.error }
  if (!managed.ok) return { ok: false, operation, ...managed.error }
  const { loadConfig, findConfigFile, BASE_NOTIFICATIONS } = await import('../config')
  const { normalizeNotifications } = await import('../notifications/config')
  let project: unknown, base: unknown
  if (findConfigFile(cwd)) {
    try {
      const config = await loadConfig(cwd)
      project = config.notifications
      base = (config as unknown as Record<symbol, unknown>)[BASE_NOTIFICATIONS]
    } catch (cause) {
      return {
        ok: false,
        operation,
        code: 'invalid_config',
        message: cause instanceof Error ? cause.message : String(cause),
      }
    }
  } else project = managed.value.notifications
  const baseObject = object(base) ? base : {},
    projectObject = object(project) ? project : {},
    overlay = object(managed.value.notifications) ? managed.value.notifications : {}
  const enabledSource =
    'enabled' in overlay
      ? 'project-overlay'
      : 'enabled' in baseObject
        ? 'project'
        : 'enabled' in global.value
          ? 'global'
          : 'default'
  return {
    ok: true,
    operation,
    code: 'status',
    data: {
      effective: normalizeNotifications(project, global.value),
      source: enabledSource,
      global: global.value,
      project: projectObject,
      overlay,
      globalEnabledOverridden:
        typeof global.value.enabled === 'boolean' &&
        typeof projectObject.enabled === 'boolean' &&
        global.value.enabled !== projectObject.enabled,
      globalPath,
      projectPath: join(cwd, MANAGED_CONFIG_NAME),
    },
  }
}
