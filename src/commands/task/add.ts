import * as p from '@clack/prompts'
import pc from 'picocolors'

import { loadConfig } from '@/core/config'
import { openDB } from '@/core/db'
import { slugify } from '@/core/materializer/scaffold-utils'
import { taskDescriptionSchema, taskTitleSchema } from '@/schema/task'
import { cliFormWithRetry } from '@/utils/form'

export async function runTaskAdd(cwd: string): Promise<void> {
  p.intro(pc.bold('agent-harness-kit — add task'))

  const title = await cliFormWithRetry(async () => {
    const val = await p.text({ message: 'Task title' })
    if (p.isCancel(val)) {
      p.cancel('Cancelled.')
      process.exit(0)
    }
    return (val as string).trim()
  }, taskTitleSchema)

  const description = await cliFormWithRetry(async () => {
    const val = await p.text({
      message: 'Description (what and why)',
      placeholder:
        'Describe the task in more detail, including any relevant context or instructions for the agents.',
    })
    if (p.isCancel(val)) {
      p.cancel('Cancelled.')
      process.exit(0)
    }
    return (val as string).trim()
  }, taskDescriptionSchema)

  const acceptance: string[] = []
  p.log.info('Acceptance criteria — one per line, empty line to finish')
  while (true) {
    const val = await p.text({ message: '>', placeholder: 'Criterion (or press Enter to finish)' })
    if (p.isCancel(val) || !val || !(val as string).trim()) break
    acceptance.push((val as string).trim())
  }

  const spinner = p.spinner()
  spinner.start('Saving...')

  try {
    const config = await loadConfig(cwd)
    const db = await openDB(config, cwd)

    const slug = slugify(title)
    const task = await db.addTask({
      slug,
      title,
      description: description || undefined,
      acceptance,
    })
    await db.writeFeatureList(cwd)
    await db.close()

    spinner.stop('')
    console.log(pc.green(`✓ Task #${task.id} added — ${task.slug} (pending)`))
    console.log(pc.cyan('→') + ' ' + pc.cyan('ahk status') + ' to see all tasks')
  } catch (err) {
    spinner.stop(pc.red('Failed'))
    p.log.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }
}
