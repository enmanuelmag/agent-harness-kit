import pc from 'picocolors'

import { loadConfig } from '@/core/config'
import { openDB } from '@/core/db'
import { HEALTH_EVIDENCE_TTL_MS, runTaskHealthCheck } from '@/core/task-health'

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

    // Keep the CLI convenience command safe too: it mints the same
    // task-scoped evidence as MCP health.run, rather than accepting a prior
    // manual `ahk health` invocation as completion proof.
    const health = await runTaskHealthCheck(db, cwd, config, task.id)
    if (health.state !== 'passed') {
      console.error(pc.red('✗ Health check failed — cannot mark task as done.'))
      if (health.tail) console.error(health.tail)
      if (health.logPath) console.error(`Full health log: ${health.logPath}`)
      process.exit(1)
    }
    printSuccessfulHealthTail(health.tail)
    const completed = await db.completeTaskWithHealthEvidence(task.id, HEALTH_EVIDENCE_TTL_MS)
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
