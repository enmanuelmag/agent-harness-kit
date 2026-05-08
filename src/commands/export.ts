import { writeFileSync } from 'node:fs'
import pc from 'picocolors'

import { loadConfig } from '@/core/config'
import { openDB } from '@/core/db'

interface ExportOptions {
  sql?: boolean
  json?: boolean
  output?: string
}

export async function runExport(cwd: string, opts: ExportOptions): Promise<void> {
  if (!opts.sql && !opts.json) {
    console.error(pc.red('Specify --sql or --json'))
    process.exit(1)
  }

  const config = await loadConfig(cwd)
  const db = await openDB(config, cwd)

  try {
    if (opts.json) {
      const data = await db.exportJson()
      const out = JSON.stringify(data, null, 2) + '\n'
      if (opts.output) {
        writeFileSync(opts.output, out, 'utf8')
        console.log(pc.green(`✓ Exported JSON → ${opts.output}`))
      } else {
        process.stdout.write(out)
      }
    }

    if (opts.sql) {
      console.error(pc.dim('SQL dump requires direct SQLite access — use: sqlite3 .harness/harness.db .dump'))
      process.exit(1)
    }
  } finally {
    await db.close()
  }
}
