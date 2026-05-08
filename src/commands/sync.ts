import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import pc from 'picocolors'

import { loadConfig } from '@/core/config'
import { openDB } from '@/core/db'

import type { TaskSeed } from '@/types'

interface SyncOptions {
  dryRun?: boolean
  direction?: 'in' | 'out' | 'both'
}

export async function runSync(cwd: string, opts: SyncOptions): Promise<void> {
  const config = await loadConfig(cwd)
  const direction = opts.direction ?? 'both'
  const featureListPath = resolve(join(cwd, config.storage.dir, 'feature_list.json'))

  const db = await openDB(config, cwd)

  try {
    if (direction === 'in' || direction === 'both') {
      await syncIn(featureListPath, db, opts.dryRun ?? false)
    }

    if (direction === 'out' || direction === 'both') {
      await syncOut(db, cwd, opts.dryRun ?? false)
    }
  } finally {
    await db.close()
  }
}

async function syncIn(
  featureListPath: string,
  db: Awaited<ReturnType<typeof openDB>>,
  dryRun: boolean
): Promise<void> {
  if (!existsSync(featureListPath)) {
    console.log(pc.dim(`feature_list.json not found at ${featureListPath} — skipping in-sync`))
    return
  }

  let seeds: TaskSeed[]
  try {
    seeds = JSON.parse(readFileSync(featureListPath, 'utf8')) as TaskSeed[]
  } catch (err) {
    console.error(pc.red(`Failed to parse feature_list.json: ${err}`))
    process.exit(1)
  }

  if (dryRun) {
    console.log(pc.bold('Dry run — in-sync (feature_list.json → SQLite):'))
    for (const t of seeds) {
      const existing = await db.getTaskBySlug(t.slug)
      console.log(`  ${existing ? pc.dim('skip') : pc.green('add ')} ${t.slug}`)
    }
    return
  }

  const result = await db.syncFromFeatureList(seeds)
  console.log(pc.green(`✓ In-sync: ${result.added} added, ${result.skipped} already existed`))
}

async function syncOut(
  db: Awaited<ReturnType<typeof openDB>>,
  cwd: string,
  dryRun: boolean
): Promise<void> {
  if (dryRun) {
    const tasks = await db.getTasks()
    console.log(pc.bold('Dry run — out-sync (SQLite → feature_list.json):'))
    console.log(`  ${tasks.length} tasks would be written`)
    return
  }

  await db.writeFeatureList(cwd)
  console.log(pc.green('✓ Out-sync: feature_list.json updated'))
}
