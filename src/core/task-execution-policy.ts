import type { AgentName, TaskExecutionMode } from '@/types'

/** The policy is intentionally independent of MCP. It is also used by CLI and
 * dashboard callers through HarnessDB, so prompts cannot bypass it. */
export function canStartAction(mode: TaskExecutionMode, agent: AgentName): boolean {
  if (mode === 'normal' || mode === 'repair') return true
  return agent !== 'builder' && !agent.startsWith('custom:')
}

export function actionDeniedMessage(mode: TaskExecutionMode, agent: AgentName): string {
  return (
    `Cannot start ${agent} work while task execution mode is '${mode}'. ` +
    `Only diagnostic roles may work while blocked/checking/verifying; begin an audited repair to authorize implementation.`
  )
}
