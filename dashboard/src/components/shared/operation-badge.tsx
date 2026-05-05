interface Props { op: string }

const styles: Record<string, string> = {
  read:     'text-neutral-400',
  created:  'text-green-400',
  modified: 'text-amber-400',
  deleted:  'text-red-400',
}

export function OperationBadge({ op }: Props) {
  const cls = styles[op] ?? 'text-neutral-500'
  return <span className={`${cls} font-mono text-xs`}>{op}</span>
}
