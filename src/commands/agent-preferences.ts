import { loadConfig } from '@/core/config'
import { updateManagedConfig } from '@/core/maintenance/config'

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

/** Persist operational preferences in the managed overlay without rewriting code configs. */
export async function persistPreferences(
  cwd: string,
  incoming: AgentModelPreferences
): Promise<PersistResult> {
  const current = await loadConfig(cwd)
  const merged = mergePreferences(current.agentPreferences, incoming)
  if (JSON.stringify(current.agentPreferences ?? {}) === JSON.stringify(merged))
    return 'already-current'
  const saved = await updateManagedConfig(cwd, { agentPreferences: incoming })
  if (!saved.ok) throw new Error(saved.error.message)
  const verified = await loadConfig(cwd)
  if (JSON.stringify(verified.agentPreferences) !== JSON.stringify(merged))
    throw new Error('Could not verify saved agentPreferences.')
  return 'saved'
}
