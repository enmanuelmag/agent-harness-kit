import * as p from '@clack/prompts'

import type { AgentName } from '@/core/materializer/agent-restrictions'
import type { CursorAgentModelChoice, Provider } from '@/types'

const AGENTS: { key: AgentName; label: string }[] = [
  { key: 'lead', label: 'Lead' },
  { key: 'explorer', label: 'Explorer' },
  { key: 'consultant', label: 'Consultant' },
  { key: 'builder', label: 'Builder' },
  { key: 'reviewer', label: 'Reviewer' },
]

/** Initial Cursor catalog. Accounts and team policy decide which choices are actually available. */
export const CURSOR_MODEL_CHOICES = [
  'inherit',
  'composer-2.5',
  'claude-sonnet-5',
  'claude-opus-5',
  'claude-fable-5.1',
  'gemini-3.1-pro',
  'gemini-3.8-flash',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
  'grok-4.6',
] as const

export async function promptCursorAgentModels(
  provider: Provider
): Promise<Partial<Record<AgentName, CursorAgentModelChoice>>> {
  const choices: Partial<Record<AgentName, CursorAgentModelChoice>> = {}
  if (provider !== 'cursor') return choices
  for (const agent of AGENTS) {
    const model = await p.select({
      message: `Model for ${agent.label}`,
      options: CURSOR_MODEL_CHOICES.map((value) => ({ value, label: value })),
      initialValue: 'inherit',
    })
    if (p.isCancel(model)) {
      p.cancel('Cancelled.')
      process.exit(0)
    }
    let selected = model as string
    if (selected !== 'inherit') {
      const parameter = await p.select({
        message: `Reasoning effort for ${agent.label} (only supported models honor it)`,
        options: [
          { value: '', label: 'Model default' },
          { value: '[effort=high]', label: 'High' },
        ],
        initialValue: '',
      })
      if (p.isCancel(parameter)) {
        p.cancel('Cancelled.')
        process.exit(0)
      }
      selected += parameter as string
    }
    choices[agent.key] = { model: selected }
  }
  return choices
}
