export function EmptyTableRow({ cols, message = 'No data' }: { cols: number; message?: string }) {
  return (
    <tr>
      <td colSpan={cols} className="px-3 py-4 text-center font-mono text-xs text-neutral-600">
        {message}
      </td>
    </tr>
  )
}
