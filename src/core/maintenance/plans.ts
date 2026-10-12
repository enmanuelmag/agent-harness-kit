import { createHash, randomUUID } from 'node:crypto'
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

export interface MaintenancePlan {
  id: string
  operation: string
  args: Record<string, unknown>
  digest: string
  expiresAt: number
  preview: Record<string, unknown>
}

/** Reject symlinks at every existing component, including intermediate parents. */
export function safePath(root: string, target: string): string {
  const absolute = resolve(target)
  const rel = relative(resolve(root), absolute)
  if (rel === '..' || rel.startsWith('../') || rel.startsWith('..\\')) throw new Error(`Path outside project: ${absolute}`)
  let current = resolve(root)
  for (const piece of ['', ...rel.split(/[\\/]/).filter(Boolean)]) {
    if (piece) current = join(current, piece)
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw new Error(`Refusing symlink: ${current}`)
  }
  return absolute
}

export function fileTree(root: string, target: string, limit = 2000): string[] {
  const files: string[] = []
  const visit = (path: string) => {
    safePath(root, path)
    if (!existsSync(path)) return
    if (lstatSync(path).isDirectory()) {
      for (const name of readdirSync(path).sort()) visit(join(path, name))
    } else {
      if (files.length >= limit) throw new Error(`Inspection exceeds ${limit} files: ${target}`)
      files.push(path)
    }
  }
  visit(target)
  return files
}

export function revision(cwd: string, files: string[], extra: unknown): string {
  const hash = createHash('sha256').update(realpathSync(cwd)).update(JSON.stringify(extra))
  for (const path of [...new Set(files)].sort()) {
    hash.update(path)
    if (!existsSync(path)) { hash.update('missing'); continue }
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) throw new Error(`Refusing symlink: ${path}`)
    if (stat.size > 8 * 1024 * 1024) throw new Error(`Inspection file too large: ${path}`)
    hash.update(readFileSync(path))
  }
  return hash.digest('hex')
}

export class PlanStore {
  private readonly plans = new Map<string, MaintenancePlan>()
  constructor(private readonly now = Date.now) {}
  create(operation: string, args: Record<string, unknown>, digest: string, preview: Record<string, unknown>): MaintenancePlan {
    this.prune()
    while (this.plans.size >= 32) this.plans.delete(this.plans.keys().next().value!)
    const plan = { id: randomUUID(), operation, args: structuredClone(args), digest, expiresAt: this.now() + 600_000, preview }
    this.plans.set(plan.id, plan)
    return plan
  }
  get(id: string): MaintenancePlan | undefined { this.prune(); return this.plans.get(id) }
  consume(id: string): void { this.plans.delete(id) }
  clear(): void { this.plans.clear() }
  private prune() { for (const [id, plan] of this.plans) if (plan.expiresAt <= this.now()) this.plans.delete(id) }
}

/** Exclusive cross-process project lock. No lock creation during inspection. */
export async function withMaintenanceLock<T>(cwd: string, work: () => Promise<T>): Promise<T> {
  const path = safePath(cwd, join(cwd, '.harness', 'maintenance.lock'))
  mkdirSync(dirname(path), { recursive: true })
  let fd: number
  try { fd = openSync(path, 'wx', 0o600) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('maintenance_busy: another operation holds the project lock. Remove an abandoned lock only after verifying its owner stopped.')
    throw error
  }
  try {
    writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: Date.now() }))
    return await work()
  } finally { closeSync(fd); rmSync(path, { force: true }) }
}
