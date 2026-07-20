import { watch } from 'node:fs'
import { existsSync, readFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { WebSocketServer } from 'ws'

import { DASHBOARD_BIND_HOST, findFreePort } from './port-utils'

import type { HarnessDB } from './db'
import type { EventEmitter } from 'node:events'
import type { IncomingMessage } from 'node:http'
import type { Socket } from 'node:net'

// ─── Static file serving ──────────────────────────────────────────────────────

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
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

/**
 * Resolve once the server has actually bound, or reject with an actionable
 * message if the bind fails.
 *
 * `@hono/node-server`'s `serve()` returns synchronously before the bind
 * settles and attaches no `'error'` listener, so a failed bind lands as an
 * unhandled `'error'` event that terminates the process. Awaiting this turns
 * that crash into a rejected promise the caller can report, and also closes the
 * TOCTOU window between the free-port probe and the real bind.
 */
/**
 * The subset of `http.Server` this helper needs: the `EventEmitter` surface for
 * the one-shot `'error'`/`'listening'` race, plus `close()` so a failed bind can
 * release the handle. `@hono/node-server`'s `serve()` return (`Server`,
 * `Http2Server`, or `Http2SecureServer`) and a bare `node:http` server both
 * satisfy this, so widening the parameter to it breaks no caller.
 */
type ClosableServer = EventEmitter & {
  close: (callback?: (err?: Error) => void) => void
}

export function awaitServerListening(server: ClosableServer, port: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    // Best-effort teardown so a failed bind never leaves the http.Server handle
    // dangling. The server may never have bound (close() then reports
    // ERR_SERVER_NOT_RUNNING): pass a noop callback so that error is delivered to
    // the callback rather than re-emitted as an unhandled 'error' event, and
    // guard any synchronous throw. This must never mask the original
    // bind-failure rejection below, nor settle the promise a second time — the
    // one-shot onError has already been removed by the time it fires, so close()
    // cannot re-enter it.
    const closeQuietly = () => {
      try {
        server.close(() => {
          // swallow ERR_SERVER_NOT_RUNNING / any close error — best-effort
        })
      } catch {
        // handle was never open; nothing to release
      }
    }
    const onError = (err: NodeJS.ErrnoException) => {
      server.off('listening', onListening)
      closeQuietly()
      if (err.code === 'EADDRINUSE') {
        reject(
          new Error(
            `Port ${port} was taken by another process while starting the dashboard. Please retry, or pick a different port with --port.`
          )
        )
        return
      }
      reject(new Error(`Failed to start the dashboard on port ${port}: ${err.message}`))
    }
    const onListening = () => {
      server.off('error', onError)
      resolve()
    }
    server.once('error', onError)
    server.once('listening', onListening)
  })
}

export interface DashboardServerResult {
  url: string
  close: () => void
}

