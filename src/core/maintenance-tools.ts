import { z } from 'zod'

import { recover } from './mcp-field-recovery'

const provider = z.enum(['claude-code', 'codex-cli', 'cursor', 'opencode', 'opencode-v2', 'grok-cli'])
const hookProvider = z.enum(['claude-code', 'codex-cli', 'cursor', 'opencode', 'opencode-v2'])
const text = z.string().trim().min(1).max(4096)
const roleChoice = z.object({ model: text, reasoningEffort: text.optional() })
const choices = z.object({ lead: roleChoice.optional(), explorer: roleChoice.optional(), consultant: roleChoice.optional(), builder: roleChoice.optional(), reviewer: roleChoice.optional() })
const categories = z.object({ 'task.completed': z.boolean().optional(), 'health.blocked': z.boolean().optional(), 'provider.completed': z.boolean().optional(), 'attention.requested': z.boolean().optional() })
const sounds = z.object({ 'task.completed': text.optional(), 'health.blocked': text.optional(), 'provider.completed': text.optional(), 'attention.requested': text.optional() })
const settings = z.object({ enabled: z.boolean().optional(), categories: categories.optional(), sounds: sounds.optional(), maxRecords: z.number().int().min(1).max(100000).optional(), maxAgeMs: z.number().int().positive().optional(), leaseMs: z.number().int().positive().optional(), playerTimeoutMs: z.number().int().positive().optional(), pendingWaitMs: z.number().int().nonnegative().optional() })
export const maintenanceOutcome = z.object({ ok: z.boolean(), operation: z.string(), code: z.string(), message: z.string().optional(), data: z.record(z.string(), z.unknown()).optional(), required: z.array(z.string()).optional(), notices: z.array(z.string()).optional() })

