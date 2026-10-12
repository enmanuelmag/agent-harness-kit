import * as p from '@clack/prompts'

import { MaintenanceService } from '@/core/maintenance/operations'

import type { Provider } from '@/types'

interface ResetOptions { force?: boolean; provider?: Provider; db?: boolean; targets?: string[] }

export async function runReset(cwd: string, opts: ResetOptions): Promise<void> {
  const service = new MaintenanceService(cwd)
  try {
    // Interactive choices are gathered before the common operation obtains its lock.
    let db = opts.db ?? opts.force === true
    if (opts.db === undefined && !opts.force) {
      const answer = await p.confirm({ message: 'Reset SQLite database?', initialValue: false })
      if (p.isCancel(answer)) return
      db = answer
    }
    let targets = opts.targets
    if (opts.provider && !targets) {
      targets = []
      for (const role of ['lead', 'explorer', 'consultant', 'builder', 'reviewer']) {
        const answer = opts.force ? true : await p.confirm({ message: `Remove ${role} role file?`, initialValue: false })
        if (p.isCancel(answer)) return
        if (answer) targets.push(role)
      }
    }
    if (!db && !targets?.length) { console.log('Nothing to reset.'); return }
    const plan = await service.execute('reset.plan', { db, provider: opts.provider, targets: targets ?? [], force: true })
    if (!plan.ok) throw new Error(`${plan.code}: ${plan.message ?? ''}`)
    const result = await service.execute('reset.apply', { planId: plan.data!.planId, confirm: true })
    if (!result.ok) throw new Error(`${result.code}: ${result.message ?? ''}`)
    console.log(`Reset complete. Backups: ${String(result.data!.backupDir ?? 'no existing files')}`)
  } finally { await service.dispose() }
}
