interface Props {
  status: string
  size?: 'sm' | 'xs'
}

const styles: Record<string, string> = {
  pending:     'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400',
  in_progress: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
  done:        'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400',
  blocked:     'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400',
  completed:   'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-400',
}

const labels: Record<string, string> = {
  in_progress: 'in progress',
}

export function StatusBadge({ status, size = 'sm' }: Props) {
  const cls = styles[status] ?? 'bg-neutral-100 text-neutral-500 dark:bg-neutral-900 dark:text-neutral-500'
  const label = labels[status] ?? status
  const text = size === 'xs' ? 'text-[10px]' : 'text-xs'
  return (
    <span className={`${cls} ${text} font-mono px-2 py-0.5 rounded-sm`}>
      {label}
    </span>
  )
}
