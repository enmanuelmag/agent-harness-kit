import { MaintenanceService } from '@/core/maintenance/operations'

export interface MigrateSpecsOptions { apply?: boolean; dryRun?: boolean }

/** Registered frontmatter migration shared with MCP; preview performs no writes. */
export async function runMigrateSpecs(cwd: string, opts: MigrateSpecsOptions = {}): Promise<void> {
  if (opts.apply && opts.dryRun) throw new Error('--apply and --dry-run cannot be combined.')
  const service = new MaintenanceService(cwd)
  try {
    const plan = await service.execute('migrate.specs.plan')
    if (!plan.ok) throw new Error(`${plan.code}: ${(plan.message ?? '').replace('Refusing symlink:', 'refusing symlinked specification document:')}`)
    if (!opts.apply) {
      const files = plan.data!.files as string[]
      console.log(`Dry run: ${files.length} docs/specs file(s) would be migrated.`)
      for (const file of files) console.log(`  ${file}`)
      console.log('Run `ahk migrate specs --apply` to apply these frontmatter-only changes.')
      return
    }
    const result = await service.execute('migrate.specs.apply', { planId: plan.data!.planId })
    if (!result.ok) throw new Error(`${result.code}: ${result.message ?? ''}`)
    console.log(`Migrated ${(result.data!.files as string[]).length} docs/specs file(s); document bodies, slugs, statuses, timestamps, and links were preserved.`)
  } finally { await service.dispose() }
}
