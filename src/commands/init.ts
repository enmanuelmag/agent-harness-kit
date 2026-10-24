import * as p from '@clack/prompts'
import pc from 'picocolors'

import { findConfigFile } from '@/core/config'
import { getDefaultHealthScriptPath } from '@/core/health-check'
import { MaintenanceService } from '@/core/maintenance/operations'
import { initDescriptionSchema, initDocsSchema, initNameSchema } from '@/schema/init'
import { taskDescriptionSchema, taskTitleSchema } from '@/schema/task'
import { cliFormWithRetry } from '@/utils/form'

import { mergePreferences, toPreferences } from './agent-preferences'
import { promptClaudeAgentModels } from './claude-model-prompt'
import { promptCodexAgentModels } from './codex-model-prompt'
import { promptCursorAgentModels } from './cursor-model-prompt'
import {
  detectConfigExtension,
  drawBox,
  printWelcomeMessage,
  readProjectNameFromPackageJson,
} from './init-helpers'
import { promptOpenCodeV2AgentModels } from './opencode-v2-model-prompt'

import type { Provider } from '@/types'

export interface InitOptions {
  notifications?: boolean
  notificationHooks?: boolean
  notificationScope?: 'project' | 'global'
  name?: string
  provider?: string
  docs?: string
  tasks?: string
  storageScope?: string
}

type StorageScope = 'local' | 'global'

const STORAGE_SCOPE_PROMPT: {
  message: string
  options: { value: StorageScope; label: string }[]
  initialValue: StorageScope
} = {
  message: 'Storage scope',
  options: [
    { value: 'local', label: 'Local — .harness/harness.db lives in this project' },
    {
      value: 'global',
      label: 'Global — DB lives under ~/.harness/dbs/<projectId>/, outside the project',
    },
  ],
  initialValue: 'global',
}

export type StorageScopeSelect = (
  options: typeof STORAGE_SCOPE_PROMPT
) => Promise<StorageScope | symbol>

export async function resolveStorageScope(
  requestedScope: string | undefined,
  select: StorageScopeSelect
): Promise<StorageScope | symbol> {
  if (requestedScope && ['local', 'global'].includes(requestedScope)) {
    return requestedScope as StorageScope
  }

  return select(STORAGE_SCOPE_PROMPT)
}

