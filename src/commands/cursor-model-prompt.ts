import * as p from '@clack/prompts'

import { discoverCursorModels, validateManualModelId } from './model-catalog'

import type { AgentName } from '@/core/materializer/agent-restrictions'
import type { CursorAgentModelChoice, Provider } from '@/types'

const AGENTS: { key: AgentName; label: string }[] = [
  { key: 'lead', label: 'Lead' },
  { key: 'explorer', label: 'Explorer' },
  { key: 'consultant', label: 'Consultant' },
  { key: 'builder', label: 'Builder' },
  { key: 'reviewer', label: 'Reviewer' },
]
const MANUAL_MODEL = '__ahk_manual_model__'

export async function promptCursorAgentModels(
  provider: Provider
): Promise<Partial<Record<AgentName, CursorAgentModelChoice>>> {
  const choices: Partial<Record<AgentName, CursorAgentModelChoice>> = {}
  if (provider !== 'cursor') return choices

  const catalog = await discoverCursorModels()
  if (!catalog.ok) {
    p.log.warn(`Could not discover Cursor models: ${catalog.error}`)
    p.log.info('Choose inherit or enter a model ID supported by your Cursor CLI.')
  }

  for (const agent of AGENTS) {
    const model = await p.select({
      message: `Model for ${agent.label}`,
      options: [
        { value: 'inherit', label: 'inherit (use parent model)' },
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
    if (selected === MANUAL_MODEL) {
      const id = await manualModelId(agent.label)
      if (!id.trim()) {
        p.log.warn('A blank model ID means inherit.')
        choices[agent.key] = {}
      } else {
        choices[agent.key] = { model: id }
      }
      continue
    }
    // Cursor model IDs already encode their model-specific configuration.
    // Persist the selected CLI ID verbatim; never append a generic effort suffix.
    choices[agent.key] = { model: selected }
  }
  return choices
}

async function manualModelId(label: string): Promise<string> {
  while (true) {
    const value = await p.text({ message: `Cursor model ID for ${label}` })
    if (p.isCancel(value)) cancel()
    const modelId = value as string
    if (!modelId.trim() || !validateManualModelId(modelId)) return modelId
    p.log.warn(validateManualModelId(modelId)!)
  }
}

function cancel(): never {
  p.cancel('Cancelled.')
  process.exit(0)
}
