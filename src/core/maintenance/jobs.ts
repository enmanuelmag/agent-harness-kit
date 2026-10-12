import { randomUUID } from 'node:crypto'

export interface ManagedJob { id: string; kind: 'watch' | 'dashboard'; state: 'running' | 'stopped' | 'failed'; startedAt: string; data: Record<string, unknown>; error?: string }
interface Entry { job: ManagedJob; close: () => Promise<void> }

/** At most one live job of each kind; terminal history is capped at eight. */
export class JobStore {
  private readonly entries = new Map<string, Entry>()
  active(kind: ManagedJob['kind']): ManagedJob | undefined { return [...this.entries.values()].find(e => e.job.kind === kind && e.job.state === 'running')?.job }
  register(kind: ManagedJob['kind'], data: Record<string, unknown>, close: () => Promise<void>): ManagedJob {
    const job: ManagedJob = { id: randomUUID(), kind, state: 'running', startedAt: new Date().toISOString(), data }
    this.entries.set(job.id, { job, close })
    this.prune()
    return job
  }
  status(kind: ManagedJob['kind']): ManagedJob[] { return [...this.entries.values()].filter(e => e.job.kind === kind).map(e => ({ ...e.job })) }
  fail(id: string, error: string) { const entry = this.entries.get(id); if (entry) { entry.job.state = 'failed'; entry.job.error = error } }
  async stop(kind: ManagedJob['kind']): Promise<void> {
    for (const entry of this.entries.values()) if (entry.job.kind === kind && entry.job.state !== 'stopped') {
      await entry.close(); entry.job.state = 'stopped'
    }
    this.prune()
  }
  async dispose() { await this.stop('watch'); await this.stop('dashboard'); this.entries.clear() }
  private prune() {
    const terminal = [...this.entries.values()].filter(e => e.job.state !== 'running')
    while (terminal.length > 8) this.entries.delete(terminal.shift()!.job.id)
  }
}
