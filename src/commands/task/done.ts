import pc from 'picocolors'

import { loadConfig } from '@/core/config'
import { openDB } from '@/core/db'
import { runTaskHealthCheck } from '@/core/task-health'

export async function runTaskDone(cwd: string, idOrSlug: string): Promise<void> {
  const config = await loadConfig(cwd)

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

    const reserved = await db.beginVerification(task.id)
    if (!reserved) {
      console.error(pc.red('✗ Task is not open for final health verification.'))
      process.exit(1)
    }
    const health = await runTaskHealthCheck(db, cwd, config, task.id)
    await db.resolveHealthMode(task.id, health, 'verify')
    if (health.state !== 'passed') {
      console.error(pc.red('✗ Health check failed — cannot mark task as done.'))
      if (health.tail) console.error(health.tail)
      if (health.logPath) console.error(`Full health log: ${health.logPath}`)
      process.exit(1)
    }
    printSuccessfulHealthTail(health.tail)
    const completed = await db.finalizeVerifiedTask(task.id, health)
    if (!completed) {
      console.error(pc.red('✗ Fresh task health evidence is required — cannot mark task as done.'))
      process.exit(1)
    }

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