/** Validate every new field after bounded benign scalar recovery; strip unrelated keys. */
function input(shape: Record<string, z.ZodType>): z.ZodObject {
  return z.object(Object.fromEntries(Object.entries(shape).map(([key, field], order) => [key, recover(field, (args, name) => {
    let schema = field
    while (schema instanceof z.ZodOptional) schema = schema.unwrap() as z.ZodType
    let value = args[name]
    if (schema instanceof z.ZodNumber && typeof value === 'string' && /^\s*\d+\s*$/.test(value)) value = Number(value)
    if ((schema instanceof z.ZodObject || schema instanceof z.ZodArray) && typeof value === 'string') value = JSON.parse(value)
    return field.parse(value)
  }, order)])))
}
const sync = { force: z.boolean().optional(), keepModels: z.boolean().optional(), captureModels: z.boolean().optional(), sync: z.boolean().optional(), choices: choices.optional() }
const planId = { planId: text }
const operations: Array<[string, string, Record<string, z.ZodType>]> = [
  ['capabilities', 'List implemented CLI equivalents, options and bounded maintenance capabilities.', {}],
  ['init', 'Initialize a missing workspace without prompts; return needs_input for missing explicit choices.', { name: text.optional(), description: z.string().max(12000).optional(), provider: provider.optional(), docs: text.optional(), storageScope: z.enum(['local', 'global']).optional(), choices: choices.optional(), notifications: z.boolean().optional(), notificationScope: z.enum(['project','global']).optional(), installHooks: z.boolean().optional(), firstTask: z.object({ title: text, description: z.string().max(12000), acceptance: z.array(text).max(100) }).optional() }],
  ['build', 'Generate missing and managed files; force is explicit and backs up overwritten files.', sync],
  ['sync.plan', 'Inspect synchronization without writes; record a bounded expiring plan.', sync],
  ['sync.apply', 'Apply a server-owned synchronization plan after checking concurrent changes.', planId],
  ['models', 'Persist explicit provider role models and regenerate using shared maintenance services.', { provider: provider.optional(), choices }],
  ['status', 'Report bounded workspace, task, action and DB status.', { limit: z.number().int().min(1).max(100).optional(), offset: z.number().int().nonnegative().optional(), archived: z.boolean().optional() }],
  ['health', 'Run stateless workspace health, distinct from task-scoped persisted health.run.', {}],
  ['serve', 'Report the active MCP host; never start a nested server.', { port: z.number().int().min(1).max(65535).optional() }],
  ['migrate.provider.plan', 'Preview provider migration with explicit target-native role choices.', { to: provider, choices: choices.optional(), force: z.boolean().optional() }],
  ['migrate.provider.apply', 'Apply the checked provider migration plan and refresh runtime configuration.', planId],
  ['migrate.storage.plan', 'Inspect supported storage migration without changing source, destination or project state. Bounded temporary snapshots are removed after inspection.', { force: z.boolean().optional(), scope: z.enum(['local', 'global']).optional(), source: text.optional(), destination: text.optional() }],
  ['migrate.storage.apply', 'Apply a checked storage plan with backups and runtime handle fencing.', planId],
  ['migrate.specs.plan', 'Preview registered spec migrations without changing documents.', {}],
  ['migrate.specs.apply', 'Apply the checked registered spec migration plan.', planId],
  ['reset.plan', 'Preview explicitly selected DB and provider reset targets.', { db: z.boolean().optional(), provider: provider.optional(), force: z.boolean().optional(), targets: z.array(text).max(100).optional() }],
  ['reset.apply', 'Reset only previously selected targets after checking plan and backup.', { ...planId, confirm: z.boolean().optional() }],
  ['export', 'Export selected supported format to a workspace artifact; overwrite requires explicit force and backup. SQL returns unsupported guidance.', { format: z.enum(['json', 'sql']).optional(), output: text.optional(), force: z.boolean().optional() }],
  ['dashboard.start', 'Start one owned dashboard promptly; browser opening must be explicit.', { port: z.number().int().min(1).max(65535).optional(), open: z.boolean().optional() }],
  ['dashboard.status', 'Inspect the dashboard owned by this server.', {}],
  ['dashboard.stop', 'Stop the owned dashboard and release resources.', {}],
  ['watch.start', 'Start a bounded nonforced config watcher; return promptly.', {}],
  ['watch.status', 'Inspect the owned config watcher.', {}],
  ['watch.stop', 'Stop the owned config watcher.', {}],
  ['notifications.status', 'Inspect stored and effective local/global sound configuration.', {}],
  ['notifications.configure', 'Atomically patch or unset explicitly scoped sound settings; never rewrite executable project config.', { scope: z.enum(['project', 'global']), patch: settings.optional(), unset: z.array(text).max(30).optional() }],
  ['notifications.enable', 'Enable sounds in explicit project or global scope; hooks are independent.', { scope: z.enum(['project', 'global']) }],
  ['notifications.disable', 'Disable sounds in explicit project or global scope.', { scope: z.enum(['project', 'global']) }],
  ['notifications.install', 'Install ownership-aware project-local provider hooks while preserving native settings.', { provider: hookProvider }],
  ['notifications.uninstall', 'Remove only owned project-local provider hooks.', { provider: hookProvider }],
  ['notify.attention', 'Request attention with a stable id; delivery failure is informational.', { requestId: text }],
]
const strings = z.array(z.string())
const filesReport = z.object({ created: strings, overwritten: strings, preserved: strings, backupDir: z.string().optional() }).passthrough()
const report = z.object({ agents: filesReport, derived: filesReport.extend({ current: strings, propagated: strings }), skills: z.object({ applied: strings, preserved: strings, pendingPreservation: strings, backupDir: z.string().optional() }) }).passthrough()
const job = z.object({ id: z.string(), kind: z.enum(['watch', 'dashboard']), state: z.enum(['running', 'stopped', 'failed']), startedAt: z.string(), data: z.object({ url: z.string().optional(), port: z.number().optional() }).passthrough(), error: z.string().optional() })
const configuration = z.object({ scope: z.enum(['project', 'global']).optional(), path: z.string().optional(), effective: settings.required().extend({ categories: categories.required(), sounds: sounds.required() }), source: z.string(), globalEnabledOverridden: z.boolean() }).passthrough()
function successData(operation: string): z.ZodType {
  if (operation.endsWith('.plan')) return z.object({ planId: z.string(), expiresAt: z.string(), digest: z.string() }).passthrough()
  if (operation.endsWith('.start')) return z.object({ job, alreadyRunning: z.boolean().optional() }).passthrough()
  if (/^(watch|dashboard)\.(status|stop)$/.test(operation)) return z.object({ jobs: z.array(job) })
  if (/^notifications\.(status|configure|enable|disable)$/.test(operation)) return configuration
  if (/^notifications\.(install|uninstall)$/.test(operation)) return z.object({ provider: hookProvider, files: strings, preserved: strings, manual: strings })
  if (operation === 'notify.attention') return z.object({ eventId: z.string().nullable() })
  if (operation === 'init') return z.object({ configPath: z.string(), provider, storageScope: z.enum(['local','global']), projectId: z.string() }).passthrough()
  if (operation === 'build') return z.object({ report, backupDir: z.string().optional(), permissionsSynced: z.boolean().optional() })
  if (operation === 'models') return z.object({ report: filesReport, backupDir: z.string().optional() }).passthrough()
  if (operation === 'sync.apply') return z.union([z.object({ report, backupDir: z.string().optional(), permissionsSynced: z.boolean().optional() }), z.object({ captured: strings, missing: strings })])
  if (operation === 'migrate.provider.apply') return z.union([z.object({ alreadyCurrent: z.literal(true) }), z.object({ provider, report, backupDir: z.string().optional() })])
  if (operation === 'migrate.storage.apply') return z.union([z.object({ alreadyCurrent: z.literal(true), configReconciled: z.boolean().optional(), scope: z.enum(['local','global']).optional() }), z.object({ source: z.string(), destination: z.string(), sourceRetained: z.literal(true), sourceBackup: z.string().optional(), destinationBackup: z.string().optional(), counts: z.record(z.string(), z.number()) }).passthrough()])
  if (operation === 'migrate.specs.apply') return z.object({ files: strings, backupDir: z.string().optional() })
  if (operation === 'reset.apply') return z.object({ removed: strings, databaseCleared: z.boolean(), databasePath: z.string().optional(), databaseBackup: z.string().optional(), backupDir: z.string().optional() })
  if (operation === 'export') return z.object({ path: z.string(), bytes: z.number().int().nonnegative(), backupDir: z.string().optional() })
  if (operation === 'health') return z.object({ checks: z.array(z.object({ path: z.string(), ok: z.boolean() })), status: z.number().nullable(), signal: z.string().nullable(), logPath: z.string(), tail: z.string() })
  if (operation === 'status') return z.object({ tasks: z.array(z.object({ id: z.number(), slug: z.string(), title: z.string(), status: z.string() }).passthrough()), summary: z.array(z.object({ status: z.string(), total: z.number() }).passthrough()), archivedCount: z.number(), total: z.number(), nextOffset: z.number().nullable() }).passthrough()
  if (operation === 'serve') return z.object({ transport: z.literal('stdio'), configuredPort: z.number().nullable(), requestedPort: z.number().nullable(), restartRequired: z.boolean(), mode: z.enum(['setup','maintenance','normal']), storedProvider: provider.nullable(), effectiveProvider: provider.nullable(), databaseAvailable: z.boolean(), databaseError: z.object({code:z.enum(['database_busy','restart_required']),message:z.string()}).nullable() })
  return z.object({ version: z.string(), tools: z.array(z.object({ name: z.string(), description: z.string() })), tasks: strings, internalTransportOnly: strings, migrations: z.string(), databaseWarnings: z.string() })
}
export const MAINTENANCE_TOOLS = operations.map(([operation, description, shape]) => ({ name: `ahk.${operation}`, description, inputSchema: input(shape), outputSchema: z.union([maintenanceOutcome.extend({ ok: z.literal(true), operation: z.literal(operation), data: successData(operation) }), maintenanceOutcome.extend({ ok: z.literal(false), operation: z.literal(operation) })]) }))
export const MAINTENANCE_OPERATIONS = new Set(operations.map(([operation]) => `ahk.${operation}`))
