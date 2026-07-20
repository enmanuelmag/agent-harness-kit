import * as p from '@clack/prompts'
import pc from 'picocolors'

import { loadConfig } from '@/core/config'
import { openDB } from '@/core/db'
import { slugify } from '@/core/materializer/scaffold-utils'

export async function runTaskEdit(cwd: string): Promise<void> {
  p.intro(pc.bold('agent-harness-kit — edit task'))

  const config = await loadConfig(cwd)
  const db = await openDB(config, cwd)

  try {
    // 1. Get all non-done tasks
    const allTasks = await db.getTasks()
    const activeTasks = allTasks.filter(t => t.status !== 'done')

    if (activeTasks.length === 0) {
      p.log.error('No active tasks to edit.')
      return
    }

    // 2. Let user select a task
    const taskId = await p.select({
      message: 'Select a task to edit',
      options: activeTasks.map(t => ({
        label: `#${t.id} — ${t.title} (${t.slug})`,
        value: t.id,
      })),
    })
    if (p.isCancel(taskId)) { p.cancel('Cancelled.'); process.exit(0) }

    const task = await db.getTaskById(taskId as number)
    if (!task) { p.log.error('Task not found'); process.exit(1) }

    // 3. Edit title
    const title = await p.text({
      message: 'Title',
      initialValue: task.title,
    })
    if (p.isCancel(title)) { p.cancel('Cancelled.'); process.exit(0) }

    // 4. Edit description
    const description = await p.text({
      message: 'Description (what and why)',
      initialValue: task.description ?? '',
    })
    if (p.isCancel(description)) { p.cancel('Cancelled.'); process.exit(0) }

    // 5. Edit acceptance criteria
    const currentAcceptance = await db.getTaskAcceptance(task.id)
    const newAcceptance: string[] = []

    p.log.info('Acceptance criteria — edit each, empty to delete. Add new ones at the end.')

    // Edit existing criteria
    for (let i = 0; i < currentAcceptance.length; i++) {
      const ac = currentAcceptance[i]
      const val = await p.text({
        message: `#${i + 1}/${currentAcceptance.length}`,
        initialValue: ac.criterion,
        defaultValue: '',
      })
      if (p.isCancel(val)) { p.cancel('Cancelled.'); process.exit(0) }
      const trimmed = (val as string).trim()
      if (trimmed !== '') {
        newAcceptance.push(trimmed)
      }
      // If empty, the criterion is deleted (not pushed)
    }

    // Add new criteria
    while (true) {
      const val = await p.text({ message: 'New acceptance criterion', placeholder: '(press Enter to finish)' })
      if (p.isCancel(val) || !val || !(val as string).trim()) break
      newAcceptance.push((val as string).trim())
    }

    // 6. Save
    const spinner = p.spinner()
    spinner.start('Saving...')

    try {
      const newSlug = slugify(title as string)
      await db.updateTask(task.id, {
        title: title as string,
        description: (description as string).trim() || undefined,
        slug: newSlug,
      })
      await db.updateTaskAcceptance(task.id, newAcceptance)
      await db.writeFeatureList(cwd)

      spinner.stop('')
      console.log(pc.green(`✓ Task #${task.id} updated — ${newSlug}`))
    } catch (err) {
      spinner.stop(pc.red('Failed'))
      p.log.error(err instanceof Error ? err.message : String(err))
      process.exit(1)
    }
  } finally {
    await db.close()
  }
}
