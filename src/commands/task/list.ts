import Table from 'cli-table3'
import pc from 'picocolors'

import { loadConfig } from '@/core/config'
import { openDB } from '@/core/db'

import type { TaskStatus } from '@/types'

interface TaskListOptions {
  status?: string
  json?: boolean
}

const STATUS_COLOR: Record<string, (s: string) => string> = {
  pending: (s) => pc.dim(s),
  in_progress: (s) => pc.cyan(s),
  done: (s) => pc.green(s),
  blocked: (s) => pc.red(s),
}

export async function runTaskList(cwd: string, opts: TaskListOptions): Promise<void> {
  const config = await loadConfig(cwd)
  const db = openDB(config, cwd)

  try {
    const validStatuses: TaskStatus[] = ['pending', 'in_progress', 'done', 'blocked']
    const filterStatus =
      opts.status && validStatuses.includes(opts.status as TaskStatus)
        ? (opts.status as TaskStatus)
        : undefined

    const tasks = filterStatus ? db.getTasks(filterStatus) : db.getTasks()

    if (opts.json) {
      console.log(JSON.stringify(tasks, null, 2))
      return
    }

    if (tasks.length === 0) {
      console.log(pc.dim('No tasks' + (filterStatus ? ` with status: ${filterStatus}` : '') + '.'))
      return
    }

    const table = new Table({
      head: ['ID', 'Slug', 'Title', 'Status'].map((h) => pc.bold(h)),
      style: { head: [], border: [] },
    })

    for (const t of tasks) {
      const colorFn = STATUS_COLOR[t.status] ?? ((s: string) => s)
      table.push([String(t.id), t.slug, t.title.slice(0, 50), colorFn(t.status)])
    }

    console.log(table.toString())
  } finally {
    db.close()
  }
}
