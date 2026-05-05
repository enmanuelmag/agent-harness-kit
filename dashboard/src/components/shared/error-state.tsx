import { Link } from '@tanstack/react-router'

interface ErrorStateProps {
  message?: string
  backTo?: string
  backLabel?: string
}

export function ErrorState({ message = 'Something went wrong', backTo, backLabel = '← Back' }: ErrorStateProps) {
  return (
    <div className="p-6">
      {backTo && (
        <Link to={backTo} className="font-mono text-xs text-neutral-500 hover:text-neutral-300 transition-colors">
          {backLabel}
        </Link>
      )}
      <p className="font-mono text-xs text-red-400 mt-4">{message}</p>
    </div>
  )
}

export function ErrorTableRow({ cols, message = 'Failed to load data' }: { cols: number; message?: string }) {
  return (
    <tr>
      <td colSpan={cols} className="px-3 py-4 text-center font-mono text-xs text-red-400">
        {message}
      </td>
    </tr>
  )
}
