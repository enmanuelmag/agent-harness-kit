import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createServer as createHttpServer } from 'node:http'
import { createServer, type Server } from 'node:net'
import { join } from 'node:path'
import { afterEach, describe, test } from 'node:test'
import { serve } from '@hono/node-server'

import { awaitServerListening } from '@/core/dashboard-server'
import { DASHBOARD_BIND_HOST, findFreePort, isPortFree } from '@/core/port-utils'

// ─── helpers ────────────────────────────────────────────────────────────────
//
// REGRESSION NOTE (task #65). These tests occupy ports on the IPv6 wildcard
// ('::') — the host @hono/node-server actually binds. Occupying on '127.0.0.1'
// instead would PASS against the old, broken probe and prove nothing: the bug
// was that a socket held on '::' did not block a fresh '127.0.0.1' bind on
// macOS, so isPortFree() reported occupied ports as free and the fallback never
// fired. If these tests are ever rewritten to occupy '127.0.0.1', they lose all
// diagnostic value.

const openSockets: Server[] = []

/** Occupy `port` on `host`. port 0 asks the OS for an ephemeral free port. */
function occupy(port: number, host: string): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(port, host, () => {
      openSockets.push(server)
      resolve(server)
    })
  })
}

function portOf(server: Server): number {
  const addr = server.address()
  if (addr === null || typeof addr === 'string') throw new Error('expected a TCP address')
  return addr.port
}

/**
 * Whether this host can bind the IPv6 wildcard at all. IPv4-only machines and
 * some CI containers cannot, and the '::'-based tests below are meaningless
 * there — they are skipped rather than reported as failures.
 */
async function ipv6WildcardAvailable(): Promise<boolean> {
  try {
    const s = await occupy(0, '::')
    await new Promise<void>((r) => s.close(() => r()))
    openSockets.pop()
    return true
  } catch {
    return false
  }
}

const HAS_IPV6 = await ipv6WildcardAvailable()
const skipNoIpv6 = HAS_IPV6 ? false : 'requires IPv6 wildcard binding (::), unavailable on this host'

/**
 * Bind using the REAL @hono/node-server serve(), configured exactly as
 * startDashboardServer configures it, and report whether the bind succeeded.
 *
 * Using the actual library (rather than a hand-rolled net.createServer) is the
 * point: it pins hono's interpretation of the `hostname` option against our
 * probe, so a library change that moves the bind off our probed interface is
 * caught here.
 */
function honoBindSucceeds(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = serve({ fetch: () => new Response('ok'), port, hostname: DASHBOARD_BIND_HOST })
    server.once('error', () => resolve(false))
    server.once('listening', () => server.close(() => resolve(true)))
  })
}

async function closeAll(): Promise<void> {
  await Promise.all(openSockets.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))))
}

// ─── isPortFree: probe/bind host agreement (task #65 root cause) ────────────

describe('isPortFree — probe must agree with the real bind', () => {
  afterEach(closeAll)

  test('reports a port occupied on the IPv6 wildcard as NOT free', { skip: skipNoIpv6 }, async () => {
    const occupied = await occupy(0, '::')
    const port = portOf(occupied)

    // This is the user-reported scenario: a dashboard is already running (hono
    // binds the wildcard), and a second `ahk dashboard` is started on the same
    // port. Against the pre-fix code, which probed '127.0.0.1', this returned
    // true — the fallback never fired and serve() then died on EADDRINUSE.
    assert.equal(await isPortFree(port), false)
  })

  test('reports a genuinely unused port as free', async () => {
    const probe = await occupy(0, DASHBOARD_BIND_HOST ?? '::')
    const port = portOf(probe)
    await closeAll()

    assert.equal(await isPortFree(port), true)
  })

  // WHAT THESE AGREEMENT TESTS DO AND DO NOT PROVE — read before trusting them.
  //
  // They compare the probe against a bind performed by the REAL hono serve().
  // What they genuinely catch: @hono/node-server changing how it resolves the
  // `hostname` option, so that serve() stops binding the interface our probe
  // checks. That is an external-dependency risk worth pinning.
  //
  // What they do NOT catch, and must not be trusted for: a regression of
  // DASHBOARD_BIND_HOST itself. Both sides of the comparison read that
  // constant, so they move together — set it back to '127.0.0.1' and all four
  // of these still PASS against the reintroduced bug. Verified, not assumed.
  //
  // The tests with real diagnostic power over the original bug are the ones
  // with a hardcoded '::' occupier and a hardcoded expectation: the wildcard
  // case above and the three findFreePort fallback tests below. Reverting
  // DASHBOARD_BIND_HOST to '127.0.0.1' fails exactly those four. Nothing here
  // makes the bug "structurally impossible" — the single shared constant is
  // what keeps probe and bind aligned, and that is a property of the source,
  // not something this suite can assert.
  for (const host of ['::', '::1', '127.0.0.1', '0.0.0.0']) {
    const needsIpv6 = host.includes(':')
    test(`probe matches a real hono bind when the port is occupied on ${host}`, { skip: needsIpv6 ? skipNoIpv6 : false }, async () => {
      const occupied = await occupy(0, host)
      const port = portOf(occupied)

      const probeSaysFree = await isPortFree(port)
      const bindSucceeds = await honoBindSucceeds(port)

      assert.equal(
        probeSaysFree,
        bindSucceeds,
        `probe said ${probeSaysFree ? 'free' : 'busy'} but a real hono bind ${bindSucceeds ? 'succeeded' : 'failed'} (occupier on ${host})`
      )
    })
  }
})

