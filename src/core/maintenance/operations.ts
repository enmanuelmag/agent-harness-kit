import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, statSync, watch, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { choicesFromPreferences, missingPreferenceRoles, ROLES, toPreferences } from '@/commands/agent-preferences'
import { applyConfigDefaults } from '@/commands/init-helpers'
import { filesFor } from '@/commands/models'
import { findConfigFile, loadConfig } from '@/core/config'
import { startDashboardServer } from '@/core/dashboard-server'
import { HarnessDB, openDB, readStorageStateFile, resolveSqlitePath, resolveSqlitePathForScope } from '@/core/db'
import { SQLiteDriver } from '@/core/drivers/sqlite'
import { healthCommand, inspectHealthCheck } from '@/core/health-check'
import { getMaterializer } from '@/core/materializer/index'
import { LEGACY_CODEX_LEAD, nativeAgentFilename } from '@/core/materializer/native-agent-path'
import { opencodeV2AgentFiles, preflightOpenCodeV2 } from '@/core/materializer/opencode-v2'
import { inspectOpenCodeConfig, writeOpenCodeV2Config } from '@/core/materializer/opencode-v2-config'
import { slugify } from '@/core/materializer/scaffold-utils'
import { writeAgentFiles } from '@/core/materializer/scaffold-utils'
import { configCjs, configJson, configMjs, configTs } from '@/core/materializer/templates'
import { inspectOpenCodeNotificationPlugin, installNotificationHooks,uninstallNotificationHooks } from '@/core/notifications/install'
import { notificationCliPath } from '@/core/notifications/runtime'
import { capture } from '@/core/result'
import { changeSQLiteEpoch, inspectSQLiteEpoch, withSQLiteMaintenance } from '@/core/sqlite-ownership'
import { openCodeV2PreferenceSchema } from '@/schema/opencode-v2'

import { configureNotifications, updateManagedConfig } from './config'
import { JobStore } from './jobs'
import { captureNativeChoices } from './native-model-capture'
import { fileTree, PlanStore, revision, safePath, withMaintenanceLock } from './plans'

import type { MaintenancePlan } from './plans'
import type { FullExport } from '@/core/db'
import type { AgentModelPreferences, HarnessConfig, Provider } from '@/types'

export interface MaintenanceOutcome { ok: boolean; operation: string; code: string; message?: string; data?: Record<string, unknown>; required?: string[]; notices?: string[] }
export interface MaintenanceOptions {
  getConfig?: () => Promise<HarnessConfig>
  beforeStorageChange?: () => Promise<void>
  afterStorageChange?: () => Promise<void>
  homeDir?: string
}
const PROVIDERS: Provider[] = ['claude-code', 'codex-cli', 'cursor', 'opencode', 'opencode-v2', 'grok-cli']
const providerRoot = (p: Provider) => ({ 'claude-code': '.claude', 'codex-cli': '.codex', cursor: '.cursor', opencode: '.opencode', 'opencode-v2': '.opencode', 'grok-cli': '.grok' })[p]
const success = (operation: string, data: Record<string, unknown> = {}, notices?: string[]): MaintenanceOutcome => ({ ok: true, operation, code: 'ok', data, ...(notices?.length ? { notices } : {}) })
const failure = (operation: string, code: string, message: string, required?: string[]): MaintenanceOutcome => ({ ok: false, operation, code, message, ...(required ? { required } : {}) })

