import { randomUUID } from 'node:crypto'
import { chmodSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'

import { openSQLite } from './sqlite-adapter'

interface Epoch { generation: number; retiredTo?: string }
export interface SQLiteMaintenanceToken { id: string; paths: string[] }
interface Owner { id: string; generation: number; file: string; root: string; maintenance?: SQLiteMaintenanceToken }
function rootFor(path: string): string {
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error(`database_busy: refusing symlinked SQLite database: ${path}`)
  const parent = dirname(resolve(path))
  mkdirSync(parent, { recursive: true })
  const root = join(realpathSync(parent), `.${basename(path)}.ahk-owners`)
  if (existsSync(root) && lstatSync(root).isSymbolicLink()) throw new Error(`database_busy: refusing symlinked SQLite ownership directory: ${root}`)
  mkdirSync(root, { recursive: true, mode: 0o700 })
  return root
}
function readEpoch(root: string): Epoch {
  const path = join(root, 'epoch.json')
  if (!existsSync(path)) return { generation: 0 }
  if (lstatSync(path).isSymbolicLink() || lstatSync(path).size > 4096) throw new Error('database_busy: unsafe SQLite ownership epoch.')
  const value = JSON.parse(readFileSync(path, 'utf8')) as Epoch
  if (!Number.isSafeInteger(value.generation) || value.generation < 0) throw new Error('database_busy: malformed SQLite ownership epoch.')
  return value
}
function exclusive(root: string): string | undefined {
  const path = join(root, 'exclusive.lock')
  if (!existsSync(path)) return undefined
  if (lstatSync(path).isSymbolicLink() || lstatSync(path).size > 4096) throw new Error('database_busy: unsafe SQLite maintenance lock.')
  return (JSON.parse(readFileSync(path, 'utf8')) as { id: string }).id
}
function live(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH' }
}
function owners(root: string): string[] {
  const alive: string[] = []
  for (const name of readdirSync(root).filter(n => n.endsWith('.owner'))) {
    const path = join(root, name)
    if (lstatSync(path).isSymbolicLink() || lstatSync(path).size > 4096) throw new Error('database_busy: unsafe SQLite owner record.')
    const record = JSON.parse(readFileSync(path, 'utf8')) as { pid: number }
    if (!Number.isInteger(record.pid) || record.pid <= 0) throw new Error('database_busy: malformed SQLite owner record.')
    if (live(record.pid)) alive.push(path)
    else rmSync(path, { force: true })
  }
  return alive
}
/** Read existing epoch metadata without creating directories or owner records. */
export function inspectSQLiteEpoch(path: string): Epoch {
  const parent = dirname(resolve(path))
  if (!existsSync(parent)) return { generation: 0 }
  const root = join(realpathSync(parent), `.${basename(path)}.ahk-owners`)
  if (!existsSync(root)) return { generation: 0 }
  if (lstatSync(root).isSymbolicLink()) throw new Error('database_busy: unsafe SQLite ownership directory.')
  return readEpoch(root)
}
function admission<T>(root: string, work: () => T): T {
  const path = join(root, 'admission.db')
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error('database_busy: unsafe SQLite admission database.')
  const db = openSQLite(path)
  try {
    chmodSync(path, 0o600)
    db.exec('PRAGMA busy_timeout = 100')
    db.exec('CREATE TABLE IF NOT EXISTS admission (id INTEGER PRIMARY KEY)')
    db.exec('BEGIN IMMEDIATE')
    try { const value = work(); db.exec('COMMIT'); return value }
    catch (error) { db.exec('ROLLBACK'); throw error }
  } finally { db.close() }
}
/** Only helper writers holding native admission may reap a proven-dead exclusive owner. */
function recoverExclusive(root: string): void {
  const path = join(root, 'exclusive.lock')
  if (!existsSync(path)) return
  if (lstatSync(path).isSymbolicLink() || lstatSync(path).size > 4096) throw new Error('database_busy: unsafe SQLite maintenance lock.')
  const raw = readFileSync(path, 'utf8')
  let value: { id?: string; pid?: number }
  try { value = JSON.parse(raw) as typeof value } catch { throw new Error('database_busy: malformed SQLite maintenance lock; manual inspection is required.') }
  if (typeof value.id !== 'string' || !Number.isInteger(value.pid) || Number(value.pid) <= 0) throw new Error('database_busy: unknown SQLite lock owner; manual inspection is required.')
  if (!live(value.pid!)) {
    // Admission serializes every cooperating lock creation/removal; raw compare refuses unrelated edits.
    if (readFileSync(path, 'utf8') !== raw) throw new Error('database_busy: SQLite lock changed during dead-owner recovery.')
    rmSync(path)
  }
}
export function registerSQLiteOwner(path: string, maintenance?: SQLiteMaintenanceToken): Owner {
  const root = rootFor(path)
  return admission(root, () => {
    recoverExclusive(root)
  const held = exclusive(root)
  if (maintenance && (held !== maintenance.id || !maintenance.paths.includes(resolve(path)))) throw new Error('database_busy: invalid SQLite maintenance lease.')
  if (held && held !== maintenance?.id) throw new Error('database_busy: SQLite maintenance is in progress. Retry after it finishes.')
  const epoch = readEpoch(root)
  if (epoch.retiredTo && !maintenance) throw new Error(`restart_required: This retained SQLite source migrated to ${epoch.retiredTo}. Reload the project configuration before opening it; native read-only recovery remains available.`)
  if (owners(root).length >= 64) throw new Error('database_busy: SQLite active-owner bound (64) exceeded.')
  const id = randomUUID(); const file = join(root, `${id}.owner`)
  writeFileSync(file, JSON.stringify({ pid: process.pid, id, generation: epoch.generation }), { flag: 'wx', mode: 0o600 })
  const owner = { id, file, root, generation: epoch.generation, maintenance }
  try { assertSQLiteOwner(owner); return owner } catch (error) { rmSync(file, { force: true }); throw error }
  })
}
export function assertSQLiteOwner(owner: Owner): void {
  const held = exclusive(owner.root)
  if (owner.maintenance && held !== owner.maintenance.id) throw new Error('restart_required: SQLite maintenance lease ended; reopen the database.')
  if (held && held !== owner.maintenance?.id) throw new Error('database_busy: SQLite maintenance owns this database; stop this server or retry after maintenance.')
  const epoch = readEpoch(owner.root)
  if (!owner.maintenance && (epoch.generation !== owner.generation || epoch.retiredTo)) throw new Error('restart_required: SQLite storage generation changed. Reopen using current project configuration before continuing.')
}
export function releaseSQLiteOwner(owner: Owner): void { admission(owner.root, () => rmSync(owner.file, { force: true })) }

/** Excludes all cooperating AHK handles; real SQLite transaction locks additionally exclude raw writers. */
export async function withSQLiteMaintenance<T>(paths: string[], run: (token: SQLiteMaintenanceToken) => Promise<T>): Promise<T> {
  const unique = [...new Set(paths.map(p => resolve(p)))].sort()
  const token = { id: randomUUID(), paths: unique }
  const held: string[] = []
  try {
    for (const path of unique) {
      const root = rootFor(path); const lock = join(root, 'exclusive.lock')
      admission(root, () => {
        recoverExclusive(root)
        let fd: number
        try { fd = openSync(lock, 'wx', 0o600) } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('database_busy: another live SQLite maintenance owns the database. Retry after it stops.')
          throw error
        }
        // Record ownership immediately after exclusive creation so even a short/write failure cleans it.
        held.push(root)
        try { writeFileSync(fd, JSON.stringify({ id: token.id, pid: process.pid })) } finally { closeSync(fd) }
        if (owners(root).length) throw new Error('database_busy: another live AHK SQLite handle is open. Stop other project servers, dashboards and CLI operations, then create a fresh maintenance plan.')
      })
    }
    return await run(token)
  } finally { for (const root of held) admission(root, () => rmSync(join(root, 'exclusive.lock'), { force: true })) }
}
export function changeSQLiteEpoch(path: string, token: SQLiteMaintenanceToken, retiredTo?: string): void {
  const root = rootFor(path)
  if (exclusive(root) !== token.id) throw new Error('database_busy: SQLite epoch changes require maintenance ownership.')
  const value: Epoch = { generation: readEpoch(root).generation + 1, ...(retiredTo ? { retiredTo } : {}) }
  const temp = join(root, `epoch-${token.id}.tmp`)
  writeFileSync(temp, JSON.stringify(value), { flag: 'wx', mode: 0o600 })
  renameSync(temp, join(root, 'epoch.json'))
}
