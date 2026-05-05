interface Props {
  title: string
  subtitle?: string
  right?: React.ReactNode
}

export function PageHeader({ title, subtitle, right }: Props) {
  return (
    <div className="flex items-start justify-between px-6 pt-6 pb-4 border-b border-[#1f1f1f]">
      <div>
        <h1 className="font-mono font-semibold text-base text-[#fafafa]">{title}</h1>
        {subtitle && <p className="text-xs text-neutral-500 mt-0.5">{subtitle}</p>}
      </div>
      {right && <div>{right}</div>}
    </div>
  )
}
