import { MaintenanceService } from '@/core/maintenance/operations'

import { buildOnce } from './build'

export interface SyncOptions {
  force?: boolean
  keepModels?: boolean
  captureModels?: boolean
}

export async function runSync(cwd: string, opts: SyncOptions): Promise<void> {
  if (opts.captureModels && (opts.force || opts.keepModels))
    throw new Error('--capture-models cannot be combined with --force or --keep-models.')
  if (opts.keepModels && !opts.force) throw new Error('--keep-models requires --force.')
  if (opts.captureModels) return captureModels(cwd)
  await buildOnce(cwd, opts.force, opts.keepModels)
}

/** Native capture is shared with noninteractive MCP maintenance. */
export async function captureModels(cwd: string): Promise<void> {
  const service = new MaintenanceService(cwd)
  try {
    const plan = await service.execute('sync.plan', { captureModels: true })
    if (!plan.ok) throw new Error(`${plan.code}: ${plan.message ?? ''}`)
    const result = await service.execute('sync.apply', { planId: plan.data!.planId })
    if (!result.ok) throw new Error(`${result.code}: ${result.message ?? ''}`)
    console.log(`Captured model preferences. Missing: ${(result.data!.missing as string[]).join(', ')}.`)
  } finally { await service.dispose() }
}
