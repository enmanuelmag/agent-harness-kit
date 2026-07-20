import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as p from '@clack/prompts'
import pc from 'picocolors'

import { findConfigFile } from '@/core/config'
import { openDB } from '@/core/db'
import { getMaterializer } from '@/core/materializer/index'
import { slugify } from '@/core/materializer/scaffold-utils'
import { configCjs, configJson, configMjs, configTs } from '@/core/materializer/templates'
import { initDescriptionSchema, initDocsSchema, initNameSchema } from '@/schema/init'
import { taskDescriptionSchema, taskTitleSchema } from '@/schema/task'
import { cliFormWithRetry } from '@/utils/form'

import {
  applyConfigDefaults,
  detectConfigExtension,
  drawBox,
  printWelcomeMessage,
  readProjectNameFromPackageJson,
} from './init-helpers'

import type { Provider } from '@/types'

interface InitOptions {
  name?: string
  provider?: string
  docs?: string
  tasks?: string
  storageScope?: string
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
    console.log('  ' + pc.cyan('ahk build --sync') + pc.dim('  — also sync agent permissions'))
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
  if (flags.provider && ['claude-code', 'opencode'].includes(flags.provider)) {
    provider = flags.provider as Provider
  } else {
    const val = await p.select({
      message: 'AI provider',
      options: [
        { value: 'opencode', label: 'OpenCode' },
        { value: 'claude-code', label: 'Claude Code' },
        { value: 'codex-cli', label: 'Codex CLI' },
      ],
    })
    if (p.isCancel(val)) {
      p.cancel('Cancelled.')
      process.exit(0)
    }
    provider = val satisfies Provider
  }

  // NOTE: init no longer prompts for a per-agent model. The generated agent
  // file is user-owned, so the model is set by editing its `model:` frontmatter
  // line (or `model = "..."` for Codex) directly — that is also where the role
  // prompt lives, so both per-agent settings are now in one place instead of
  // being split between the config and the file.

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
  let storageScope: 'local' | 'global'
  if (flags.storageScope && ['local', 'global'].includes(flags.storageScope)) {
    storageScope = flags.storageScope as 'local' | 'global'
  } else {
    const val = await p.select({
      message: 'Storage scope',
      options: [
        { value: 'local', label: 'Local — .harness/harness.db lives in this project' },
        {
          value: 'global',
          label: 'Global — DB lives under ~/.harness/dbs/<projectId>/, outside the project',
        },
      ],
      initialValue: 'local',
    })
    if (p.isCancel(val)) {
      p.cancel('Cancelled.')
      process.exit(0)
    }
    storageScope = val as 'local' | 'global'
  }

  // ─── Task adapter ─────────────────────────────────────────────────────────
  let tasksAdapter: string
  if (flags.tasks && ['local', 'jira', 'linear'].includes(flags.tasks)) {
    tasksAdapter = flags.tasks
  } else {
    const val = await p.select({
      message: 'Task adapter',
      options: [
        { value: 'local', label: 'Local (feature_list.json)' },
        { value: 'jira', label: 'Jira (coming soon)' },
        { value: 'linear', label: 'Linear (coming soon)' },
      ],
    })
    if (p.isCancel(val)) {
      p.cancel('Cancelled')
      process.exit(0)
    }
    tasksAdapter = val as string
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
    const config = applyConfigDefaults({
      name,
      description,
      provider,
      docsPath,
      tasksAdapter,
      scope: storageScope,
    })
    const materializer = getMaterializer(provider)

    const installDir = cwd

    configExt = detectConfigExtension(cwd)
    const configFileName = `agent-harness-kit.config.${configExt}`
    const templateFn =
      configExt === 'json'
        ? configJson
        : configExt === 'ts'
          ? configTs
          : configExt === 'mjs'
            ? configMjs
            : configCjs
    const configContent = templateFn({
      name,
      description,
      provider,
      docsPath,
      tasksAdapter,
      port: config.tools.mcp.port,
      scope: config.storage.scope,
      projectId: config.storage.projectId,
    })
    writeFileSync(join(installDir, configFileName), configContent, 'utf8')

    // Create .harness dir (always project-local, regardless of storage scope —
    // this is where health.sh, scripts, and storage-state.json live)
    mkdirSync(join(installDir, config.storage.dir), { recursive: true })

    // Initialize SQLite DB (scope-aware: local → .harness/harness.db, global → ~/.harness/dbs/<projectId>/harness.db)
    const db = await openDB(config, installDir)

    // Always write .harness/storage-state.json — reflects the REAL current
    // storage state (project-local regardless of scope). Consumed by the
    // future `ahk migrate storage` command.
    await db.writeStorageState(installDir)

    // Scaffold provider-specific files
    await materializer.scaffold(config, { cwd: installDir, firstTask })

    // Seed first task into DB if provided
    if (firstTask) {
      const slug = slugify(firstTask.title)
      await db.addTask({
        slug,
        title: firstTask.title,
        description: firstTask.description,
        acceptance: firstTask.acceptance,
      })
    }

    await db.close()
    spinner.stop('')
  } catch (err) {
    spinner.stop('Failed')
    p.log.error(err instanceof Error ? err.message : String(err))
    throw err
  }

  console.log(pc.green('✓ Scaffolded harness in current directory'))

  // ─── Summary ─────────────────────────────────────────────────────────────-
  const agentsDir = provider === 'claude-code' ? '.claude/agents/' : '.opencode/agents/'
  const mcpFile = provider === 'claude-code' ? '.claude/mcp.json' : './opencode.json'

  console.log('')
  console.log(pc.green(`✓ agent-harness-kit.config.${configExt}`))
  console.log(pc.green('✓ AGENTS.md'))
  console.log(pc.green('✓ health.sh'))
  console.log(
    pc.green(
      storageScope === 'global'
        ? '✓ ~/.harness/dbs/<projectId>/harness.db'
        : '✓ .harness/harness.db'
    )
  )
  console.log(
    pc.green(
      storageScope === 'global'
        ? '✓ ~/.harness/dbs/<projectId>/current.md'
        : '✓ .harness/current.md'
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
  console.log(pc.cyan('→') + ` Edit ${pc.cyan('health.sh')} with your project checks`)
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
