import { MaintenanceService } from '@/core/maintenance/operations'

/** Stateless health adapter; task-owned health evidence remains separate. */
export async function runHealth(cwd: string): Promise<void> {
  const service = new MaintenanceService(cwd)
  try {
    const result = await service.execute('health')
    const checks = result.data?.checks as { path: string; ok: boolean }[] | undefined
    for (const check of checks ?? []) console.log(`${check.ok ? '✓' : '✗'} ${check.path.includes('/agents/') ? `${check.path.split(/[\\/]/).at(-1)} present` : `${check.path} valid`}`)
    const tail = result.data?.tail
    if (tail) console.log(tail)
    if (!result.ok) { console.error(`Harness checks failed — ${result.message ?? result.code}${result.data?.logPath ? ` Log: ${String(result.data.logPath)}` : ''}`); process.exit(1) }
    console.log('Health check passed')
  } finally { await service.dispose() }
}
