import pc from 'picocolors'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadConfig } from '../../core/config.js'
import { openDB } from '../../core/db.js'

export async function runTaskDone(cwd: string, idOrSlug: string): Promise<void> {
  const config = await loadConfig(cwd)

  // Run health check first if required
  if (config.health.required) {
    const scriptPath = resolve(cwd, config.health.scriptPath)
    if (existsSync(scriptPath)) {
      const result = spawnSync('bash', [scriptPath], { cwd, stdio: 'pipe', encoding: 'utf8' })
      if (result.status !== 0) {
        console.error(pc.red('✗ Health check failed — cannot mark task as done.'))
        if (result.stdout) console.error(result.stdout)
        if (result.stderr) console.error(result.stderr)
        process.exit(1)
      }
    }
  }

  const db = openDB(config, cwd)

  try {
    const parsed = parseInt(idOrSlug, 10)
    const isId = !isNaN(parsed)
    const task = isId ? db.getTaskById(parsed) : db.getTaskBySlug(idOrSlug)

    if (!task) {
      console.error(pc.red(`Task not found: ${idOrSlug}`))
      process.exit(1)
    }

    if (task.status === 'done') {
      console.log(pc.dim(`Task #${task.id} is already done.`))
      return
    }

    db.updateTaskStatus(task.id, 'done')
    db.writeFeatureList(cwd)

    console.log(pc.green(`✓ Task #${task.id} — ${task.slug} marked as done`))
  } finally {
    db.close()
  }
}