export async function startDashboardServer(
  db: HarnessDB,
  dbPath: string | null,
  staticPath: string,
  port: number
): Promise<DashboardServerResult> {
  const app = new Hono()
  const { tasks, actions, stats } = db

  // ─── CORS ─────────────────────────────────────────────────────────────────
  app.use('/api/*', async (c, next) => {
    await next()
    c.res.headers.set('Access-Control-Allow-Origin', '*')
  })

  // ─── Stats overview ───────────────────────────────────────────────────────
  app.get('/api/stats', async (c) => {
    await db.reconnect()
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
    await db.reconnect()
    const includeArchived = c.req.query('includeArchived') === 'true'
    return c.json(await tasks.getAllWithAcceptanceCounts(includeArchived))
  })

  // ─── Task detail ──────────────────────────────────────────────────────────
  app.get('/api/tasks/:id', async (c) => {
    await db.reconnect()
    const id = parseInt(c.req.param('id'))
    const task = await tasks.getById(id)
    if (!task) return c.json({ error: 'Not found' }, 404)

    const acceptance = await tasks.getAcceptance(id)
    const taskActions = await actions.getWithDetails(id)
    return c.json({ ...task, acceptance, actions: taskActions })
  })

  // ─── Task update (PATCH) ────────────────────────────────────────────────
  app.patch('/api/tasks/:id', async (c) => {
    const id = parseInt(c.req.param('id'))
    const task = await tasks.getById(id)
    if (!task) return c.json({ error: 'Not found' }, 404)

    const body = await c.req.json()
    const updateParams: { title?: string; description?: string | null; slug?: string } = {}
    if (body.title !== undefined) updateParams.title = body.title
    if (body.description !== undefined) updateParams.description = body.description

    await db.updateTask(id, updateParams)

    if (body.acceptance !== undefined && Array.isArray(body.acceptance)) {
      await db.updateTaskAcceptance(
        id,
        body.acceptance.map((a: string) => a.trim()).filter(Boolean)
      )
    }

    const updated = await tasks.getById(id)
    const acceptance = await tasks.getAcceptance(id)
    const taskActions = await actions.getWithDetails(id)
    return c.json({ ...updated, acceptance, actions: taskActions })
  })

  // ─── Archive task ─────────────────────────────────────────────────────────
  app.patch('/api/tasks/:id/archive', async (c) => {
    await db.reconnect()
    const id = parseInt(c.req.param('id'))
    const task = await tasks.getById(id)
    if (!task) return c.json({ error: 'Not found' }, 404)
    const updated = await db.archiveTask(id)
    return c.json(updated)
  })

  // ─── Unarchive task ──────────────────────────────────────────────────────
  app.patch('/api/tasks/:id/unarchive', async (c) => {
    await db.reconnect()
    const id = parseInt(c.req.param('id'))
    const task = await tasks.getById(id)
    if (!task) return c.json({ error: 'Not found' }, 404)
    const updated = await db.unarchiveTask(id)
    return c.json(updated)
  })

  // ─── Tools top ────────────────────────────────────────────────────────────
  app.get('/api/tools/top', async (c) => {
    await db.reconnect()
    const limit = parseInt(c.req.query('limit') ?? '20')
    return c.json(await actions.getTopTools(limit))
  })

  // ─── Tools recent ─────────────────────────────────────────────────────────
  app.get('/api/tools/recent', async (c) => {
    await db.reconnect()
    const limit = parseInt(c.req.query('limit') ?? '50')
    return c.json(await stats.getRecentTools(limit))
  })

  // ─── Files top ────────────────────────────────────────────────────────────
  app.get('/api/files/top', async (c) => {
    await db.reconnect()
    const limit = parseInt(c.req.query('limit') ?? '20')
    return c.json(await stats.getTopFiles(limit))
  })

  // ─── Files recent ─────────────────────────────────────────────────────────
  app.get('/api/files/recent', async (c) => {
    await db.reconnect()
    const limit = parseInt(c.req.query('limit') ?? '50')
    return c.json(await stats.getRecentFiles(limit))
  })

  // ─── Agents stats ─────────────────────────────────────────────────────────
  app.get('/api/agents/stats', async (c) => {
    await db.reconnect()
    return c.json(await stats.getAgentStats())
  })

  // ─── Timeline ─────────────────────────────────────────────────────────────
  app.get('/api/timeline', async (c) => {
    await db.reconnect()
    const limit = parseInt(c.req.query('limit') ?? '50')
    return c.json(await stats.getTimeline(limit))
  })

  // ─── Static SPA ───────────────────────────────────────────────────────────
  app.get('/*', (c) => {
    const urlPath = c.req.path
    if (urlPath !== '/') {
      const candidate = join(staticPath, urlPath)
      if (existsSync(candidate)) {
        try {
          return fileResponse(candidate)
        } catch {
          /* fall through */
        }
      }
    }
    return fileResponse(join(staticPath, 'index.html'))
  })

  // ─── Start HTTP server ────────────────────────────────────────────────────
  // The probe and the real bind MUST use the same host, otherwise the probe can
  // report an occupied port as free (see DASHBOARD_BIND_HOST).
  const resolvedPort = await findFreePort(port, { host: DASHBOARD_BIND_HOST })
  if (resolvedPort !== port) {
    console.log(`Port ${port} in use, using ${resolvedPort}`)
  }

  const httpServer = serve({
    fetch: app.fetch,
    port: resolvedPort,
    hostname: DASHBOARD_BIND_HOST,
  })

  // serve() returns before the bind settles and attaches no 'error' listener,
  // so an EADDRINUSE would otherwise surface as an unhandled event that kills
  // the process *after* the caller already printed a success banner. Wait for
  // the bind to resolve one way or the other before returning.
  await awaitServerListening(httpServer, resolvedPort)

  // Keep a handler attached for the server's lifetime so a later runtime error
  // is reported rather than crashing the process as an unhandled event.
  httpServer.on('error', (err: NodeJS.ErrnoException) => {
    console.error(`Dashboard server error: ${err.message}`)
  })

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
    url: `http://localhost:${resolvedPort}`,
    close: () => {
      clearTimeout(debounce)
      watcher?.close()
      wss.close()
      httpServer.close()
    },
  }
}
