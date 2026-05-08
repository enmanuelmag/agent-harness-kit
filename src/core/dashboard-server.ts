import { watch } from 'node:fs'
import { existsSync, readFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { WebSocketServer } from 'ws'

import type { HarnessDB } from './db'
import type { IncomingMessage } from 'node:http'
import type { Socket } from 'node:net'

// ─── Static file serving ──────────────────────────────────────────────────────

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf':  'font/ttf',
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
  dbPath: string | null,
  staticPath: string,
  port: number,
): DashboardServerResult {
  const app = new Hono()
  const { tasks, actions, stats } = db

  // ─── CORS ─────────────────────────────────────────────────────────────────
  app.use('/api/*', async (c, next) => {
    await next()
    c.res.headers.set('Access-Control-Allow-Origin', '*')
  })

  // ─── Stats overview ───────────────────────────────────────────────────────
  app.get('/api/stats', async (c) => {
    const summary = await tasks.getStatusSummary()
    const byStatus: Record<string, number> = { pending: 0, in_progress: 0, done: 0, blocked: 0 }
    for (const { status, total } of summary) byStatus[status] = total
    const counts = await stats.getCounts()
    return c.json({ byStatus, ...counts })
  })

  // ─── Meta ─────────────────────────────────────────────────────────────────
  app.get('/api/meta', (c) => {
    return c.json({ ok: true })
  })

  // ─── Tasks list ───────────────────────────────────────────────────────────
  app.get('/api/tasks', async (c) => {
    return c.json(await tasks.getAllWithAcceptanceCounts())
  })

  // ─── Task detail ──────────────────────────────────────────────────────────
  app.get('/api/tasks/:id', async (c) => {
    const id = parseInt(c.req.param('id'))
    const task = await tasks.getById(id)
    if (!task) return c.json({ error: 'Not found' }, 404)

    const acceptance = await tasks.getAcceptance(id)
    const taskActions = await actions.getWithDetails(id)
    return c.json({ ...task, acceptance, actions: taskActions })
  })

  // ─── Tools top ────────────────────────────────────────────────────────────
  app.get('/api/tools/top', async (c) => {
    const limit = parseInt(c.req.query('limit') ?? '20')
    return c.json(await actions.getTopTools(limit))
  })

  // ─── Tools recent ─────────────────────────────────────────────────────────
  app.get('/api/tools/recent', async (c) => {
    const limit = parseInt(c.req.query('limit') ?? '50')
    return c.json(await stats.getRecentTools(limit))
  })

  // ─── Files top ────────────────────────────────────────────────────────────
  app.get('/api/files/top', async (c) => {
    const limit = parseInt(c.req.query('limit') ?? '20')
    return c.json(await stats.getTopFiles(limit))
  })

  // ─── Files recent ─────────────────────────────────────────────────────────
  app.get('/api/files/recent', async (c) => {
    const limit = parseInt(c.req.query('limit') ?? '50')
    return c.json(await stats.getRecentFiles(limit))
  })

  // ─── Agents stats ─────────────────────────────────────────────────────────
  app.get('/api/agents/stats', async (c) => {
    return c.json(await stats.getAgentStats())
  })

  // ─── Timeline ─────────────────────────────────────────────────────────────
  app.get('/api/timeline', async (c) => {
    const limit = parseInt(c.req.query('limit') ?? '50')
    return c.json(await stats.getTimeline(limit))
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

  // SQLite only — no file to watch for Postgres/MySQL
  let watcher: ReturnType<typeof watch> | null = null
  if (dbPath) {
    const walPath = `${dbPath}-wal`
    const watchTarget = existsSync(walPath) ? walPath : dbPath
    watcher = watch(watchTarget, broadcast)
  }

  return {
    url: `http://localhost:${port}`,
    close: () => {
      clearTimeout(debounce)
      watcher?.close()
      wss.close()
      httpServer.close()
    },
  }
}
