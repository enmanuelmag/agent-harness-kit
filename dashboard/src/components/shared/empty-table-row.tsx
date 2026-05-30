export function EmptyTableRow({ cols, message = 'No data' }: { cols: number; message?: string }) {
  return (
    <tr>
      <td colSpan={cols} className="px-3 py-4 text-center font-mono text-xs text-[var(--color-text-faint)]">
        {message}
      </td>
    </tr>
  )
}