export async function runInit(cwd: string, flags: InitOptions): Promise<void> {
  const existingConfig = findConfigFile(cwd)
  if (existingConfig) {
    console.log(
      pc.yellow('⚠') +
        ' ' +
        pc.bold('Project already initialized.') +
        pc.dim(` (${existingConfig})`)
    )
    console.log()
    console.log(pc.dim('Suggested next steps:'))
    console.log(
      '  ' +
        pc.cyan('ahk build') +
        pc.dim('         — re-sync agent files after updating the library')
    )
    console.log(
      '  ' + pc.cyan('ahk sync') + pc.dim('         — safely refresh generated files and skills')
    )
    console.log(
      '  ' + pc.cyan('ahk reset') + pc.dim('         — wipe and re-initialize from scratch')
    )
    console.log('  ' + pc.cyan('ahk dashboard') + pc.dim('         — open the harness dashboard'))
    process.exit(0)
  }

  const detectedName = flags.name ?? readProjectNameFromPackageJson(cwd)
  const projectName = detectedName || 'my-project'
  printWelcomeMessage(projectName)

  // ─── Project name ────────────────────────────────────────────────────────
  let name: string
  if (flags.name) {
    name = flags.name
  } else {
    name = await cliFormWithRetry(async () => {
      const val = await p.text({
        message: 'Project name',
        placeholder: 'my-app',
        ...(detectedName && { initialValue: detectedName }),
      })
      if (p.isCancel(val)) {
        p.cancel('Cancelled.')
        process.exit(0)
      }
      return val as string
    }, initNameSchema)
  }

  // ─── Description ─────────────────────────────────────────────────────────
  const description = await cliFormWithRetry(async () => {
    const val = await p.text({
      message: 'Short description (shown to agents as context)',
      placeholder: 'A REST API for managing notes',
    })
    if (p.isCancel(val)) {
      p.cancel('Cancelled.')
      process.exit(0)
    }
    return val as string
  }, initDescriptionSchema)

  // ─── Provider ─────────────────────────────────────────────────────────────
  let provider: Provider
  if (
    flags.provider &&
    ['claude-code', 'opencode', 'opencode-v2', 'codex-cli', 'grok-cli', 'cursor'].includes(flags.provider)
  ) {
    provider = flags.provider as Provider
  } else {
    const val = await p.select({
      message: 'AI provider',
      options: [
        { value: 'opencode', label: 'OpenCode' },
        { value: 'opencode-v2', label: 'OpenCode V2' },
        { value: 'claude-code', label: 'Claude Code' },
        { value: 'codex-cli', label: 'Codex CLI' },
        { value: 'grok-cli', label: 'Grok CLI' },
        { value: 'cursor', label: 'Cursor (Agent Window and CLI)' },
      ],
    })
    if (p.isCancel(val)) {
      p.cancel('Cancelled.')
      process.exit(0)
    }
    provider = val satisfies Provider
  }

  // Claude Code only: prompt once per generated role (lead, explorer,
  // consultant, builder, reviewer) for a model preference, defaulting to
  // 'inherit' (no override). The choice is written straight into that role's
  // generated `.claude/agents/<role>.md` frontmatter at scaffold time — never
  // into config (the old `config.agents.<role>.model` mechanism stays
  // removed). OpenCode is unaffected — it has no closed model enum to prompt
  // against.
  //
  // The prompt loop itself lives in `promptClaudeAgentModels` (shared with
  // `ahk models` and `ahk build --force`, which also re-run it to update an
  // existing project's agent files — see claude-code.ts).
  const claudeAgentModels = await promptClaudeAgentModels(provider)

  // Codex CLI only: prompt once per generated role for a model AND a
  // reasoning-effort preference. Each choice is written into its generated
  // `.codex/agents/<role>.toml`; the explicit lead selection is also used as
  // the project default in `.codex/config.toml`. OpenCode and Grok Build are
  // unaffected — same rationale as above.
  //
  // The prompt loop itself lives in `promptCodexAgentModels`
  // (codex-model-prompt.ts), mirroring `promptClaudeAgentModels`'s shape and
  // cancel-handling.
  const codexAgentModels = await promptCodexAgentModels(provider)
  const cursorAgentModels = await promptCursorAgentModels(provider)
  const opencodeV2AgentModels = await promptOpenCodeV2AgentModels(provider)
  const agentPreferences = mergePreferences(toPreferences(provider, opencodeV2AgentModels), mergePreferences(
    {},
    mergePreferences(
      toPreferences(provider, claudeAgentModels),
      mergePreferences(
        toPreferences(provider, codexAgentModels),
        toPreferences(provider, cursorAgentModels)
      )
    )
  ))

  // ─── Docs path ────────────────────────────────────────────────────────────
  let docsPath: string
  if (flags.docs) {
    docsPath = flags.docs
  } else {
    docsPath = await cliFormWithRetry(async () => {
      const val = await p.text({
        message: 'Docs folder path (agents will search here)',
        initialValue: './docs',
      })
      if (p.isCancel(val)) {
        p.cancel('Cancelled.')
        process.exit(0)
      }
      return val as string
    }, initDocsSchema)
  }

  // ─── Storage scope ────────────────────────────────────────────────────────
  const storageScopeResult = await resolveStorageScope(flags.storageScope, p.select)
  if (p.isCancel(storageScopeResult)) {
    p.cancel('Cancelled.')
    process.exit(0)
  }
  const storageScope = storageScopeResult as StorageScope

  const notifications = flags.notifications ?? await p.confirm({message:'Enable local sound notifications?',initialValue:false})
  if (p.isCancel(notifications)) {p.cancel('Cancelled.');process.exit(0)}
  let notificationHooks: boolean | symbol = flags.notificationHooks ?? false
  if (flags.notificationHooks === undefined && provider !== 'grok-cli') {
    notificationHooks = await p.confirm({message:'Install managed notification hooks for this provider?',initialValue:false})
    if (p.isCancel(notificationHooks)) {p.cancel('Cancelled.');process.exit(0)}
  }

  // ─── Optional first task ──────────────────────────────────────────────────
  const addFirstTask = await p.confirm({ message: 'Add your first task now?', initialValue: false })
  if (p.isCancel(addFirstTask)) {
    p.cancel('Cancelled')
    process.exit(0)
  }

  let firstTask: { title: string; description: string; acceptance: string[] } | undefined

  if (addFirstTask) {
    const taskTitle = await cliFormWithRetry(async () => {
      const val = await p.text({ message: 'Task title' })
      if (p.isCancel(val)) {
        p.cancel('Cancelled')
        process.exit(0)
      }
      return (val as string).trim()
    }, taskTitleSchema)

    const taskDesc = await cliFormWithRetry(async () => {
      const val = await p.text({ message: 'Task description', placeholder: 'What and why' })
      if (p.isCancel(val)) {
        p.cancel('Cancelled')
        process.exit(0)
      }
      return (val as string).trim()
    }, taskDescriptionSchema)

    const acceptance: string[] = []
    p.log.info('Acceptance criteria — one per line, empty line to finish')
    while (true) {
      const criterionVal = await p.text({
        message: '>',
        placeholder: 'Criterion (or press Enter to finish)',
      })
      if (p.isCancel(criterionVal) || !criterionVal || !(criterionVal as string).trim()) break
      acceptance.push((criterionVal as string).trim())
    }

    firstTask = { title: taskTitle, description: taskDesc, acceptance }
  }

  // ─── Scaffold ─────────────────────────────────────────────────────────────
  let configExt: 'json' | 'ts' | 'mjs' | 'cjs' = 'ts'
  const spinner = p.spinner()
  spinner.start('Scaffolding...')

  try {
    configExt = detectConfigExtension(cwd)
    const service = new MaintenanceService(cwd)
    try {
      const outcome = await service.execute('init', {
        name, description, provider, docs: docsPath, storageScope,
        choices: agentPreferences[provider], configFormat: configExt,
        notifications, notificationScope: flags.notificationScope ?? 'project',
        installHooks: notificationHooks, firstTask,
      })
      if (!outcome.ok) throw new Error(`${outcome.code}: ${outcome.message ?? ''}`)
    } finally { await service.dispose() }
    spinner.stop('')
  } catch (err) {
    spinner.stop('Failed')
    throw err
  }

  console.log(pc.green('✓ Scaffolded harness in current directory'))

  // ─── Summary ─────────────────────────────────────────────────────────────-
  const PROVIDER_SUMMARY_INFO: Record<Provider, { agentsDir: string; mcpFile: string }> = {
    'claude-code': { agentsDir: '.claude/agents/', mcpFile: '.mcp.json' },
    'opencode-v2': { agentsDir: '.opencode/agents/', mcpFile: './opencode.json(c)' },
    opencode: { agentsDir: '.opencode/agents/', mcpFile: './opencode.json' },
    'codex-cli': { agentsDir: '.codex/agents/', mcpFile: '.codex/config.toml' },
    'grok-cli': { agentsDir: '.grok/agents/', mcpFile: '.grok/config.toml' },
    cursor: { agentsDir: '.cursor/agents/', mcpFile: '.cursor/mcp.json' },
  }
  const { agentsDir, mcpFile } = PROVIDER_SUMMARY_INFO[provider]

  console.log('')
  console.log(pc.green(`✓ agent-harness-kit.config.${configExt}`))
  console.log(pc.green('✓ AGENTS.md'))
  console.log(pc.green(`✓ ${getDefaultHealthScriptPath()}`))
  console.log(
    pc.green(
      storageScope === 'global'
        ? '✓ ~/.harness/dbs/<projectId>/harness.db'
        : '✓ .harness/harness.db'
    )
  )
  console.log(pc.green('✓ .harness/storage-state.json'))
  console.log(pc.green(`✓ ${agentsDir}lead.md`))
  console.log(pc.green(`✓ ${agentsDir}explorer.md`))
  console.log(pc.green(`✓ ${agentsDir}builder.md`))
  console.log(pc.green(`✓ ${agentsDir}reviewer.md`))
  console.log(pc.green(`✓ ${mcpFile}`))
  console.log(pc.green('✓ .gitignore entries added'))

  console.log('')
  console.log(
    pc.cyan('→') +
      ` Replace the dummy checks in ${pc.cyan(getDefaultHealthScriptPath())} with your project checks`
  )
  console.log(pc.cyan('→') + ` ${pc.cyan('ahk task add')} to queue work for agents`)
  console.log(
    pc.cyan('→') +
      ` Enrich your docs with knowledge graphs: ${pc.cyan('https://github.com/safishamsi/graphify')}`
  )

  const recommendations: string[] = [
    `   Give a try to Heimdall MCP: Transparent proxy that traces every MCP tool call with OpenTelemetry.  `,
    `   Learn more: ${pc.cyan('https://github.com/enmanuelmag/heimdall-mcp')}                              `,
  ]

  console.log('')
  drawBox(recommendations)
}
