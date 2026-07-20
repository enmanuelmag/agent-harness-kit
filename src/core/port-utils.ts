import { createServer } from 'node:net'

/**
 * The host the dashboard binds to — the single source of truth shared by the
 * availability probe (`isPortFree`) and the real HTTP bind in
 * `startDashboardServer`.
 *
 * `undefined` means "the Node default wildcard": `::` on dual-stack hosts,
 * `0.0.0.0` on IPv4-only hosts. This is exactly what `@hono/node-server`'s
 * `serve()` binds when no `hostname` is supplied, so probe and bind cannot
 * disagree.
 *
 * Why not a literal like '127.0.0.1' or '::'?
 *  - '127.0.0.1' was the original bug: a socket held on '::' does not block a
 *    fresh 127.0.0.1 bind on macOS, so the probe reported occupied ports free,
 *    the fallback never fired, and serve() then died on EADDRINUSE.
 *  - A hardcoded '::' would fail with EADDRNOTAVAIL on IPv4-only hosts, making
 *    every port look occupied.
 * Deferring to the platform default keeps probe and bind identical on every
 * platform. Both consumers must read this constant — never inline a host.
 */
export const DASHBOARD_BIND_HOST: string | undefined = undefined

export interface FindFreePortOptions {
  /** How many consecutive ports to try before giving up. */
  maxAttempts?: number
  /** Host to probe. Must match the host the caller will actually bind to. */
  host?: string
}

/**
 * Probe whether `port` can be bound on `host`.
 *
 * The host argument is required-by-convention: callers must pass the same host
 * they intend to bind on, otherwise the probe answers a different question than
 * the one being asked.
 */
export function isPortFree(port: number, host: string | undefined = DASHBOARD_BIND_HOST): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => {
      server.close(() => resolve(true))
    })
    server.listen(port, host)
  })
}

export async function findFreePort(start: number, options: FindFreePortOptions = {}): Promise<number> {
  const { maxAttempts = 10, host = DASHBOARD_BIND_HOST } = options

  // Guard the boundary. `start` MUST be a number: the loop below computes
  // `start + i`, which silently becomes string concatenation if a string slips
  // through ('4242' + 0 === '42420'), producing a nonsense probe port and no
  // usable error. Commander hands `--port` over as a string (cli.ts:135), so
  // the sole caller coerces it (cli.ts:138). This check makes that contract
  // enforced rather than merely observed — if the coercion is ever removed,
  // the failure is loud and immediate instead of a bizarre port number.
  if (typeof start !== 'number' || !Number.isInteger(start)) {
    throw new Error(
      `findFreePort requires an integer port number, received ${typeof start} ${JSON.stringify(start)}. ` +
        `The port must be coerced to a number before it reaches here (commander supplies --port as a string).`
    )
  }

  for (let i = 0; i < maxAttempts; i++) {
    const port = start + i
    if (await isPortFree(port, host)) return port
  }

  throw new Error(
    `Could not find a free port after ${maxAttempts} attempts (tried ${start}-${start + maxAttempts - 1}). Please free a port and try again.`
  )
}
