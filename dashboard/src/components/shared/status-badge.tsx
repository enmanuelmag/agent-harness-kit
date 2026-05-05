interface Props {
  status: string
  size?: 'sm' | 'xs'
}

const styles: Record<string, string> = {
  pending:     'bg-neutral-900 text-neutral-400',
  in_progress: 'bg-amber-950 text-amber-400',
  done:        'bg-green-950 text-green-400',
  blocked:     'bg-red-950 text-red-400',
}

const labels: Record<string, string> = {
  in_progress: 'in progress',
}

export function StatusBadge({ status, size = 'sm' }: Props) {
  const cls = styles[status] ?? 'bg-neutral-900 text-neutral-500'
  const label = labels[status] ?? status
  const text = size === 'xs' ? 'text-[10px]' : 'text-xs'
  return (
    <span className={`${cls} ${text} font-mono px-2 py-0.5 rounded-sm`}>
      {label}
    </span>
  )
}
