import { MaintenanceService } from '@/core/maintenance/operations'

interface DashboardOptions { port: number; open: boolean }

export async function runDashboard(cwd: string, opts: DashboardOptions): Promise<void> {
  const service = new MaintenanceService(cwd)
  try {
    const result = await service.execute('dashboard.start', opts as unknown as Record<string, unknown>)
    if (!result.ok) throw new Error(`${result.code}: ${result.message ?? ''}`)
    const job = result.data!.job as { data: { url: string } }
    console.log(`Dashboard running at ${job.data.url}\nPress Ctrl+C to stop`)
    await new Promise<void>(resolveStop => process.once('SIGINT', resolveStop))
  } finally { await service.dispose() }
}