// ─── the port must be a number by the time it reaches findFreePort ──────────
//
// Hypothesis 2 was eliminated as the CAUSE of the reported bug — cli.ts:138
// already calls parseInt. These tests guard the BOUNDARY so it stays that way:
// commander supplies --port as a string (cli.ts:135), and `start + i` silently
// becomes string concatenation if one ever reaches findFreePort.

describe('findFreePort — numeric port boundary', () => {
  afterEach(closeAll)

  test('rejects a string port instead of concatenating it', async () => {
    // Unguarded, '4242' + 0 === '42420' — findFreePort would probe a nonsense
    // port and return the string '42420' as the "free" port.
    await assert.rejects(
      () => findFreePort('4242' as unknown as number),
      (err: Error) => {
        assert.match(err.message, /integer port number/)
        assert.match(err.message, /received string/)
        return true
      }
    )
  })

  test('rejects NaN, which is what parseInt yields for a non-numeric --port', async () => {
    await assert.rejects(() => findFreePort(Number.NaN), /integer port number/)
  })

  test('rejects a non-integer port', async () => {
    await assert.rejects(() => findFreePort(4242.5), /integer port number/)
  })

  test('the sole caller of findFreePort coerces commander’s string --port to a number', async () => {
    // cli.ts self-executes on import (it calls program.parse()), so the
    // commander action cannot be invoked from a test without restructuring the
    // CLI. Asserting on the source is the available way to guard the coercion:
    // remove it and this test fails. As of task #67 the coercion is the shared
    // `parsePort` applied as the option's coercion argument (commander runs it
    // at parse time and hands the action a validated number), replacing the
    // former inline `parseInt(opts.port)` in the action body.
    const cliSource = await readFile(join(import.meta.dirname, '../cli.ts'), 'utf8')

    const dashboardAction = /\.command\('dashboard'\)([\s\S]*?)\n\n/.exec(cliSource)
    assert.ok(dashboardAction, 'could not locate the dashboard command in src/cli.ts')

    const block = dashboardAction[1]
    assert.match(block, /--port <port>/, 'dashboard should still declare a --port option')
    assert.match(
      block,
      /--port <port>'[^\n]*,\s*parsePort\b/,
      'the dashboard --port option must apply the parsePort coercion so commander validates and converts the value to a number at parse time'
    )
  })
})

// ─── findFreePort: fallback behavior ────────────────────────────────────────

