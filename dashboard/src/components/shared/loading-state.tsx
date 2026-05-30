export function LoadingState() {
  return <div className="p-6 font-mono text-xs text-[var(--color-text-faint)]">Loading…</div>
}

export function LoadingTableRow({ cols }: { cols: number }) {
  return (
    <tr>
      <td colSpan={cols} className="px-3 py-4 text-center font-mono text-xs text-[var(--color-text-faint)]">
        Loading…
      </td>
    </tr>
  )
}
