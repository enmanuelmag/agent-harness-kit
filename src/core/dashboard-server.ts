import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { WebSocketServer } from 'ws'
import { watch } from 'node:fs'
import { existsSync, readFileSync } from 'node:fs'
import { join, extname } from 'node:path'
import type { IncomingMessage } from 'node:http'
import type { Socket } from 'node:net'
import type { HarnessDB } from './db.js'
import type {
  AgentStatRow,
  CountRow,
  RecentFileRow,
  RecentToolRow,
  TaskListRow,
  TimelineRow,
  TopFileRow,
} from './server-types.js'

const AGENT_ORDER = ['lead', 'explorer', 'builder', 'reviewer']

// ─── Static file serving ──────────────────────────────────────────────────────

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
}

function fileResponse(filePath: string): Response {
  const content = readFileSync(filePath)
  const mime = MIME[extname(filePath)] ?? 'application/octet-stream'
  return new Response(content, {
    headers: { 'Content-Type': mime, 'Cache-Control': 'no-cache' },
  })
}

// ─── Server ───────────────────────────────────────────────────────────────────

export interface DashboardServerResult {
  url: string
  close: () => void
}

export function startDashboardServer(
  db: HarnessDB,
  dbPath: string,
  staticPath: string,
  port: number,
): DashboardServerResult {
  const app = new Hono()

  // ─── CORS ─────────────────────────────────────────────────────────────────
  app.use('/api/*', async (c, next) => {
    await next()
    c.res.headers.set('Access-Control-Allow-Origin', '*')
  })

  // ─── Stats overview ───────────────────────────────────────────────────────
  app.get('/api/stats', (c) => {
    const summary = db.getStatusSummary()
    const byStatus: Record<string, number> = { pending: 0, in_progress: 0, done: 0, blocked: 0 }
    for (const { status, total } of summary) byStatus[status] = total

    const [{ total: totalActions }] = db.queryRaw<CountRow>(`SELECT COUNT(*) as total FROM actions`)
    const [{ total: totalFiles }] = db.queryRaw<CountRow>(`SELECT COUNT(*) as total FROM action_files`)
    const [{ total: uniqueTools }] = db.queryRaw<CountRow>(`SELECT COUNT(DISTINCT tool_name) as total FROM action_tools`)
    const [{ total: activeAgents }] = db.queryRaw<CountRow>(
      `SELECT COUNT(DISTINCT agent) as total FROM actions WHERE status = 'in_progress'`,
    )

    return c.json({ byStatus, totalActions, totalFiles, uniqueTools, activeAgents })
  })

  // ─── Meta ─────────────────────────────────────────────────────────────────
  app.get('/api/meta', (c) => {
    return c.json({ ok: true })
  })

  // ─── Tasks list ───────────────────────────────────────────────────────────
  app.get('/api/tasks', (c) => {
    const rows = db.queryRaw<TaskListRow>(`
      SELECT t.*,
        COUNT(ta.id) as acceptance_total,
        COALESCE(SUM(ta.met), 0) as acceptance_met
      FROM tasks t
      LEFT JOIN task_acceptance ta ON ta.task_id = t.id
      GROUP BY t.id
      ORDER BY t.id
    `)
    return c.json(rows)
  })

  // ─── Task detail ──────────────────────────────────────────────────────────
  app.get('/api/tasks/:id', (c) => {
    const id = parseInt(c.req.param('id'))
    const task = db.getTaskById(id)
    if (!task) return c.json({ error: 'Not found' }, 404)

    const acceptance = db.getTaskAcceptance(id)
    const actions = db.getActionsForTask(id).map((action) => ({
      ...action,
      sections: db.getActionSections(action.id),
      files: db.queryRaw(`SELECT * FROM action_files WHERE action_id = ?`, action.id),
      tools: db.queryRaw(`SELECT * FROM action_tools WHERE action_id = ? ORDER BY called_at`, action.id),
    }))

    return c.json({ ...task, acceptance, actions })
  })

  // ─── Tools top ────────────────────────────────────────────────────────────
  app.get('/api/tools/top', (c) => {
    const limit = parseInt(c.req.query('limit') ?? '20')
    return c.json(db.getTopTools(limit))
  })

  // ─── Tools recent ─────────────────────────────────────────────────────────
  app.get('/api/tools/recent', (c) => {
    const limit = parseInt(c.req.query('limit') ?? '50')
    const rows = db.queryRaw<RecentToolRow>(`
      SELECT at.*, t.id as task_id, t.title as task_title, t.slug as task_slug, a.agent
      FROM action_tools at
      JOIN actions a ON at.action_id = a.id
      JOIN tasks t ON a.task_id = t.id
      ORDER BY at.called_at DESC
      LIMIT ?
    `, limit)
    return c.json(rows)
  })

  // ─── Files top ────────────────────────────────────────────────────────────
  app.get('/api/files/top', (c) => {
    const limit = parseInt(c.req.query('limit') ?? '20')
    const rows = db.queryRaw<TopFileRow>(`
      SELECT
        file_path,
        COUNT(*) as total,
        SUM(CASE WHEN operation='read'     THEN 1 ELSE 0 END) as read,
        SUM(CASE WHEN operation='created'  THEN 1 ELSE 0 END) as created,
        SUM(CASE WHEN operation='modified' THEN 1 ELSE 0 END) as modified,
        SUM(CASE WHEN operation='deleted'  THEN 1 ELSE 0 END) as deleted
      FROM action_files
      GROUP BY file_path
      ORDER BY total DESC
      LIMIT ?
    `, limit)
    return c.json(rows)
  })

  // ─── Files recent ─────────────────────────────────────────────────────────
  app.get('/api/files/recent', (c) => {
    const limit = parseInt(c.req.query('limit') ?? '50')
    const rows = db.queryRaw<RecentFileRow>(`
      SELECT af.*, t.id as task_id, t.title as task_title, t.slug as task_slug,
        a.agent, a.created_at as called_at
      FROM action_files af
      JOIN actions a ON af.action_id = a.id
      JOIN tasks t ON a.task_id = t.id
      ORDER BY a.created_at DESC
      LIMIT ?
    `, limit)
    return c.json(rows)
  })

  // ─── Agents stats ─────────────────────────────────────────────────────────
  app.get('/api/agents/stats', (c) => {
    const rows = db.queryRaw<AgentStatRow>(`
      SELECT
        a.agent,
        COUNT(*)                                                    as actions_total,
        SUM(CASE WHEN a.status='completed' THEN 1 ELSE 0 END)      as actions_done,
        SUM(CASE WHEN a.status='blocked'   THEN 1 ELSE 0 END)      as actions_blocked,
        COUNT(DISTINCT a.task_id)                                   as tasks_worked,
        COUNT(DISTINCT af.file_path)                                as files_touched
      FROM actions a
      LEFT JOIN action_files af ON af.action_id = a.id
      GROUP BY a.agent
      ORDER BY actions_total DESC
    `)
    const sorted = rows.sort((a, b) => {
      const ai = AGENT_ORDER.indexOf(a.agent)
      const bi = AGENT_ORDER.indexOf(b.agent)
      if (ai === -1 && bi === -1) return 0
      if (ai === -1) return 1
      if (bi === -1) return -1
      return ai - bi
    })
    return c.json(sorted)
  })

  // ─── Timeline ─────────────────────────────────────────────────────────────
  app.get('/api/timeline', (c) => {
    const limit = parseInt(c.req.query('limit') ?? '50')
    const rows = db.queryRaw<TimelineRow>(`
      SELECT a.*, t.title as task_title, t.slug as task_slug, t.status as task_status
      FROM actions a
      JOIN tasks t ON a.task_id = t.id
      ORDER BY a.created_at DESC
      LIMIT ?
    `, limit)
    return c.json(rows)
  })

  // ─── Static SPA ───────────────────────────────────────────────────────────
  app.get('/*', (c) => {
    const urlPath = c.req.path
    if (urlPath !== '/') {
      const candidate = join(staticPath, urlPath)
      if (existsSync(candidate)) {
        try { return fileResponse(candidate) } catch { /* fall through */ }
      }
    }
    return fileResponse(join(staticPath, 'index.html'))
  })

  // ─── Start HTTP server ────────────────────────────────────────────────────
  const httpServer = serve({ fetch: app.fetch, port })

  // ─── WebSocket ────────────────────────────────────────────────────────────
  const wss = new WebSocketServer({ noServer: true })

  httpServer.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
    if (req.url === '/ws') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req)
      })
    } else {
      socket.destroy()
    }
  })

  // ─── DB file watcher → broadcast update ──────────────────────────────────
  let debounce: ReturnType<typeof setTimeout>

  const broadcast = () => {
    clearTimeout(debounce)
    debounce = setTimeout(() => {
      for (const client of wss.clients) {
        if (client.readyState === 1) {
          client.send(JSON.stringify({ type: 'update' }))
        }
      }
    }, 150)
  }

  // Watch WAL file for writes (more responsive in WAL mode)
  const walPath = `${dbPath}-wal`
  const watchTarget = existsSync(walPath) ? walPath : dbPath
  const watcher = watch(watchTarget, broadcast)

  return {
    url: `http://localhost:${port}`,
    close: () => {
      clearTimeout(debounce)
      watcher.close()
      wss.close()
      httpServer.close()
    },
  }
}