describe('findFreePort — fallback', () => {
  afterEach(closeAll)

  test('occupied starting port falls back to the next port', { skip: skipNoIpv6 }, async () => {
    const occupied = await occupy(0, '::')
    const start = portOf(occupied)

    const resolved = await findFreePort(start)

    assert.equal(resolved, start + 1, 'must fall back, and by exactly one port (numeric arithmetic)')
    assert.notEqual(resolved, start)
  })

  test('several consecutive occupied ports resolve to a later free port', { skip: skipNoIpv6 }, async () => {
    const first = await occupy(0, '::')
    const start = portOf(first)
    await occupy(start + 1, '::')
    await occupy(start + 2, '::')

    const resolved = await findFreePort(start)

    assert.equal(resolved, start + 3)
  })

  test('all attempts occupied throws an error naming the range tried', { skip: skipNoIpv6 }, async () => {
    const first = await occupy(0, '::')
    const start = portOf(first)
    await occupy(start + 1, '::')
    await occupy(start + 2, '::')

    await assert.rejects(
      () => findFreePort(start, { maxAttempts: 3 }),
      (err: Error) => {
        assert.match(err.message, /after 3 attempts/)
        assert.match(err.message, new RegExp(`${start}-${start + 2}`))
        return true
      }
    )
  })

  test('honors an explicit probe host', async () => {
    const occupied = await occupy(0, '127.0.0.1')
    const start = portOf(occupied)

    const resolved = await findFreePort(start, { host: '127.0.0.1' })

    assert.equal(resolved, start + 1)
  })
})

// ─── awaitServerListening: bind failures must not crash the process ─────────

describe('awaitServerListening — bind failures surface as errors', () => {
  afterEach(closeAll)

  test('EADDRINUSE rejects with an actionable message instead of an unhandled crash', async () => {
    const occupied = await occupy(0, '127.0.0.1')
    const port = portOf(occupied)

    // A second server bound to the exact same address:port always fails. This
    // is the TOCTOU case: the port was free when probed, taken by the time we
    // bind. Without the handler this is an unhandled 'error' event that kills
    // the process.
    const server = createHttpServer()

    // Spy-wrap close() so we can prove awaitServerListening — not afterEach —
    // released the handle on the reject path. Asserting only that the promise
    // rejected would pass even with the leak, which is the whole point of #66.
    let closeCalls = 0
    const realClose = server.close.bind(server)
    server.close = ((cb?: (err?: Error) => void) => {
      closeCalls += 1
      return realClose(cb)
    }) as typeof server.close

    const pending = awaitServerListening(server, port)
    server.listen(port, '127.0.0.1')

    await assert.rejects(pending, (err: Error) => {
      assert.match(err.message, new RegExp(`Port ${port} was taken`))
      assert.match(err.message, /--port/)
      return true
    })

    // The handle must be released by the reject path, and best-effort close()
    // on a server that never bound (ERR_SERVER_NOT_RUNNING) must not throw,
    // double-settle, or produce an unhandled rejection.
    assert.equal(closeCalls, 1)
    assert.equal(server.listening, false)

    server.close()
  })

  test('a generic (non-EADDRINUSE) bind error rejects and still releases the handle', async () => {
    // No real bind failure produces a non-EADDRINUSE code reliably, so drive the
    // generic branch directly by emitting a synthetic 'error'. The server never
    // listened, so the best-effort close() hits ERR_SERVER_NOT_RUNNING — exactly
    // the case the guard must swallow.
    const server = createHttpServer()

    let closeCalls = 0
    const realClose = server.close.bind(server)
    server.close = ((cb?: (err?: Error) => void) => {
      closeCalls += 1
      return realClose(cb)
    }) as typeof server.close

    const pending = awaitServerListening(server, 4242)
    const boom: NodeJS.ErrnoException = Object.assign(new Error('boom'), { code: 'EACCES' })
    server.emit('error', boom)

    await assert.rejects(pending, (err: Error) => {
      assert.match(err.message, /Failed to start the dashboard on port 4242/)
      assert.match(err.message, /boom/)
      return true
    })

    assert.equal(closeCalls, 1)
    assert.equal(server.listening, false)
  })

  test('resolves once the server is actually listening', async () => {
    const server = createHttpServer()
    const pending = awaitServerListening(server, 0)
    server.listen(0, '127.0.0.1')

    await pending

    assert.equal(server.listening, true)
    await new Promise<void>((r) => server.close(() => r()))
  })

  test('a post-bind error does not reject the settled listening promise', async () => {
    const server = createHttpServer()
    const pending = awaitServerListening(server, 0)
    server.listen(0, '127.0.0.1')
    await pending

    // The listening handler detaches the rejection listener, so the server is
    // free to have a lifetime error handler attached without double-handling.
    assert.equal(server.listenerCount('error'), 0)

    await new Promise<void>((r) => server.close(() => r()))
  })
})
