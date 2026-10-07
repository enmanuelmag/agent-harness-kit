import pc from 'picocolors'

import { loadConfig } from '@/core/config'
import { openDB } from '@/core/db'
import { executeHealthCheck, inspectHealthCheck } from '@/core/health-check'

export async function runTaskDone(cwd: string, idOrSlug: string): Promise<void> {
  const config = await loadConfig(cwd)

  // Run health check first if required
  if (config.health.required) {
    const health = inspectHealthCheck(cwd, config.health.scriptPath)
    if (health.state !== 'ready') {
      console.error(pc.red(`✗ Health check is ${health.state} — cannot mark task as done.`))
      if (health.adaptFrom) console.error(`  Adapt: ${health.adaptFrom}`)
      process.exit(1)
    }
    const result = executeHealthCheck(cwd, health.path)
    if (result.error || result.status !== 0) {
      console.error(pc.red('✗ Health check failed — cannot mark task as done.'))
      if (result.tail) console.error(result.tail)
      console.error(`Full health log: ${result.logPath}`)
      process.exit(1)
    }
    printSuccessfulHealthTail(result.tail)
  }

  const db = await openDB(config, cwd)

  try {
    const parsed = parseInt(idOrSlug, 10)
    const isId = !isNaN(parsed)
    const task = isId ? await db.getTaskById(parsed) : await db.getTaskBySlug(idOrSlug)

    if (!task) {
      console.error(pc.red(`Task not found: ${idOrSlug}`))
      process.exit(1)
    }

    if (task.status === 'done') {
      console.log(pc.dim(`Task #${task.id} is already done.`))
      return
    }

    await db.updateTaskStatus(task.id, 'done')

    console.log(pc.green(`✓ Task #${task.id} — ${task.slug} marked as done`))
  } finally {
    await db.close()
  }
}

/** Kept separate so the completion path cannot silently drop the same compact
 * successful evidence shown by `ahk health`. */
export function printSuccessfulHealthTail(tail: string): void {
  if (tail) console.log(tail)
}
