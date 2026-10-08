import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { loadConfig } from '@/core/config'

import { persistPreferences, toPreferences } from './agent-preferences'
import { buildOnce } from './build'

import type { AgentName } from '@/core/materializer/agent-restrictions'
import type { CodexAgentModelChoice, CursorAgentModelChoice } from '@/types'

export interface SyncOptions { force?: boolean; keepModels?: boolean; captureModels?: boolean }

export async function runSync(cwd: string, opts: SyncOptions): Promise<void> {
  if (opts.captureModels && (opts.force || opts.keepModels)) throw new Error('--capture-models cannot be combined with --force or --keep-models.')
  if (opts.keepModels && !opts.force) throw new Error('--keep-models requires --force.')
  if (opts.captureModels) return captureModels(cwd)
  await buildOnce(cwd, opts.force, opts.keepModels)
}

/** Migration scans only the current provider's five canonical role files. */
export async function captureModels(cwd: string): Promise<void> {
  const config = await loadConfig(cwd)
  const choices: Partial<Record<AgentName, string | CodexAgentModelChoice | CursorAgentModelChoice>> = {}
  const missing: string[] = []
  const roles: AgentName[] = ['lead', 'explorer', 'consultant', 'builder', 'reviewer']
  for (const role of roles) {
    const path = config.provider === 'claude-code' ? join(cwd, `.claude/agents/${role}.md`) : config.provider === 'codex-cli' ? join(cwd, `.codex/agents/${role}.toml`) : config.provider === 'cursor' ? join(cwd, `.cursor/agents/${role}.md`) : ''
    if (!path || !existsSync(path)) { missing.push(role); continue }
    const content = readFileSync(path, 'utf8')
    if (config.provider === 'codex-cli') {
      const header = content.split(/^\s*\[/m, 1)[0]
      const model = header.match(/^\s*model\s*=\s*["']([^"']+)["']\s*(?:#.*)?$/m)
      if (!model || (header.match(/^\s*model\s*=/gm)?.length ?? 0) !== 1) { missing.push(role); continue }
      const effort = header.match(/^\s*model_reasoning_effort\s*=\s*["']([^"']+)["']\s*(?:#.*)?$/m)
      choices[role] = { model: model[1], ...(effort ? { effort: effort[1] } : {}) }
    } else {
      const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
      const model = frontmatter?.[1].match(/^model:\s*([^#\r\n]+)\s*$/m)
      if (!model || (frontmatter![1].match(/^model:/gm)?.length ?? 0) !== 1) { missing.push(role); continue }
      choices[role] = model[1].trim().replace(/^['"]|['"]$/g, '')
    }
  }
  const result = await persistPreferences(cwd, toPreferences(config.provider, choices))
  console.log(result === 'manual-update-required' ? 'Model preferences were detected; add the block above and rerun ahk sync --capture-models.' : `Captured model preferences.${missing.length ? ` Missing: ${missing.join(', ')}.` : ''}`)
}
