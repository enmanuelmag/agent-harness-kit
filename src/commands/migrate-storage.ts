import { homedir } from 'node:os'

import { MaintenanceService } from '@/core/maintenance/operations'

export interface MigrateStorageOptions { force?: boolean; dryRun?: boolean }

/** CLI adapter for the same inspected, locked storage operation exposed by MCP. */
export async function runMigrateStorage(cwd: string, opts: MigrateStorageOptions, homeDir = homedir()): Promise<void> {
  const service = new MaintenanceService(cwd, { homeDir })
  try {
    const plan = await service.execute('migrate.storage.plan', { force: opts.force === true })
    if (!plan.ok) throw new Error(`${plan.code}: ${plan.message ?? ''}`)
    if (opts.dryRun) { console.log(`[dry-run] ${JSON.stringify(plan.data)}`); return }
    const result = await service.execute('migrate.storage.apply', { planId: plan.data!.planId })
    if (!result.ok) throw new Error(`${result.code}: ${result.message ?? ''}`)
    console.log(`Storage migration: ${JSON.stringify(result.data)}`)
  } finally { await service.dispose() }
}
