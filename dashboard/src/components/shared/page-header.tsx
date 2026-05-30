interface Props {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}

export function PageHeader({ title, subtitle, right }: Props) {
  return (
    <div className="flex items-start justify-between px-6 pt-6 pb-4 border-b border-[var(--color-border)]">
      <div>
        <h1 className="font-mono font-semibold text-base text-[var(--color-text-primary)]">
          {title}
        </h1>
        {subtitle && (
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{subtitle}</p>
        )}
      </div>
      {right != null && right != undefined && <div>{right}</div>}
    </div>
  );
}