/** Public CLI and MCP adapters share these noninteractive operations. */
export class MaintenanceService {
  private readonly plans = new PlanStore()
  private readonly jobs = new JobStore()
  private queue: Promise<unknown> = Promise.resolve()
  private disposed = false
  constructor(private readonly cwd: string, private readonly options: MaintenanceOptions = {}) { this.cwd = realpathSync(cwd) }
  private config() { return this.options.getConfig ? this.options.getConfig() : loadConfig(this.cwd) }
  private get home() { return this.options.homeDir ?? homedir() }
  async execute(operation: string, args: Record<string, unknown> = {}): Promise<MaintenanceOutcome> {
    if (this.disposed) return failure(operation, 'disposed', 'Maintenance service stopped.')
    // Queue per-server operations; cross-process apply lock protects all writes.
    const run = this.queue.then(async () => {
      const result = await capture(() => this.dispatch(operation, args), `maintenance ${operation}`)
      if (result.ok) return result.value
      const message = result.error.message
      return failure(operation, message.startsWith('maintenance_busy:') ? 'maintenance_busy' : message.startsWith('database_busy:') || /database is locked|SQLITE_BUSY/.test(message) ? 'database_busy' : message.startsWith('restart_required:') ? 'restart_required' : 'operation_failed', message)
    })
    this.queue = run.then(() => undefined)
    return run
  }
  async dispose() { await this.queue; this.disposed = true; this.plans.clear(); await this.jobs.dispose() }
  async stopStorageJobs() { await this.jobs.dispose() }
  private async dispatch(operation: string, args: Record<string, unknown>): Promise<MaintenanceOutcome> {
    if (operation === 'init') return withMaintenanceLock(this.cwd, () => this.initialize(args))
    if (operation.endsWith('.plan')) return this.plan(operation, args)
    if (operation.endsWith('.apply')) return withMaintenanceLock(this.cwd, () => this.apply(operation, args))
    if (operation === 'build' || operation === 'models') return withMaintenanceLock(this.cwd, () => this.generate(operation, args))
    if (operation === 'export') return withMaintenanceLock(this.cwd, () => this.exportData(args))
    if (operation === 'status') return this.status(args)
    if (operation === 'health') return this.health()
    if (operation.startsWith('watch.') || operation.startsWith('dashboard.')) return this.job(operation, args)
    return failure(operation, 'unsupported_operation', `Unknown maintenance operation: ${operation}`)
  }
  private async initialize(args: Record<string, unknown>): Promise<MaintenanceOutcome> {
    if (findConfigFile(this.cwd)) return failure('init', 'already_initialized', 'Config already exists. Use sync instead.')
    const required = ['name', 'description', 'provider', 'storageScope'].filter(key => typeof args[key] !== 'string' || !String(args[key]).trim())
    if (required.length) return failure('init', 'needs_input', 'Initialization requires explicit project fields.', required)
    if (!PROVIDERS.includes(args.provider as Provider) || !['local', 'global'].includes(String(args.storageScope))) return failure('init', 'invalid_input', 'Invalid provider or storageScope.')
    const docsPath = String(args.docsPath ?? args.docs ?? './docs')
    safePath(this.cwd, resolve(this.cwd, docsPath))
    const config = applyConfigDefaults({ name: String(args.name), description: String(args.description), provider: args.provider as Provider, docsPath, scope: args.storageScope as 'local' | 'global' })
    const prefs = this.preferences(args, config.provider)
    if (!prefs.ok) return { ...prefs, operation: 'init' }
    if (prefs.data?.preferences) config.agentPreferences = prefs.data.preferences as AgentModelPreferences
    if (['claude-code', 'codex-cli', 'cursor', 'opencode-v2'].includes(config.provider)) {
      const missing = missingPreferenceRoles(config)
      if (missing.length) return failure('init', 'needs_input', 'Provide explicit native model choices; inherit is a valid choice.', missing.map(role => `choices.${role}`))
    }
    if (args.installHooks === true && config.provider === 'grok-cli') return failure('init', 'unsupported_provider', 'Grok CLI has no supported sound hooks.')
    if (args.notifications !== undefined && args.notificationScope !== 'global') config.notifications = { enabled: args.notifications === true }
    const ext = String(args.configFormat ?? 'json')
    const templates = { json: configJson, ts: configTs, mjs: configMjs, cjs: configCjs }
    if (!(ext in templates)) return failure('init', 'invalid_input', 'configFormat must be json, ts, mjs or cjs.')
    const path = safePath(this.cwd, join(this.cwd, `agent-harness-kit.config.${ext}`))
    const content = templates[ext as keyof typeof templates]({ name: config.project.name, description: config.project.description, provider: config.provider, docsPath, tasksAdapter: 'mcp', scope: config.storage.scope, projectId: config.storage.projectId, port: config.tools.mcp.port, agentPreferences: config.agentPreferences })
    if (config.provider === 'opencode-v2') preflightOpenCodeV2(config, this.cwd)
    writeFileSync(path, content, { flag: 'wx', mode: 0o600 })
    const choices = choicesFromPreferences(config)
    await getMaterializer(config.provider).scaffold(config, { cwd: this.cwd, ...choices })
    const db = await openDB(config, this.cwd, this.home)
    try {
      await db.writeStorageState(this.cwd)
      const task = args.firstTask as { title: string; description?: string; acceptance?: string[] } | undefined
      if (task?.title) await db.addTask({ slug: slugify(task.title), title: task.title, description: task.description, acceptance: task.acceptance })
    } finally { await db.close() }
    if (args.notifications !== undefined) { const saved = await configureNotifications(this.cwd, { scope: args.notificationScope === 'global' ? 'global' : 'project', patch: { enabled: args.notifications === true } }, { globalPath: join(this.home, '.config', 'agent-harness-kit', 'notifications.json') }); if (!saved.ok) return { ...saved, operation: 'init' } }
    if (args.installHooks === true && config.provider !== 'grok-cli') { const installed = await installNotificationHooks(this.cwd, config.provider, { node: process.execPath, cli: notificationCliPath() }); if (!installed.ok) return failure('init', 'hook_install_failed', installed.error.message) }
    return success('init', { configPath: path, provider: config.provider, storageScope: config.storage.scope, projectId: config.storage.projectId })
  }
  private preferences(args: Record<string, unknown>, provider: Provider): MaintenanceOutcome {
    const roles = args.choices as Record<string, { model: string; reasoningEffort?: string }> | undefined
    if (!roles) return success('models')
    if (!roles || Array.isArray(roles) || typeof roles !== 'object') return failure('models', 'invalid_input', 'choices must contain explicit role objects.')
    for (const [role, value] of Object.entries(roles)) {
      if (!ROLES.includes(role as typeof ROLES[number]) || !value || typeof value.model !== 'string' || !value.model.trim() || (value.reasoningEffort !== undefined && typeof value.reasoningEffort !== 'string')) return failure('models', 'invalid_input', `Invalid native choice for ${role}.`)
    }
    if (provider === 'opencode-v2') for (const value of Object.values(roles)) { const checked = openCodeV2PreferenceSchema.safeParse(value); if (!checked.success) return failure('models', 'invalid_input', checked.error.message) }
    return success('models', { preferences: { [provider]: roles } })
  }
  private async generate(operation: string, args: Record<string, unknown>): Promise<MaintenanceOutcome> {
    let config = await this.config()
    if (operation === 'models' && args.provider !== undefined && args.provider !== config.provider) return { ...failure(operation, 'provider_mismatch', `Current provider is ${config.provider}; requested ${String(args.provider)}. Models configure only the current provider. Use a provider migration plan to change providers.`), data: { currentProvider: config.provider, requestedProvider: args.provider } }
    const pref = this.preferences(args, config.provider)
    if (!pref.ok) return { ...pref, operation }
    if (operation === 'models' && !['claude-code', 'codex-cli', 'cursor', 'opencode-v2'].includes(config.provider)) return failure(operation, 'unsupported_provider', `${config.provider} has no supported native model choices.`)
    if ((operation === 'models' || (args.force === true && args.keepModels !== true)) && ['claude-code', 'codex-cli', 'cursor', 'opencode-v2'].includes(config.provider) && !pref.data?.preferences) return failure(operation, 'needs_input', 'Provide native choices for all roles or force with keepModels.', ROLES.map(role => `choices.${role}`))
    const combined = pref.data?.preferences ? { ...config, agentPreferences: { ...config.agentPreferences, [config.provider]: { ...config.agentPreferences?.[config.provider], ...(pref.data.preferences as AgentModelPreferences)[config.provider] } } } : config
    if ((args.force === true || operation === 'models') && ['claude-code', 'codex-cli', 'cursor', 'opencode-v2'].includes(config.provider)) {
      const missing = missingPreferenceRoles(combined)
      if (missing.length) return failure(operation, 'needs_input', 'Missing native model preferences; no files changed.', missing.map(role => `choices.${role}`))
    }
    if (config.provider === 'opencode-v2') preflightOpenCodeV2(combined, this.cwd)
    const files = this.generatedFiles(config)
    const backupDir = args.force === true || operation === 'models' ? this.backup(files) : undefined
    if (pref.data?.preferences) {
      const saved = await updateManagedConfig(this.cwd, { agentPreferences: pref.data.preferences })
      if (!saved.ok) return failure(operation, saved.error.code, saved.error.message)
      config = await this.config()
    }
    const choices = choicesFromPreferences(config)
    if (operation === 'models') {
      const native = choices.claudeAgentModels ?? choices.codexAgentModels ?? choices.cursorAgentModels ?? choices.opencodeV2AgentModels ?? {}
      const report = writeAgentFiles(this.cwd, filesFor(config, native), { force: true, backupRoot: join(this.cwd, config.storage.dir, 'backups') })
      // Codex project default and permissions are reconciled by the same materializer.
      if (config.provider === 'codex-cli') await getMaterializer(config.provider).build(config, this.cwd, choices)
      return success(operation, { report, backupDir })
    }
    const report = await getMaterializer(config.provider).build(config, this.cwd, { force: args.force === true, ...choices })
    return success(operation, { report, backupDir, permissionsSynced: args.sync === true }, args.sync === true ? ['Native permissions are maintained by generation; provider syncPermissions is a documented no-op.'] : undefined)
  }
  private generatedFiles(config: HarnessConfig): string[] {
    return [...fileTree(this.cwd, join(this.cwd, providerRoot(config.provider))), ...['AGENTS.md', 'CLAUDE.md', '.mcp.json', 'opencode.json', 'opencode.jsonc', '.opencode/opencode.json', '.opencode/opencode.jsonc', 'agent-harness-kit.config.local.json', '.harness/skills-state.json', '.harness/notifications-hooks-opencode.json', '.harness/notifications-hooks-opencode-v2.json'].map(p => safePath(this.cwd, join(this.cwd, p)))]
  }
  private backup(files: string[]): string | undefined {
    const existing = [...new Set(files)].filter(existsSync)
    if (!existing.length) return undefined
    const backup = safePath(this.cwd, join(this.cwd, '.harness', 'backups', `maintenance-${randomUUID()}`))
    mkdirSync(backup, { recursive: true })
    // Complete ALL backups before any caller mutates a target.
    for (const path of existing) {
      safePath(path.startsWith(resolve(this.cwd) + '/') ? this.cwd : this.home, path)
      const local = relative(this.cwd, path)
      const destination = join(backup, local.startsWith('..') ? `external-${randomUUID()}-${path.split(/[\\/]/).at(-1)}` : local)
      safePath(this.cwd, destination); mkdirSync(dirname(destination), { recursive: true }); copyFileSync(path, destination)
    }
    return backup
  }
  private async fingerprint(operation: string, args: Record<string, unknown>, config: HarnessConfig): Promise<string> {
    const files = [...['ts', 'mjs', 'cjs', 'json'].map(ext => join(this.cwd, `agent-harness-kit.config.${ext}`)), join(this.cwd, 'agent-harness-kit.config'), join(this.cwd, 'agent-harness-kit.config.local.json'), join(this.cwd, config.storage.dir, 'storage-state.json')]
    if (operation === 'migrate.specs') files.push(...fileTree(this.cwd, resolve(this.cwd, config.project.docsPath, 'specs')))
    else files.push(...this.generatedFiles(config))
    const db = operation === 'reset' || operation === 'migrate.storage' ? await this.storagePreview(config) : undefined
    return revision(this.cwd, files, { config, operation, args, db })
  }
  private async plan(operation: string, args: Record<string, unknown>): Promise<MaintenanceOutcome> {
    const base = operation.slice(0, -5)
    if (!['sync', 'migrate.provider', 'migrate.storage', 'migrate.specs', 'reset'].includes(base)) return failure(operation, 'unsupported_operation', 'Unsupported maintenance plan.')
    let config = await this.config()
    if (base === 'migrate.storage' && args.scope) config = { ...config, storage: { ...config.storage, scope: args.scope as 'local' | 'global' } } as HarnessConfig
    if (base === 'sync' && ((args.captureModels && (args.force || args.keepModels)) || (args.keepModels && !args.force))) return failure(operation, 'invalid_input', 'captureModels cannot combine with force/keepModels; keepModels requires force.')
    if (base === 'migrate.provider' && !PROVIDERS.includes(args.to as Provider)) return failure(operation, 'needs_input', 'Select a migration provider.', ['to'])
    const preview: Record<string, unknown> = base === 'migrate.storage' ? await this.storagePreview(config) : base === 'migrate.specs' ? { files: this.specChanges(config).map(c => relative(this.cwd, c.path)) } : base === 'reset' ? { targets: this.resetTargets(config, args) } : { provider: args.to ?? config.provider, force: args.force === true, keepModels: args.keepModels === true, captureModels: args.captureModels === true, files: this.generatedFiles({ ...config, provider: (args.to ?? config.provider) as Provider }).map(p => relative(this.cwd, p)) }
    if (base === 'sync' && config.provider === 'codex-cli') {
      const legacy = existsSync(join(this.cwd, LEGACY_CODEX_LEAD)) ? [LEGACY_CODEX_LEAD] : []
      preview.retired = args.force === true ? legacy : []
      preview.preservedLegacy = args.force === true ? [] : legacy
    }
    const plan = this.plans.create(base, args, await this.fingerprint(base, args, config), preview)
    return success(operation, { planId: plan.id, expiresAt: new Date(plan.expiresAt).toISOString(), digest: plan.digest, ...preview })
  }
  private async apply(operation: string, args: Record<string, unknown>): Promise<MaintenanceOutcome> {
    const plan = typeof args.planId === 'string' ? this.plans.get(args.planId) : undefined
    if (!plan || `${plan.operation}.apply` !== operation) return failure(operation, 'invalid_plan', 'Plan missing, expired, or from another server. Create a fresh plan.')
    let config = await this.config()
    if (plan.operation === 'migrate.storage' && plan.args.scope) config = { ...config, storage: { ...config.storage, scope: plan.args.scope as 'local' | 'global' } } as HarnessConfig
    if (await this.fingerprint(plan.operation, plan.args, config) !== plan.digest) return failure(operation, 'stale_plan', 'Project changed after inspection. Create a fresh plan; nothing changed.')
    this.plans.consume(plan.id)
    if (plan.operation === 'sync') {
      if (plan.args.captureModels === true) return { ...await this.captureModels(config), operation }
      return { ...await this.generate('build', plan.args), operation }
    }
    if (plan.operation === 'migrate.provider') return this.migrateProvider(plan, config)
    if (plan.operation === 'migrate.specs') {
      const changes = this.specChanges(config)
      const backupDir = this.backup(changes.map(c => c.path))
      for (const change of changes) { const temp = `${change.path}.${randomUUID()}.tmp`; writeFileSync(temp, change.after, { flag: 'wx' }); renameSync(temp, change.path) }
      return success(operation, { files: changes.map(c => relative(this.cwd, c.path)), backupDir })
    }
    if (plan.operation === 'reset') {
      if (plan.args.force !== true && args.confirm !== true) return failure(operation, 'needs_input', 'Reset requires explicit force or confirmation and targets.', ['confirm'])
      const targets = this.resetTargets(config, plan.args)
      await this.jobs.dispose()
      await this.options.beforeStorageChange?.()
      let backupDir: string | undefined
      let databaseBackup: string | undefined
      const databasePath = plan.args.db === true ? resolveSqlitePath(config, this.cwd, this.home) : undefined
      const roleTargets = targets.filter(path => path !== databasePath && path !== `${databasePath}-wal` && path !== `${databasePath}-shm`)
      try {
        backupDir = this.backup(roleTargets)
        if (databasePath && existsSync(databasePath)) await withSQLiteMaintenance([databasePath], async token => {
          if (inspectSQLiteEpoch(databasePath).retiredTo) throw new Error('restart_required: This SQLite source was migrated; reload current configuration before reset.')
          const driver = new SQLiteDriver(databasePath, false, token)
          try {
            await driver.transaction(async () => {
              const db = new HarnessDB(driver, config, this.home)
              databaseBackup = this.backupJson(await db.exportJson(), 'reset-snapshot')
              for (const table of ['task_repairs','task_health_runs','action_sections','actions','task_acceptance','tasks']) await driver.exec(`DELETE FROM ${table}`)
            })
            changeSQLiteEpoch(databasePath, token)
          } finally { await driver.close() }
        })
        for (const path of roleTargets) rmSync(path, { force: true })
      } finally { await this.options.afterStorageChange?.() }
      return success(operation, { removed: roleTargets, databaseCleared: !!databasePath, databasePath, databaseBackup, backupDir }, databasePath ? ['SQLite rows were cleared transactionally; the DB inode remains intact to protect native connections.'] : undefined)

    }
    return this.migrateStorage(config, plan)
  }
  private async migrateProvider(plan: MaintenancePlan, config: HarnessConfig): Promise<MaintenanceOutcome> {
    const target = plan.args.to as Provider
    if (target === config.provider) return success('migrate.provider.apply', { alreadyCurrent: true })
    const pref = this.preferences(plan.args, target)
    if (!pref.ok) return { ...pref, operation: 'migrate.provider.apply' }
    const next = { ...config, provider: target, agentPreferences: { ...config.agentPreferences, [target]: { ...config.agentPreferences?.[target], ...(pref.data?.preferences as AgentModelPreferences | undefined)?.[target] } } }
    if (['claude-code', 'codex-cli', 'cursor', 'opencode-v2'].includes(target)) {
      const missing = missingPreferenceRoles(next)
      if (missing.length) return failure('migrate.provider.apply', 'needs_input', 'Target requires explicit native choices.', missing.map(role => `choices.${role}`))
    }
    if (config.provider === 'opencode-v2' && target === 'opencode') return failure('migrate.provider.apply', 'recovery_required', 'V1 shares V2 paths. Restore the verified pre-migration backup as documented before selecting OpenCode V1; native V2 settings are not converted automatically.')
    const oldPlugin = target === 'opencode-v2' ? await inspectOpenCodeNotificationPlugin(this.cwd, 'opencode') : undefined
    const targetPlugin = target === 'opencode-v2' ? await inspectOpenCodeNotificationPlugin(this.cwd, 'opencode-v2') : undefined
    for (const [version, plugin] of [['v1', oldPlugin], ['v2', targetPlugin]] as const) {
      if (plugin && ((plugin.present && !plugin.owned) || (plugin.manifestPresent && !plugin.manifestValid))) return failure('migrate.provider.apply', 'custom_plugin_conflict', `Customized or incompatible ${version} notification plugin/ownership preserved. Resolve it before switching shared OpenCode paths.`)
    }
    const shared = target === 'opencode-v2' ? preflightOpenCodeV2(next, this.cwd, config.provider === 'opencode') : undefined
    const configPath = findConfigFile(this.cwd)
    const backupDir = this.backup([...this.generatedFiles(config), ...this.generatedFiles(next), ...(configPath ? [configPath] : [])])
    const recovery = 'Review later edits and restore only affected AHK files and the previous provider overlay from this backup; do not reverse-convert unrelated OpenCode settings. Multi-file generation is not atomic.'
    const failedAfterBackup = (code: string, message: string): MaintenanceOutcome => ({ ...failure('migrate.provider.apply', code, message), data: { backupDir, recovery, previousProvider: config.provider, targetProvider: target }, notices: [recovery] })
    try {
      if (oldPlugin?.present) { const removed = await uninstallNotificationHooks(this.cwd, 'opencode'); if (!removed.ok || removed.value.preserved.length) return failedAfterBackup('hook_conflict', 'Could not retire the owned v1 notification plugin.') }
      if (shared) {
        writeOpenCodeV2Config(shared.prepared)
        if (shared.converted.length) writeAgentFiles(this.cwd, opencodeV2AgentFiles(next, choicesFromPreferences(next).opencodeV2AgentModels).filter(entry => shared.converted.includes(entry.relPath)), { force: true, backupRoot: join(this.cwd, config.storage.dir, 'backups') })
      }
      const report = await getMaterializer(target).build(next, this.cwd, { force: plan.args.force === true && !shared, ...choicesFromPreferences(next) })
      if (oldPlugin?.present) { const installed = await installNotificationHooks(this.cwd, 'opencode-v2', { node: process.execPath, cli: notificationCliPath() }); if (!installed.ok || installed.value.preserved.length) return failedAfterBackup('hook_install_failed', 'Could not install v2 notifications; recover the prior setup from the maintenance backup before retrying.') }
      const saved = await updateManagedConfig(this.cwd, { provider: target, ...(pref.data?.preferences ? { agentPreferences: pref.data.preferences } : {}) })
      if (!saved.ok) return failedAfterBackup(saved.error.code, saved.error.message)
      return success('migrate.provider.apply', { provider: target, report, backupDir }, backupDir ? [recovery] : undefined)
    } catch (error) {
      return failedAfterBackup('operation_failed', error instanceof Error ? error.message : String(error))
    }
  }

