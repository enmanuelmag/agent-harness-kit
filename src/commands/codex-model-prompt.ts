import * as p from '@clack/prompts'

import {
  discoverCodexModels,
  selectCodexRoleDefaults,
  validateManualModelId,
  validateManualReasoningEffort,
} from './model-catalog'

import type { AgentName } from '@/core/materializer/agent-restrictions'
import type { CodexAgentModelChoice, Provider } from '@/types'

const AGENTS: { key: AgentName; label: string }[] = [
  { key: 'lead', label: 'Lead' },
  { key: 'explorer', label: 'Explorer' },
  { key: 'consultant', label: 'Consultant' },
  { key: 'builder', label: 'Builder' },
  { key: 'reviewer', label: 'Reviewer' },
]
const MANUAL_MODEL = '__ahk_manual_model__'

export async function promptCodexAgentModels(
  provider: Provider,
  roles: AgentName[] = AGENTS.map(({ key }) => key),
  dependencies: { prompts: typeof p; discover: typeof discoverCodexModels } = {
    prompts: p,
    discover: discoverCodexModels,
  }
): Promise<Partial<Record<AgentName, CodexAgentModelChoice>>> {
  const prompts = dependencies.prompts
  const choices: Partial<Record<AgentName, CodexAgentModelChoice>> = {}
  if (provider !== 'codex-cli') return choices

  const catalog = await dependencies.discover()
  const recommendations = catalog.ok ? selectCodexRoleDefaults(catalog.data) : {}
  if (!catalog.ok) {
    prompts.log.warn(`Could not discover Codex models: ${catalog.error}`)
    prompts.log.info('Choose inherit or enter a model ID and supported effort manually.')
  }

  for (const agent of AGENTS.filter(({ key }) => roles.includes(key))) {
    const model = await prompts.select({
      message: `Model for ${agent.label}`,
      options: [
        { value: 'inherit', label: 'inherit (use project default)' },
        ...(catalog.ok
          ? catalog.data.map(({ id, label }) => ({ value: id, label: `${id} — ${label}` }))
          : [{ value: MANUAL_MODEL, label: 'Enter model ID manually' }]),
      ],
      initialValue: recommendations[agent.key]?.model ?? 'inherit',
    })
    if (prompts.isCancel(model)) cancel()

    const selected = model as string
    if (selected === 'inherit') {
      choices[agent.key] = {}
      continue
    }

    const discovered = catalog.ok ? catalog.data.find(({ id }) => id === selected) : undefined
    const modelId = discovered?.id ?? (await manualModelId(agent.label, prompts))
    if (!modelId) {
      choices[agent.key] = {}
      continue
    }

    const effort = discovered
      ? await selectEffort(
          agent.label,
          discovered.supportedReasoningEfforts,
          recommendations[agent.key]?.effort ?? discovered.defaultReasoningEffort,
          prompts
        )
      : await manualEffort(agent.label, prompts)
    choices[agent.key] = { model: modelId, ...(effort ? { effort } : {}) }
  }
  return choices
}

async function manualModelId(label: string, prompts: typeof p): Promise<string> {
  while (true) {
    const value = await prompts.text({ message: `Codex model ID for ${label}` })
    if (prompts.isCancel(value)) cancel()
    const modelId = value as string
    if (!modelId.trim() || !validateManualModelId(modelId)) return modelId
    prompts.log.warn(validateManualModelId(modelId)!)
  }
}

async function manualEffort(label: string, prompts: typeof p): Promise<string> {
  while (true) {
    const value = await prompts.text({ message: `Reasoning effort for ${label} (optional)` })
    if (prompts.isCancel(value)) cancel()
    const effort = value as string
    if (!effort.trim() || !validateManualReasoningEffort(effort)) return effort
    prompts.log.warn(validateManualReasoningEffort(effort)!)
  }
}

async function selectEffort(
  label: string,
  efforts: string[],
  defaultEffort: string | undefined,
  prompts: typeof p
): Promise<string | undefined> {
  if (efforts.length === 0) return undefined
  const value = await prompts.select({
    message: `Reasoning effort for ${label}`,
    options: efforts.map((effort) => ({ value: effort, label: effort })),
    initialValue: defaultEffort && efforts.includes(defaultEffort) ? defaultEffort : efforts[0],
  })
  if (prompts.isCancel(value)) cancel()
  return value as string
}

function cancel(): never {
  p.cancel('Cancelled.')
  process.exit(0)
}
