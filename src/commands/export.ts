import { readFileSync } from 'node:fs'

import { MaintenanceService } from '@/core/maintenance/operations'

interface ExportOptions { sql?: boolean; json?: boolean; output?: string; force?: boolean }

export async function runExport(cwd: string, opts: ExportOptions): Promise<void> {
  if (!opts.sql && !opts.json) throw new Error('Specify --sql or --json')
  const service = new MaintenanceService(cwd)
  try {
    if (opts.json) {
      const result = await service.execute('export', { format: 'json', output: opts.output, force: opts.force })
      if (!result.ok) throw new Error(`${result.code}: ${result.message ?? ''}`)
      if (opts.output) console.log(`Exported JSON → ${String(result.data!.path)}`)
      else process.stdout.write(readFileSync(String(result.data!.path), 'utf8'))
    }
    if (opts.sql) throw new Error('SQL dump requires direct SQLite access — use: sqlite3 .harness/harness.db .dump')
  } finally { await service.dispose() }
}