  private specChanges(config: HarnessConfig) {
    return fileTree(this.cwd, resolve(this.cwd, config.project.docsPath, 'specs')).filter(path => path.endsWith('.md')).flatMap(path => {
      const before = readFileSync(path, 'utf8')
      const header = before.match(/^(---\r?\n)([\s\S]*?)(\r?\n---(?:\r?\n|$))/)
      if (!header) return []
      const migrated = header[2].replace(/^(spec_kind:[ \t]*)use-case([ \t]*)$/m, '$1spec$2').replace(/^(spec_kind:[ \t]*)technical([ \t]*)$/m, '$1spec-tech$2')
      return migrated === header[2] ? [] : [{ path, after: `${header[1]}${migrated}${header[3]}${before.slice(header[0].length)}` }]
    })
  }
  private resetTargets(config: HarnessConfig, args: Record<string, unknown>): string[] {
    if (args.db !== true && !Array.isArray(args.targets) && !args.provider) throw new Error('Reset requires explicit database=true and/or roles selection.')
    const files: string[] = []
    if (args.db === true) {
      if (config.database.type !== 'sqlite') throw new Error('Remote database reset is unsupported; no remote data deleted.')
      const path = resolveSqlitePath(config, this.cwd, this.home)
      files.push(path, `${path}-wal`, `${path}-shm`)
    }
    const provider = (args.provider ?? config.provider) as Provider
    if (!PROVIDERS.includes(provider)) throw new Error('Invalid reset provider.')
    const sharedOpenCode = provider === 'opencode' || provider === 'opencode-v2'
    if (sharedOpenCode && (config.provider === 'opencode' || config.provider === 'opencode-v2') && provider !== config.provider) throw new Error(`Shared OpenCode provider mismatch: workspace is ${config.provider}; refusing reset as ${provider}.`)
    for (const role of (args.targets as string[] | undefined) ?? (args.provider ? ROLES : [])) {
      if (!ROLES.includes(role as typeof ROLES[number])) throw new Error(`Unknown reset role: ${role}`)
      const path = safePath(this.cwd, join(this.cwd, providerRoot(provider), 'agents', nativeAgentFilename(provider, role)))
      if (sharedOpenCode && existsSync(path) && provider === 'opencode') {
        const header = readFileSync(path, 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? ''
        if (/^permissions:/m.test(header)) throw new Error(`Shared OpenCode agent ${role} is V2 content; refusing reset as V1.`)
      }
      if (sharedOpenCode && (provider === 'opencode-v2' || config.provider === 'opencode-v2') && existsSync(path)) { const expected = opencodeV2AgentFiles(config).find(entry => entry.relPath.endsWith(`/${role}.md`)); if (readFileSync(path, 'utf8') !== expected?.content) throw new Error(`Preserving customized shared OpenCode agent: ${role}`) }
      files.push(path)
    }
    return files.filter(existsSync)
  }
  private async inspectSqlite(path: string): Promise<Record<string, unknown>> {
    if (!existsSync(path)) return { path, exists: false, counts: {}, stamp: null }
    safePath(path.startsWith(resolve(this.cwd) + '/') ? this.cwd : this.home, path)
    // SQLite read-only handles can still alter/create shared-memory sidecars in WAL mode.
    // Inspect a bounded disk snapshot instead; the source and all its sidecars stay byte-identical.
    const scratch = mkdtempSync(join(tmpdir(), 'ahk-storage-inspection-'))
    const snapshot = join(scratch, 'inspect.db')
    try {
      const sources = [path, `${path}-wal`, `${path}-shm`].filter(existsSync)
      const before = sources.map(p => [p, statSync(p).size, statSync(p).mtimeMs])
      if (sources.reduce((sum, p) => sum + statSync(p).size, 0) > 1024 * 1024 * 1024) throw new Error('Read-only storage inspection exceeds 1 GiB snapshot bound; use native database diagnostics/migration.')
      for (const source of sources) copyFileSync(source, `${snapshot}${source.slice(path.length)}`)
      const after = sources.map(p => [p, statSync(p).size, statSync(p).mtimeMs])
      if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('concurrent_edit: database changed during read-only inspection. Retry the plan.')
      const result = await this.inspectSqliteDriver(snapshot, new SQLiteDriver(snapshot, true))
      return { ...result, path, stamps: before, ownership: inspectSQLiteEpoch(path) }
    } finally { rmSync(scratch, { recursive: true, force: true }) }
  }

  private async inspectSqliteDriver(path: string, driver: SQLiteDriver): Promise<Record<string, unknown>> {
    try {
      const tables = await driver.query<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      const counts: Record<string, number> = {}
      for (const table of tables) if (['tasks', 'task_acceptance', 'actions', 'action_sections', 'task_health_runs', 'task_repairs'].includes(table.name)) counts[table.name] = Number((await driver.queryOne<{ n: number }>(`SELECT COUNT(*) n FROM ${table.name}`))?.n ?? 0)
      const stamps = [path, `${path}-wal`].map(p => existsSync(p) ? [p, statSync(p).size, statSync(p).mtimeMs] : [p, null])
      return { path, exists: true, counts, tables: tables.map(t => t.name), stamps }
    } finally { await driver.close() }
  }
  private async storagePreview(config: HarnessConfig): Promise<Record<string, unknown>> {
    const state = readStorageStateFile(this.cwd, config.storage.dir)
    const sqlitePath = config.storage.scope === 'local' ? config.storage.sqlitePath ?? '.harness/harness.db' : '.harness/harness.db'
    const local = resolveSqlitePathForScope('local', sqlitePath, this.cwd, config, this.home)
    const global = resolveSqlitePathForScope('global', sqlitePath, this.cwd, config, this.home)
    const candidates = await Promise.all([this.inspectSqlite(local), this.inspectSqlite(global)])
    let remoteDestination: Record<string, unknown> | undefined
    if (config.database.type !== 'sqlite') {
      const destination = config.database.type === 'postgres' ? new (await import('@/core/drivers/postgres')).PostgresDriver(config.database) : new (await import('@/core/drivers/mysql')).MySQLDriver(config.database)
      try {
        const tables = await destination.query<{ name: string }>(config.database.type === 'postgres' ? "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = current_schema()" : "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE()")
        const counts: Record<string, number> = {}
        for (const table of tables) if (['tasks', 'task_acceptance', 'actions', 'action_sections', 'task_health_runs', 'task_repairs'].includes(table.name)) counts[table.name] = Number((await destination.queryOne<{ n: number }>(`SELECT COUNT(*) n FROM ${table.name}`))?.n ?? 0)
        remoteDestination = { type: config.database.type, tables: tables.map(t => t.name), counts }
      } finally { await destination.close() }
    }
    return { sourceState: state, destinationScope: config.storage.scope, destinationType: config.database.type, candidates, remoteDestination, limitations: ['Previous remote credentials are not retained: automatic remote-source migration is unsupported.', 'Source SQLite is retained and old AHK configurations are fenced after verified migration. Stop external native writers; this is a snapshot, not continuous replication. Remote destructive overwrite requires native coordination and is unsupported.'] }
  }
  private async migrateStorage(config: HarnessConfig, plan: MaintenancePlan): Promise<MaintenanceOutcome> {
    const preview = await this.storagePreview(config)
    const state = preview.sourceState as { scope: 'local' | 'global'; dbType: string } | null
    if (state && state.dbType !== 'sqlite') return failure('migrate.storage.apply', 'unsupported_source', 'Cannot reconnect previous remote source without retained credentials.')
    const candidates = preview.candidates as { path: string; exists: boolean; counts: Record<string, number> }[]
    const populated = candidates.filter(c => Object.values(c.counts).some(n => n > 0))
    if (!state && populated.length > 1 && !plan.args.source) return failure('migrate.storage.apply', 'needs_input', 'BOTH candidate locations have data. Create a fresh storage plan with source set to the chosen inspected candidate path; refusing to guess.', ['source'])
    if (plan.args.source && !candidates.some(c => c.path === resolve(this.cwd, String(plan.args.source)))) return failure('migrate.storage.apply', 'invalid_source', 'source must identify an inspected local/global candidate.')
    const explicitSource = plan.args.source ? candidates.find(c => c.path === resolve(this.cwd, String(plan.args.source))) : undefined
    const sourceScope = explicitSource ? (explicitSource === candidates[0] ? 'local' : 'global') : state?.scope ?? (populated.length === 1 ? (populated[0] === candidates[0] ? 'local' : 'global') : config.storage.scope)
    const source = candidates[sourceScope === 'local' ? 0 : 1].path
    const destination = config.database.type === 'sqlite' ? resolveSqlitePath(config, this.cwd, this.home) : null
    if (plan.args.destination && (!destination || resolve(this.cwd, String(plan.args.destination)) !== destination)) return failure('migrate.storage.apply', 'invalid_destination', 'destination must match configured storage; choose scope in a fresh plan.')
    if (source === destination && existsSync(source) && inspectSQLiteEpoch(source).retiredTo) return failure('migrate.storage.apply', 'restart_required', 'This retained source has migrated; reload current project configuration.')
    if (source === destination && existsSync(source)) {
      await this.jobs.dispose()
      await this.options.beforeStorageChange?.()
      try {
        if (plan.args.scope) {
          const saved = await updateManagedConfig(this.cwd, { storage: { scope: config.storage.scope } })
          if (!saved.ok) return failure('migrate.storage.apply', saved.error.code, saved.error.message)
        }
        return success('migrate.storage.apply', { alreadyCurrent: true, configReconciled: !!plan.args.scope, scope: config.storage.scope })
      } finally { await this.options.afterStorageChange?.() }
    }
    await this.jobs.dispose()
    await this.options.beforeStorageChange?.()
    try {
      return await withSQLiteMaintenance(destination ? [source, destination] : [source], async token => {
        const sourceDriver = existsSync(source) ? new SQLiteDriver(source, false, token) : undefined
        const run = async () => {
          const data = sourceDriver ? await new HarnessDB(sourceDriver, config, this.home).exportJson() : undefined
          const sourceBackup = data ? this.backupJson(data, 'source-snapshot') : undefined
          if (destination) {
            const targetDriver = new SQLiteDriver(destination, false, token)
            try {
              const result = await targetDriver.transaction(async () => {
                // Backup existing workflow data in the same SQLite write-locked snapshot before schema/import changes.
                const existing = await targetDriver.query<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table'")
                const tableNames = new Set(existing.map(t => t.name))
                const target = new HarnessDB(targetDriver, config, this.home)
                let destinationBackup: string | undefined
                if (tableNames.has('tasks')) {
                  const rows = await targetDriver.queryOne<{ n: number }>('SELECT COUNT(*) n FROM tasks')
                  const allCounts = await Promise.all(['task_acceptance','actions','action_sections','task_health_runs','task_repairs'].filter(t => tableNames.has(t)).map(async table => Number((await targetDriver.queryOne<{ n: number }>(`SELECT COUNT(*) n FROM ${table}`))?.n ?? 0)))
                  if ((Number(rows?.n ?? 0) > 0 || allCounts.some(n => n > 0)) && plan.args.force !== true) return failure('migrate.storage.apply', 'needs_input', 'Destination already has data. Explicit --force is required.', ['force'])
                  destinationBackup = this.backupJson(await target.exportJson(), '0-pre-migrate-destination')
                }
                await targetDriver.ensureSchema()
                if (data) await target.importFullExport(data, 'sqlite', { truncateFirst: true })
                const counts = await target.getRowCounts()
                this.verifyExportCounts(data, counts)
                return success('migrate.storage.apply', { source, sourceRetained: true, destination, sourceBackup, destinationBackup, counts }, ['Source SQLite is retained for recovery; stale AHK configurations are fenced. Stop external native writers before migration; this is a snapshot, not continuous replication.'])
              })
              if (!result.ok) return result
              if (plan.args.scope) { const saved = await updateManagedConfig(this.cwd, { storage: { scope: config.storage.scope } }); if (!saved.ok) throw new Error(saved.error.message) }
              await new HarnessDB(targetDriver, config, this.home).writeStorageState(this.cwd)
              changeSQLiteEpoch(destination, token)
              if (source !== destination && sourceDriver) changeSQLiteEpoch(source, token, destination)
              return result
            } finally { await targetDriver.close() }
          }
          const remoteCounts = (preview.remoteDestination as { counts: Record<string, number> } | undefined)?.counts ?? {}
          const nonempty = Object.values(remoteCounts).some(n => n > 0)
          if (nonempty && plan.args.force !== true) return failure('migrate.storage.apply', 'needs_input', 'Destination already has data. Explicit --force required.', ['force'])
          // Remote maintenance requires a DB-native barrier we cannot prove with a filesystem lease.
          // Preserve source and refuse a destructive overwrite; an empty destination import remains transactional.
          if (nonempty) return failure('migrate.storage.apply', 'unsupported_destination', 'Concurrent-safe remote destination overwrite requires native DB maintenance coordination; export and quiesce it manually. Source retained.')
          const target = await openDB(config, this.cwd, this.home)
          try {
            if (data) await target.importFullExport(data, config.database.type, { truncateFirst: false })
            const counts = await target.getRowCounts(); this.verifyExportCounts(data, counts)
            await target.writeStorageState(this.cwd)
            if (sourceDriver) changeSQLiteEpoch(source, token, config.database.type)
            return success('migrate.storage.apply', { source, sourceRetained: true, destination: config.database.type, sourceBackup, counts }, ['Source SQLite is retained. Stop native writers before switching; old AHK source configurations require reload.'])
          } finally { await target.close() }
        }
        try { return sourceDriver ? await sourceDriver.transaction(run) : await run() }
        finally { await sourceDriver?.close() }
      })
    } finally { await this.options.afterStorageChange?.() }
  }
  private verifyExportCounts(data: FullExport | undefined, counts: Record<string, number>): void {
    if (!data) return
    const expected = { tasks: data.tasks.length, task_acceptance: data.taskAcceptance.length, actions: data.actions.length, action_sections: data.sections.length, task_health_runs: data.healthRuns.length, task_repairs: data.repairs.length }
    for (const [table, count] of Object.entries(expected)) if (counts[table] !== count) throw new Error(`Migration verification failed: ${table}`)
  }

  private backupJson(data: FullExport, label: string): string {
    const path = safePath(this.cwd, join(this.cwd, '.harness', 'backups', `${label}-${randomUUID()}.json`))
    mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(data), { flag: 'wx', mode: 0o600 }); return path
  }
  private async exportData(args: Record<string, unknown>): Promise<MaintenanceOutcome> {
    if (args.format !== 'json') return failure('export', 'unsupported_format', 'SQL dump requires direct native database access. Select format=json.', ['format'])
    const config = await this.config()
    const path = safePath(this.cwd, resolve(this.cwd, String(args.output ?? `.harness/exports/${randomUUID()}.json`)))
    if (existsSync(path) && args.force !== true) return failure('export', 'output_exists', 'Output already exists; explicit force required.')
    const backupDir = existsSync(path) ? this.backup([path]) : undefined
    const db = await openDB(config, this.cwd, this.home)
    try {
      const data = await db.exportJson()
      mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 })
      return success('export', { path, bytes: statSync(path).size, backupDir })
    } finally { await db.close() }
  }
  private async status(args: Record<string, unknown>): Promise<MaintenanceOutcome> {
    const config = await this.config()
    const db = await openDB(config, this.cwd, this.home)
    try {
      const limit = Math.min(100, Math.max(1, Number(args.limit) || 25))
      const offset = Math.max(0, Number(args.offset) || 0)
      const page = await db.tasks.getStatusPage(limit, offset, args.archived === true)
      const total = await db.tasks.countStatusTasks(args.archived === true)
      const tasks = await Promise.all(page.map(async task => ({ ...task,
        acceptance: await db.tasks.getAcceptancePage(task.id),
        actions: await db.listActionsForTask(task.id, { status: 'in_progress', limit: 20 }),
      })))
      return success('status', { provider: config.provider, storageScope: config.storage.scope, database: { type: config.database.type, connected: true }, tasks, summary: await db.getStatusSummary(), archivedCount: await db.tasks.countStatusTasks(true), total, nextOffset: offset + limit < total ? offset + limit : null })

    } finally { await db.close() }
  }
  private async health(): Promise<MaintenanceOutcome> {
    const config = await this.config()
    const root = providerRoot(config.provider)
    const checks = ROLES.map(role => ({ path: join(root, 'agents', nativeAgentFilename(config.provider, role)), ok: existsSync(join(this.cwd, root, 'agents', nativeAgentFilename(config.provider, role))) }))
    const dbPath = config.database.type === 'sqlite' ? resolveSqlitePath(config, this.cwd, this.home) : null
    if (dbPath) checks.push({ path: dbPath, ok: existsSync(dbPath) })
    const mcp = config.provider === 'opencode-v2' ? relative(this.cwd, inspectOpenCodeConfig(this.cwd).path) : ({ 'claude-code': '.mcp.json', opencode: 'opencode.json', 'opencode-v2': 'opencode.json', 'codex-cli': '.codex/config.toml', 'grok-cli': '.grok/config.toml', cursor: '.cursor/mcp.json' })[config.provider]
    if (config.tools.mcp.enabled) checks.push({ path: mcp, ok: existsSync(join(this.cwd, mcp)) })
    const inspection = inspectHealthCheck(this.cwd, config.health.scriptPath)
    if (checks.some(c => !c.ok) || inspection.state !== 'ready') return { ...failure('health', 'health_failed', `Workspace health prerequisites failed (${inspection.state}).`), data: { checks, inspection } }
    const result = await this.runHealth(inspection.path)
    return { ok: result.status === 0, operation: 'health', code: result.status === 0 ? 'ok' : 'health_failed', data: { checks, ...result }, message: result.status === 0 ? 'Workspace health passed; this stateless run does not authorize task completion.' : 'Workspace health failed.' }
  }
  private runHealth(path: string): Promise<{ status: number | null; signal: string | null; logPath: string; tail: string }> {
    const logPath = safePath(this.cwd, join(this.cwd, '.harness', 'health-logs', `${randomUUID()}.log`))
    mkdirSync(dirname(logPath), { recursive: true })
    return new Promise((resolveRun, reject) => {
      const { command, args, options } = healthCommand(path)
      const child = spawn(command, args, { ...options, cwd: this.cwd, stdio: ['ignore', 'pipe', 'pipe'] })
      let tail = ''
      writeFileSync(logPath, '', { mode: 0o600 })
      const collect = (chunk: Buffer) => { appendFileSync(logPath, chunk); tail = (tail + chunk.toString()).slice(-12000); /* output stays bounded in memory */ }
      child.stdout?.on('data', collect); child.stderr?.on('data', collect)
      const timeout = setTimeout(() => child.kill('SIGKILL'), 120_000)
      child.once('error', error => { clearTimeout(timeout); reject(error) })
      child.once('close', (status, signal) => { clearTimeout(timeout); resolveRun({ status, signal, logPath, tail }) })
    })
  }
  private async job(operation: string, args: Record<string, unknown>): Promise<MaintenanceOutcome> {
    const [kind, command] = operation.split('.') as ['watch' | 'dashboard', string]
    if (command === 'status') return success(operation, { jobs: this.jobs.status(kind) })
    if (command === 'stop') { await this.jobs.stop(kind); return success(operation, { jobs: this.jobs.status(kind) }) }
    if (command !== 'start') return failure(operation, 'unsupported_operation', 'Unknown managed job operation.')
    const current = this.jobs.active(kind)
    if (current) return success(operation, { job: current, alreadyRunning: true })
    const config = await this.config()
    if (kind === 'watch') {
      let timer: ReturnType<typeof setTimeout> | undefined
      let jobId = ''
      const watcher = watch(this.cwd, (_event, name) => {
        if (!name?.startsWith('agent-harness-kit.config')) return
        clearTimeout(timer)
        timer = setTimeout(() => { void this.execute('build', {}).then(result => { if (!result.ok) { watcher.close(); this.jobs.fail(jobId, result.message ?? result.code) } }) }, 100)
      })
      const job = this.jobs.register(kind, { force: false, path: this.cwd }, async () => { clearTimeout(timer); watcher.close() }); jobId = job.id
      watcher.on('error', error => { clearTimeout(timer); watcher.close(); this.jobs.fail(job.id, error.message) })
      return success(operation, { job })
    }
    const db = await openDB(config, this.cwd, this.home)
    try {
      const dist = typeof __dirname === 'string' ? __dirname : dirname(fileURLToPath(import.meta.url))
      const staticPath = [join(dist, 'dashboard-dist'), join(dist, '../../dashboard-dist')].find(p => existsSync(join(p, 'index.html')))
      if (!staticPath) { await db.close(); return failure(operation, 'assets_missing', 'Packaged dashboard assets are missing.') }
      const server = await startDashboardServer(db, config.database.type === 'sqlite' ? resolveSqlitePath(config, this.cwd, this.home) : null, staticPath, Number(args.port) || 3743, () => {})
      const job = this.jobs.register(kind, { url: server.url }, async () => { await server.close(); await db.close() })
      if (args.open === true) { const { default: open } = await import('open'); await open(server.url) }
      return success(operation, { job })
    } catch (error) { await db.close(); throw error }
  }
  private async captureModels(config: HarnessConfig): Promise<MaintenanceOutcome> {
    if (!['claude-code', 'codex-cli', 'cursor', 'opencode-v2'].includes(config.provider)) return failure('sync', 'unsupported_provider', 'Native model capture is unavailable for this provider.')
    const { choices, missing } = captureNativeChoices(this.cwd, config)
    if (missing.length) return failure('sync', 'needs_input', 'Some native model metadata is missing or invalid; no preferences changed.', missing.map(role => `choices.${role}`))
    const saved = await updateManagedConfig(this.cwd, { agentPreferences: toPreferences(config.provider, choices) })
    return saved.ok ? success('sync', { captured: Object.keys(choices), missing }) : failure('sync', saved.error.code, saved.error.message)
  }
}
