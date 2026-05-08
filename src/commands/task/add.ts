import * as p from '@clack/prompts'
import pc from 'picocolors'

import { loadConfig } from '@/core/config'
import { openDB } from '@/core/db'
import { slugify } from '@/core/materializer/scaffold-utils'

export async function runTaskAdd(cwd: string): Promise<void> {
  p.intro(pc.bold('agent-harness-kit — add task'))

  const titleVal = await p.text({
    message: 'Task title',
    validate: (v) => (v.trim() ? undefined : 'Title is required'),
  })
  if (p.isCancel(titleVal)) { p.cancel('Cancelled.'); process.exit(0) }
  const title = (titleVal as string).trim()

  const descVal = await p.text({
    message: 'Description (what and why)',
    placeholder: 'Optional',
  })
  if (p.isCancel(descVal)) { p.cancel('Cancelled.'); process.exit(0) }
  const description = (descVal as string).trim()

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
    const task = await db.addTask({ slug, title, description: description || undefined, acceptance })
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

