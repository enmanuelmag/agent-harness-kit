import type { AgentName } from '@/core/materializer/agent-restrictions'
import type { Provider } from '@/types'

/** The catalog supplies actual selectable IDs and the efforts supported by each. */
export interface DefaultModelCandidate {
  id: string
  supportedReasoningEfforts: string[]
  defaultReasoningEffort?: string
}

export type DefaultModelChoices = Record<AgentName, { model: string; reasoningEffort?: string }>

const roles: AgentName[] = ['lead', 'explorer', 'consultant', 'builder', 'reviewer']

function inheritedChoices(): DefaultModelChoices {
  return Object.fromEntries(roles.map((role) => [role, { model: 'inherit' }])) as DefaultModelChoices
}

/** Compare numeric version components rather than lexical strings (5.10 > 5.9). */
export function compareModelVersions(left: string, right: string): number {
  const parts = (id: string) => (id.match(/\d+(?:\.\d+)*/)?.[0] ?? '').split('.').filter(Boolean).map(Number)
  const a = parts(left)
  const b = parts(right)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0)
    if (diff) return diff
  }
  return 0
}

function newest(models: readonly DefaultModelCandidate[], family: string): DefaultModelCandidate | undefined {
  return models
    .filter(({ id }) => new RegExp(`(?:^|[-_/])${family}(?:$|[-_/])`, 'i').test(id))
    .sort((a, b) => compareModelVersions(b.id, a.id) || a.id.localeCompare(b.id))[0]
}

function choice(model: DefaultModelCandidate | undefined, requested: string): DefaultModelChoices[AgentName] {
  if (!model) return { model: 'inherit' }
  const effort = model.supportedReasoningEfforts.includes(requested)
    ? requested
    : model.defaultReasoningEffort && model.supportedReasoningEfforts.includes(model.defaultReasoningEffort)
      ? model.defaultReasoningEffort
      : undefined
  return { model: model.id, ...(effort ? { reasoningEffort: effort } : {}) }
}

function codexChoices(models: readonly DefaultModelCandidate[]): DefaultModelChoices {
  const sol = newest(models, 'sol')
  const terra = newest(models, 'terra')
  const luna = newest(models, 'luna')
  const coding = !terra ? sol : sol && compareModelVersions(sol.id, terra.id) > 0 ? sol : terra
  return {
    lead: choice(sol, 'medium'),
    explorer: choice(luna, 'low'),
    consultant: choice(sol, 'high'),
    builder: choice(coding, 'medium'),
    reviewer: choice(coding, 'medium'),
  }
}

type Policy = { catalog: 'codex' | 'none'; resolve: (models: readonly DefaultModelCandidate[]) => DefaultModelChoices }

/** Policies describe choices only: catalog discovery and persistence live elsewhere. */
const policies: Partial<Record<Provider, Policy>> = {
  'codex-cli': { catalog: 'codex', resolve: codexChoices },
  'claude-code': { catalog: 'none', resolve: inheritedChoices },
  cursor: { catalog: 'none', resolve: inheritedChoices },
  'opencode-v2': { catalog: 'none', resolve: inheritedChoices },
}

export function providerDefaultCatalog(provider: Provider): Policy['catalog'] | undefined {
  return policies[provider]?.catalog
}

export function resolveProviderModelDefaults(
  provider: Provider,
  models: readonly DefaultModelCandidate[] = []
): DefaultModelChoices | undefined {
  return policies[provider]?.resolve(models)
}
