import { watch } from 'node:fs'
import * as p from '@clack/prompts'
import pc from 'picocolors'

import { loadConfig } from '@/core/config'
import { getMaterializer } from '@/core/materializer/index'

interface BuildOptions {
  watch?: boolean
  sync?: boolean
  force?: boolean
}

export async function runBuild(cwd: string, opts: BuildOptions): Promise<void> {
  await buildOnce(cwd, opts.force)

  if (opts.sync) {
    p.log.step('Syncing agent permissions...')
    const config = await loadConfig(cwd)
    const materializer = getMaterializer(config.provider)
    await materializer.syncPermissions(cwd)
  }

  if (opts.watch) {
    p.log.info(`Watching agent-harness-kit.config.ts for changes...`)
    watch(cwd, { recursive: false }, async (_, filename) => {
      if (filename?.startsWith('agent-harness-kit.config')) {
        p.log.step('Config changed — rebuilding...')
        // Deliberately never forced: an automatic rebuild triggered by a file
        // watcher must not destroy agent-file customizations behind the user's
        // back. --force is a one-shot, explicitly requested operation.
        await buildOnce(cwd, false)
      }
    })
    // Keep process alive
    await new Promise(() => { })
  }
}

async function buildOnce(cwd: string, force?: boolean): Promise<void> {
  const spinner = p.spinner()
  spinner.start('Loading config...')

  try {
    const config = await loadConfig(cwd)
    spinner.message('Rebuilding files...')
    const materializer = getMaterializer(config.provider)
    const report = await materializer.build(config, cwd, { force })
    spinner.stop(pc.green('Build complete'))

    // ── Config-derived files (AGENTS.md, and CLAUDE.md for claude-code) ──
    // Report the ACTUAL per-file outcome rather than a static line. Files that
    // are up to date (created / already current / config propagated) are
    // announced quietly; hand-edited files are called out LOUDLY so a user who
    // expects config to propagate is not left thinking it silently did.
    const d = report.derived
    const upToDate = [...d.created, ...d.current, ...d.propagated]
    if (upToDate.length > 0) {
      p.log.success(upToDate.join(', '))
    }
    if (d.propagated.length > 0) {
      p.log.info(`Propagated config changes to ${d.propagated.length} generated file(s):\n  ${d.propagated.join('\n  ')}`)
    }
    if (d.overwritten.length > 0) {
      p.log.warn(
        pc.yellow(
          `--force REGENERATED ${d.overwritten.length} hand-edited generated file(s), discarding your edits:\n  ` +
            d.overwritten.join('\n  '),
        ),
      )
      if (d.backupDir) {
        p.log.info(pc.yellow(`  Previous content backed up → ${d.backupDir}`))
      }
    }
    if (d.preserved.length > 0) {
      // The anti-"silently stale" guard: these files diverge from the current
      // config but were hand-edited, so build left them alone. Say so loudly.
      p.log.warn(
        pc.yellow(
          `Left ${d.preserved.length} hand-edited generated file(s) UNTOUCHED — your edits are safe:\n  ` +
            d.preserved.join('\n  ') +
            `\n  These no longer match the current config. Re-run with --force to regenerate them\n  ` +
            `(this DESTROYS your edits; a backup is written first).`,
        ),
      )
    }

    p.log.success(`Agent definitions (${config.provider})`)
    p.log.success('MCP config')

    const { created, overwritten, preserved, backupDir } = report.agents

    if (created.length > 0) {
      p.log.info(`Created ${created.length} missing agent file(s):\n  ${created.join('\n  ')}`)
    }

    if (overwritten.length > 0) {
      // Name every file that lost its customizations. A count alone would not
      // let the user tell which of their edits are now only in the backup.
      p.log.warn(
        pc.yellow(
          `--force REGENERATED ${overwritten.length} existing agent file(s), discarding any customizations:\n  ` +
            overwritten.join('\n  '),
        ),
      )
      if (backupDir) {
        p.log.info(pc.yellow(`  Previous content backed up → ${backupDir}`))
      }
    }

    if (preserved.length > 0) {
      // Without this, a user who edited a template and expects `build` to pick
      // up an upstream improvement gets silence and assumes it was applied.
      p.log.info(
        `Left ${preserved.length} existing agent file(s) untouched — agent files are yours to edit.\n  ` +
          `Re-run with --force to regenerate them from the packaged templates (this DESTROYS your edits;\n  ` +
          `a backup is written first).`,
      )
    }
  } catch (err) {
    spinner.stop(pc.red('Build failed'))
    p.log.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }
}
