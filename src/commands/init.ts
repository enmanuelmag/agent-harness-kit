import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import * as p from '@clack/prompts'
import pc from 'picocolors'

import { openDB } from '@/core/db'
import { getMaterializer } from '@/core/materializer/index'
import { slugify } from '@/core/materializer/scaffold-utils'
import { configTs } from '@/core/materializer/templates'

import { applyConfigDefaults, printWelcomeMessage, readProjectNameFromPackageJson } from './init-helpers'

import type { Provider } from '@/types'

interface InitOptions {
  name?: string
  provider?: string
  docs?: string
  tasks?: string
}

export async function runInit(cwd: string, flags: InitOptions): Promise<void> {
  const detectedName = flags.name ?? readProjectNameFromPackageJson(cwd)
  const projectName = detectedName || 'my-project'
  printWelcomeMessage(projectName)

  // ─── Project name ────────────────────────────────────────────────────────
  let name: string
  if (flags.name) {
    name = flags.name
  } else {
    const val = await p.text({
      message: 'Project name',
      placeholder: 'my-app',
      validate: (v) => (v.trim() ? undefined : 'Project name is required'),
    })
    if (p.isCancel(val)) { p.cancel('Cancelled.'); process.exit(0) }
    name = val as string
  }

  // ─── Description ─────────────────────────────────────────────────────────
  const descVal = await p.text({
    message: 'Short description (shown to agents as context)',
    placeholder: 'A REST API for managing notes',
  })
  if (p.isCancel(descVal)) { p.cancel('Cancelled.'); process.exit(0) }
  const description = (descVal as string).trim() || name

  // ─── Provider ─────────────────────────────────────────────────────────────
  let provider: Provider
  if (flags.provider && ['claude-code', 'opencode'].includes(flags.provider)) {
    provider = flags.provider as Provider
  } else {
    const val = await p.select({
      message: 'AI provider',
      options: [
        { value: 'claude-code', label: 'Claude Code' },
        { value: 'opencode', label: 'OpenCode' },
      ],
    })
    if (p.isCancel(val)) { p.cancel('Cancelled.'); process.exit(0) }
    provider = val as Provider
  }

  // ─── Global installation option ──────────────────────────────────────────
  let globalInstallation = false
  const globalVal = await p.confirm({
    message: 'Install globally (to home directory)?',
    initialValue: false,
  })
  if (p.isCancel(globalVal)) { p.cancel('Cancelled.'); process.exit(0) }
  if (globalVal) {
    globalInstallation = true
  }

  // ─── Docs path ────────────────────────────────────────────────────────────
  let docsPath: string
  if (flags.docs) {
    docsPath = flags.docs
  } else {
    const val = await p.text({
      message: 'Docs folder path (agents will search here)',
      initialValue: './docs',
    })
    if (p.isCancel(val)) { p.cancel('Cancelled.'); process.exit(0) }
    docsPath = (val as string).trim() || './docs'
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
    if (p.isCancel(val)) { p.cancel('Cancelled'); process.exit(0) }
    tasksAdapter = val as string
  }

  // ─── Optional first task ──────────────────────────────────────────────────
  const addFirstTask = await p.confirm({ message: 'Add your first task now?', initialValue: true })
  if (p.isCancel(addFirstTask)) { p.cancel('Cancelled'); process.exit(0) }

  let firstTask: { title: string; description: string; acceptance: string[] } | undefined

  if (addFirstTask) {
    const titleVal = await p.text({
      message: 'Task title',
      validate: (v) => (v.trim() ? undefined : 'Title is required'),
    })
    if (p.isCancel(titleVal)) { p.cancel('Cancelled'); process.exit(0) }
    const taskTitle = (titleVal as string).trim()

    const taskDescVal = await p.text({
      message: 'Task description',
      placeholder: 'What and why',
    })
    if (p.isCancel(taskDescVal)) { p.cancel('Cancelled'); process.exit(0) }
    const taskDesc = (taskDescVal as string).trim()

    const acceptance: string[] = []
    p.log.info('Acceptance criteria — one per line, empty line to finish')
    while (true) {
      const criterionVal = await p.text({
        message: '>',
        placeholder: 'Criterion (or press Enter to finish)',
      })
      if (p.isCancel(criterionVal) || !(criterionVal as string).trim()) break
      acceptance.push((criterionVal as string).trim())
    }

    firstTask = { title: taskTitle, description: taskDesc, acceptance }
  }

  // ─── Scaffold ─────────────────────────────────────────────────────────────
  const spinner = p.spinner()
  spinner.start('Scaffolding...')

  try {
    const config = applyConfigDefaults({ name, description, provider, docsPath, tasksAdapter })
    const materializer = getMaterializer(provider)

    // Write config file - determine if we're installing globally
    let installDir = cwd
    if (globalInstallation) {
      if (provider === 'claude-code') {
        installDir = join(homedir(), '.claude')
      } else {
        installDir = join(homedir(), '.config', 'opencode')
      }
    }

    const configContent = configTs({
      name,
      description,
      provider,
      docsPath,
      tasksAdapter,
      port: config.tools.mcp.port,
    })
    writeFileSync(join(installDir, 'agent-harness-kit.config.ts'), configContent, 'utf8')

    // Create .harness dir
    mkdirSync(join(installDir, config.storage.dir), { recursive: true })

    // Initialize SQLite DB
    const db = openDB(config, installDir)

    // Scaffold provider-specific files
    await materializer.scaffold(config, { cwd: installDir, firstTask })

    // Seed first task into DB if provided
    if (firstTask) {
      const slug = slugify(firstTask.title)
      db.addTask({
        slug,
        title: firstTask.title,
        description: firstTask.description,
        acceptance: firstTask.acceptance,
      })
    }

    db.close()
    spinner.stop('')
  } catch (err) {
    spinner.stop('Failed')
    p.log.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }

  const agentHarnessKitDir = globalInstallation ? 'home directory' : 'current directory'
  console.log(pc.green(`✓ Scaffolded harness in ${agentHarnessKitDir}`))

  // ─── Summary ─────────────────────────────────────────────────────────────-
  const agentsDir = provider === 'claude-code' ? '.claude/agents/' : '.opencode/agents/'
  const mcpFile = provider === 'claude-code' ? '.claude/mcp.json' : './opencode.json'

  console.log('')
  console.log(pc.green('✓ agent-harness-kit.config.ts'))
  console.log(pc.green('✓ AGENTS.md'))
  console.log(pc.green('✓ health.sh'))
  console.log(pc.green('✓ .harness/harness.db'))
  console.log(pc.green('✓ .harness/current.md'))
  console.log(pc.green(`✓ ${agentsDir}lead.md`))
  console.log(pc.green(`✓ ${agentsDir}explorer.md`))
  console.log(pc.green(`✓ ${agentsDir}builder.md`))
  console.log(pc.green(`✓ ${agentsDir}reviewer.md`))
  console.log(pc.green(`✓ ${mcpFile}`))
  console.log(pc.green('✓ .gitignore entries added'))
  console.log('')
  console.log(pc.cyan('→') + ` Edit ${pc.cyan('health.sh')} with your project checks`)
  console.log(pc.cyan('→') + ` ${pc.cyan('ahk task add')} to queue work for agents`)
}
