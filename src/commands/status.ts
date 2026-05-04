import Table from 'cli-table3'
import pc from 'picocolors'
import { loadConfig } from '../core/config.js'
import { openDB } from '../core/db.js'

interface StatusOptions {
  json?: boolean
}

const STATUS_COLOR: Record<string, (s: string) => string> = {
  pending: (s) => pc.dim(s),
  in_progress: (s) => pc.cyan(s),
  done: (s) => pc.green(s),
  blocked: (s) => pc.red(s),
}

export async function runStatus(cwd: string, opts: StatusOptions): Promise<void> {
  const config = await loadConfig(cwd)
  const db = openDB(config, cwd)

  try {
    const tasks = db.getTasks()
    const summary = db.getStatusSummary()

    if (opts.json) {
      const actions = tasks.map((t) => ({
        ...t,
        actions: db.getActionsForTask(t.id),
        acceptance: db.getTaskAcceptance(t.id),
      }))
      console.log(JSON.stringify({ tasks: actions, summary }, null, 2))
      return
    }

    if (tasks.length === 0) {
      console.log(pc.dim('No tasks yet. Run: ahk task add'))
      return
    }

    const table = new Table({
      head: ['ID', 'Slug', 'Title', 'Status', 'Assigned', 'Started'].map((h) => pc.bold(h)),
      style: { head: [], border: [] },
    })

    for (const t of tasks) {
      const colorFn = STATUS_COLOR[t.status] ?? ((s: string) => s)
      table.push([
        String(t.id),
        t.slug,
        t.title.slice(0, 40),
        colorFn(t.status),
        t.assigned_to ?? '—',
        t.started_at ? t.started_at.slice(0, 10) : '—',
      ])
    }

    console.log(table.toString())

    // Active actions
    const inProgress = tasks.filter((t) => t.status === 'in_progress')
    if (inProgress.length > 0) {
      console.log('')
      console.log(pc.bold('Active actions:'))
      for (const t of inProgress) {
        const actions = db.getActionsForTask(t.id)
        const active = actions.filter((a) => a.status === 'in_progress')
        for (const a of active) {
          console.log(`  ${pc.cyan(a.agent.padEnd(10))} → task #${t.id} ${t.slug}`)
        }
      }
    }

    // Summary line
    console.log('')
    const parts = summary.map((s) => {
      const fn = STATUS_COLOR[s.status] ?? ((x: string) => x)
      return `${fn(s.status)}: ${s.total}`
    })
    console.log(pc.dim('Tasks — ') + parts.join(pc.dim(' | ')))
  } finally {
    db.close()
  }
}
