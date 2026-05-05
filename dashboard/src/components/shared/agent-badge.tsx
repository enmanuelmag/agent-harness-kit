interface Props {
  agent: string
  size?: 'sm' | 'xs'
}

const styles: Record<string, string> = {
  lead:     'bg-violet-950 text-violet-400',
  explorer: 'bg-sky-950 text-sky-300',
  builder:  'bg-green-950 text-green-400',
  reviewer: 'bg-amber-950 text-amber-400',
}

function agentStyle(agent: string): string {
  if (agent.startsWith('custom:')) return 'bg-neutral-900 text-neutral-300'
  return styles[agent] ?? 'bg-neutral-900 text-neutral-400'
}

export function AgentBadge({ agent, size = 'sm' }: Props) {
  const text = size === 'xs' ? 'text-[10px]' : 'text-xs'
  return (
    <span className={`${agentStyle(agent)} ${text} font-mono px-2 py-0.5 rounded-sm`}>
      {agent}
    </span>
  )
}
