import { randomUUID } from 'node:crypto'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

import { findConfigFile, loadConfig } from '@/core/config'

import type { AgentName } from '@/core/materializer/agent-restrictions'
import type {
  AgentModelPreferences,
  ClaudeAgentModelChoice,
  CodexAgentModelChoice,
  CursorAgentModelChoice,
  HarnessConfig,
  Provider,
} from '@/types'

export const ROLES: AgentName[] = ['lead', 'explorer', 'consultant', 'builder', 'reviewer']
type PreferenceMap = Partial<Record<AgentName, { model: string; reasoningEffort?: string }>>

export function toPreferences(
  provider: Provider,
  choices?: Partial<
    Record<
      AgentName,
      string | ClaudeAgentModelChoice | CodexAgentModelChoice | CursorAgentModelChoice
    >
  >
): AgentModelPreferences {
  const roles: PreferenceMap = {}
  for (const role of ROLES) {
    const value = choices?.[role]
    if (value === undefined) continue
    if (typeof value === 'string') {
      roles[role] = { model: value || 'inherit' }
      continue
    }
    const effort = 'effort' in value ? value.effort : undefined
    roles[role] = {
      model: value.model || 'inherit',
      ...(effort ? { reasoningEffort: effort } : {}),
    }
  }
  return Object.keys(roles).length ? { [provider]: roles } : {}
}

export function mergePreferences(
  current: AgentModelPreferences | undefined,
  incoming: AgentModelPreferences
): AgentModelPreferences {
  const merged: AgentModelPreferences = { ...(current ?? {}) }
  for (const [provider, values] of Object.entries(incoming) as [Provider, PreferenceMap][]) {
    // Replace each changed role object: changing to inherit/model-only must clear stale effort.
    merged[provider] = { ...(merged[provider] ?? {}), ...values }
  }
  return merged
}

export function choicesFromPreferences(config: HarnessConfig): {
  claudeAgentModels?: Partial<Record<AgentName, ClaudeAgentModelChoice>>
  codexAgentModels?: Partial<Record<AgentName, CodexAgentModelChoice>>
  cursorAgentModels?: Partial<Record<AgentName, CursorAgentModelChoice>>
} {
  const saved = config.agentPreferences?.[config.provider] as PreferenceMap | undefined
  if (!saved) return {}
  if (config.provider === 'claude-code') {
    return {
      claudeAgentModels: Object.fromEntries(
        Object.entries(saved).map(([r, v]) => [
          r,
          {
            ...(v.model === 'inherit' ? {} : { model: v.model }),
            ...(v.reasoningEffort ? { effort: v.reasoningEffort } : {}),
          },
        ])
      ),
    }
  }
  if (config.provider === 'codex-cli') {
    return {
      codexAgentModels: Object.fromEntries(
        Object.entries(saved).map(([r, v]) => [
          r,
          {
            ...(v.model === 'inherit' ? {} : { model: v.model }),
            ...(v.reasoningEffort ? { effort: v.reasoningEffort } : {}),
          },
        ])
      ),
    }
  }
  if (config.provider === 'cursor') {
    return {
      cursorAgentModels: Object.fromEntries(
        Object.entries(saved).map(([r, v]) => [r, v.model === 'inherit' ? {} : { model: v.model }])
      ),
    }
  }
  return {}
}

export function missingPreferenceRoles(config: HarnessConfig): AgentName[] {
  const saved = config.agentPreferences?.[config.provider] as PreferenceMap | undefined
  return ROLES.filter((role) => !saved?.[role] || typeof saved[role].model !== 'string')
}

export function renderPreferenceBlock(preferences: AgentModelPreferences): string {
  return `agentPreferences: ${JSON.stringify(preferences, null, 2)},`
}

export type PersistResult = 'saved' | 'already-current' | 'manual-update-required'

/** Persist only JSON config. Code configs are intentionally never rewritten. */
export async function persistPreferences(
  cwd: string,
  incoming: AgentModelPreferences
): Promise<PersistResult> {
  const configPath = findConfigFile(cwd)
  if (!configPath) throw new Error('No agent-harness-kit.config found. Run: ahk init')
  const current = await loadConfig(cwd)
  const merged = mergePreferences(current.agentPreferences, incoming)
  if (!configPath.endsWith('.json')) {
    const same = JSON.stringify(current.agentPreferences ?? {}) === JSON.stringify(merged)
    if (!same)
      console.log(
        `Save this in ${basename(configPath)}, then run: ahk sync --force --keep-models\n\n${renderPreferenceBlock(merged)}`
      )
    return same ? 'already-current' : 'manual-update-required'
  }
  const raw = readFileSync(configPath, 'utf8')
  const parsed = JSON.parse(raw) as Record<string, unknown>
  const next = { ...parsed, agentPreferences: merged }
  const temp = join(dirname(configPath), `.${basename(configPath)}.${randomUUID()}.tmp`)
  writeFileSync(temp, JSON.stringify(next, null, 2) + '\n', 'utf8')
  // Do not overwrite a concurrent edit that happened after the raw read.
  if (readFileSync(configPath, 'utf8') !== raw)
    throw new Error('Config changed while saving preferences; no changes were written.')
  renameSync(temp, configPath)
  const verified = await loadConfig(cwd)
  if (JSON.stringify(verified.agentPreferences) !== JSON.stringify(merged))
    throw new Error('Could not verify saved agentPreferences.')
  return JSON.stringify(current.agentPreferences ?? {}) === JSON.stringify(merged)
    ? 'already-current'
    : 'saved'
}
