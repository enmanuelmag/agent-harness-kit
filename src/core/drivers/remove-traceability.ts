import type { DBDriver } from './types'

/** Removes the deprecated structured tool/file audit tables after the action
 * id migration has preserved the action timeline and free-form sections. */
export async function removeTraceabilityTables(
  driver: DBDriver,
  dbType: 'sqlite' | 'postgres' | 'mysql'
): Promise<void> {
  const tables = ['action_files', 'action_tools']
  for (const table of tables) {
    await driver.execRaw(`DROP TABLE IF EXISTS ${table}`)
    await driver.execRaw(`DROP TABLE IF EXISTS ${table}_old_v2migration`)
  }
  if (dbType === 'mysql') return
}
