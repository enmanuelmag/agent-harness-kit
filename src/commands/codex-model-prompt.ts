import * as p from '@clack/prompts'

import {
  discoverCodexModels,
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
  provider: Provider
): Promise<Partial<Record<AgentName, CodexAgentModelChoice>>> {
  const choices: Partial<Record<AgentName, CodexAgentModelChoice>> = {}
  if (provider !== 'codex-cli') return choices

  const catalog = await discoverCodexModels()
  if (!catalog.ok) {
    p.log.warn(`Could not discover Codex models: ${catalog.error}`)
    p.log.info('Choose inherit or enter a model ID and supported effort manually.')
  }

  for (const agent of AGENTS) {
    const model = await p.select({
      message: `Model for ${agent.label}`,
      options: [
        { value: 'inherit', label: 'inherit (use project default)' },
        ...(catalog.ok
          ? catalog.data.map(({ id, label }) => ({ value: id, label: `${id} — ${label}` }))
          : [{ value: MANUAL_MODEL, label: 'Enter model ID manually' }]),
      ],
      initialValue: 'inherit',
    })
    if (p.isCancel(model)) cancel()

    const selected = model as string
    if (selected === 'inherit') {
      choices[agent.key] = {}
      continue
    }

    const discovered = catalog.ok ? catalog.data.find(({ id }) => id === selected) : undefined
    const modelId = discovered?.id ?? (await manualModelId(agent.label))
    if (!modelId) {
      choices[agent.key] = {}
      continue
    }

    const effort = discovered
      ? await selectEffort(agent.label, discovered.supportedReasoningEfforts, discovered.defaultReasoningEffort)
      : await manualEffort(agent.label)
    choices[agent.key] = { model: modelId, ...(effort ? { effort } : {}) }
  }
  return choices
}

async function manualModelId(label: string): Promise<string> {
  while (true) {
    const value = await p.text({ message: `Codex model ID for ${label}` })
    if (p.isCancel(value)) cancel()
    const modelId = value as string
    if (!modelId.trim() || !validateManualModelId(modelId)) return modelId
    p.log.warn(validateManualModelId(modelId)!)
  }
}

async function manualEffort(label: string): Promise<string> {
  while (true) {
    const value = await p.text({ message: `Reasoning effort for ${label} (optional)` })
    if (p.isCancel(value)) cancel()
    const effort = value as string
    if (!effort.trim() || !validateManualReasoningEffort(effort)) return effort
    p.log.warn(validateManualReasoningEffort(effort)!)
  }
}

async function selectEffort(
  label: string,
  efforts: string[],
  defaultEffort?: string
): Promise<string | undefined> {
  if (efforts.length === 0) return undefined
  const value = await p.select({
    message: `Reasoning effort for ${label}`,
    options: efforts.map((effort) => ({ value: effort, label: effort })),
    initialValue: defaultEffort && efforts.includes(defaultEffort) ? defaultEffort : efforts[0],
  })
  if (p.isCancel(value)) cancel()
  return value as string
}

function cancel(): never {
  p.cancel('Cancelled.')
  process.exit(0)
}
