import type { Provider } from '@/types'

export type DelegationAudience = 'lead' | 'coordination-skill'

export type ProviderDelegationGuidance = {
  invoke: readonly string[]
  sequential: string
  parallel: string
  contextTransfer: string
  waitForCompletion: string
  inspectProgress?: string
}

export const PROVIDER_DELEGATION_GUIDANCE: Readonly<Record<Provider, ProviderDelegationGuidance>> = {
  'claude-code': {
    invoke: ['@mention'],
    sequential:
      'Use @<role-name> to delegate to a specific agent. Claude selects the subagent by role name.',
    parallel:
      'Launch multiple @mentions in a single message for parallel work.',
    contextTransfer:
      'Pass a self-contained objective, scope, known context, restrictions, and output contract with each @mention.',
    waitForCompletion:
      'Wait for each @mention to complete before proceeding to the next step.',
  },
  opencode: {
    invoke: ['@mention'],
    sequential:
      'Use @<role-name> to delegate to a specific agent. Child sessions need a self-contained objective.',
    parallel:
      'Launch multiple @mentions in a single message for parallel work.',
    contextTransfer:
      'Each child session needs: objective, scope, known context, restrictions, output contract.',
    waitForCompletion: 'Wait for each @mention to complete before proceeding.',
  },
  'codex-cli': {
    invoke: ['spawn', 'delegate', 'parallel', 'wait', 'summarize'],
    sequential:
      'Use spawn → delegate → wait → summarize pattern. Explicit commands for each step.',
    parallel:
      'Use parallel spawns for independent agents. Wait for all to complete.',
    contextTransfer:
      'Provide full context in the spawn command — no shared state between children.',
    waitForCompletion: 'Use explicit wait after spawning parallel tasks.',
    inspectProgress: 'Check progress via status commands between waits.',
  },
  'grok-cli': {
    invoke: ['project subagent', '/tasks'],
    sequential: 'Refer to project-defined subagents by role name.',
    parallel:
      'Launch multiple project subagents by role for parallel work.',
    contextTransfer:
      'Provide bounded context when delegating to subagents.',
    waitForCompletion: 'Wait for subagent completion before proceeding.',
    inspectProgress: 'Use /tasks to check progress of running subagents.',
  },
} satisfies Record<Provider, ProviderDelegationGuidance>

/**
 * Render a bounded delegation guidance block for the given provider.
 * Skips the `invoke` field (metadata only) and formats each remaining key
 * as a `- Label: value` bullet.
 */
export function renderDelegationGuidance(
  provider: Provider,
  _audience: DelegationAudience = 'lead'
): string {
  const guidance = PROVIDER_DELEGATION_GUIDANCE[provider]
  if (!guidance) return ''

  const lines: string[] = []
  for (const [key, value] of Object.entries(guidance)) {
    if (key === 'invoke') continue // metadata only
    const label = key
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, (s) => s.toUpperCase())
    lines.push(`- ${label}: ${value}`)
  }
  return lines.join('\n')
}
