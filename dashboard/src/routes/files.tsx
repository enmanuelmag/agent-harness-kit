import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'

import { AgentBadge } from '@/components/shared/agent-badge'
import { EmptyTableRow } from '@/components/shared/empty-table-row'
import { LoadingTableRow } from '@/components/shared/loading-state'
import { OperationBadge } from '@/components/shared/operation-badge'
import { PageHeader } from '@/components/shared/page-header'
import { api, formatDate, qk } from '@/lib/api'

import type { RecentFile } from '@/schema/api'

export const Route = createFileRoute('/files')({
  component: FilesPage,
})

function FilesPage() {
  const topFiles = useQuery({
    queryKey: qk.topFiles,
    queryFn: () => api.topFiles(25),
  })
  const recentFiles = useQuery({
    queryKey: qk.recentFiles,
    queryFn: () => api.recentFiles(60),
  })

  return (
    <div>
      <PageHeader title="Files" subtitle="File operations across all agent actions" />

      <div className="p-6 space-y-8">
        {/* Most-touched files */}
        <div>
          <h2 className="font-mono text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-3">
            Most Touched
          </h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                {['File Path', 'Total', 'Read', 'Created', 'Modified', 'Deleted'].map((h) => (
                  <th
                    key={h}
                    className="text-left font-mono text-[10px] text-[var(--color-text-faint)] uppercase tracking-wider px-4 py-2"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {topFiles.isLoading && <LoadingTableRow cols={6} />}
              {(topFiles.data ?? []).map((f) => (
                <tr
                  key={f.file_path}
                  className="border-b border-[var(--color-border)] hover:bg-[var(--color-bg-surface)] transition-colors"
                >
                  <td className="px-4 py-2 font-mono text-xs text-[var(--color-text-secondary)] max-w-xs truncate">
                    {f.file_path}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-[var(--color-text-secondary)]">
                    {f.total}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-[var(--color-text-faint)]">
                    {f.read || '—'}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-green-400">{f.created || '—'}</td>
                  <td className="px-4 py-2 font-mono text-xs text-amber-400">
                    {f.modified || '—'}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-red-400">{f.deleted || '—'}</td>
                </tr>
              ))}
              {!topFiles.isLoading && topFiles.data?.length === 0 && (
                <EmptyTableRow cols={6} message="No file activity yet" />
              )}
            </tbody>
          </table>
        </div>

        {/* Recent file ops */}
        <div>
          <h2 className="font-mono text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-3">
            Recent Operations
          </h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                {['Op', 'File Path', 'Agent', 'Task', 'Notes', 'When'].map((h) => (
                  <th
                    key={h}
                    className="text-left font-mono text-[10px] text-[var(--color-text-faint)] uppercase tracking-wider px-4 py-2"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recentFiles.isLoading && <LoadingTableRow cols={6} />}
              {(recentFiles.data ?? []).map((f) => (
                <RecentFileRow key={f.id} file={f} />
              ))}
              {!recentFiles.isLoading && recentFiles.data?.length === 0 && (
                <EmptyTableRow cols={6} message="No recent operations" />
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function RecentFileRow({ file }: { file: RecentFile }) {
  return (
    <tr className="border-b border-[var(--color-border)] hover:bg-[var(--color-bg-surface)] transition-colors">
      <td className="px-4 py-2">
        <OperationBadge op={file.operation} />
      </td>
      <td className="px-4 py-2 font-mono text-xs text-[var(--color-text-secondary)] max-w-[220px] truncate">
        {file.file_path}
      </td>
      <td className="px-4 py-2">
        <AgentBadge agent={file.agent} size="xs" />
      </td>
      <td className="px-4 py-2 font-mono text-xs text-[var(--color-text-muted)] max-w-[120px] truncate">
        {file.task_slug}
      </td>
      <td className="px-4 py-2 text-xs text-[var(--color-text-faint)] max-w-[160px] truncate">
        {file.notes ?? '—'}
      </td>
      <td className="px-4 py-2 font-mono text-[10px] text-[var(--color-text-faint)]">
        {formatDate(file.called_at)}
      </td>
    </tr>
  )
}
