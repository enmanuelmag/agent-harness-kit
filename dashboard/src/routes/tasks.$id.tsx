import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'

import { AgentBadge } from '@/components/shared/agent-badge'
import { ErrorState } from '@/components/shared/error-state'
import { LoadingState } from '@/components/shared/loading-state'
import { OperationBadge } from '@/components/shared/operation-badge'
import { PageHeader } from '@/components/shared/page-header'
import { StatusBadge } from '@/components/shared/status-badge'
import { ActionCard, SectionTitle, TimestampItem } from '@/components/task-detail/indx'
import { api, formatDate, formatDuration, qk } from '@/lib/api'

export const Route = createFileRoute('/tasks/$id')({
  component: TaskDetailPage,
})

function TaskDetailPage() {
  const { id } = Route.useParams()
  const {
    data: task,
    isLoading,
    isError,
  } = useQuery({
    queryKey: qk.task(Number(id)),
    queryFn: () => api.task(Number(id)),
  })

  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState(task?.title)
  const [editDescription, setEditDescription] = useState(task?.description ?? '')
  const [editAcceptance, setEditAcceptance] = useState(
    task?.acceptance.map((a) => a.criterion) ?? []
  )

  if (isLoading) return <LoadingState />
  if (isError || !task)
    return <ErrorState message="Task not found" backTo="/tasks" backLabel="← Back to tasks" />

  const addAcField = () => setEditAcceptance([...editAcceptance, ''])

  const handleSave = async () => {
    await api.updateTask(Number(id), {
      title: editTitle,
      description: editDescription || null,
      acceptance: editAcceptance.filter((a) => a.trim() !== ''),
    })
    setEditing(false)
    window.location.reload()
  }

  const doneCount = task.acceptance.filter((a) => a.met).length

  const handleArchive = async () => {
    await api.archiveTask(Number(id))
    window.location.reload()
  }

  const handleUnarchive = async () => {
    await api.unarchiveTask(Number(id))
    window.location.reload()
  }

  return (
    <div>
      <PageHeader
        title={task.title}
        subtitle={task.slug}
        right={
          <div className="flex items-center gap-2">
            <StatusBadge status={task.status} />
            {task.assigned_to && <AgentBadge agent={task.assigned_to} />}
            {task.archived_at ? (
              <button
                onClick={handleUnarchive}
                className="text-xs font-mono text-yellow-500 hover:text-yellow-400 border border-yellow-900/50 px-3 py-1 rounded"
              >
                Unarchive
              </button>
            ) : (
              <button
                onClick={handleArchive}
                className="text-xs font-mono text-neutral-500 hover:text-red-400 border border-[#1f1f1f] px-3 py-1 rounded"
              >
                Archive
              </button>
            )}
          </div>
        }
      />

      {/* Edit button */}
      <div className="px-6">
        <button
          onClick={() => setEditing(true)}
          className="text-xs font-mono text-neutral-500 hover:text-[#fafafa] border border-[#1f1f1f] px-3 py-1.5 rounded transition-colors"
        >
          Edit
        </button>
      </div>

      {/* Edit modal */}
      {editing && (
        <div
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center"
          onClick={() => setEditing(false)}
        >
          <div
            className="bg-[#0a0a0a] border border-[#1f1f1f] rounded-lg p-6 w-full max-w-lg mx-4 max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-mono text-sm text-[#fafafa] mb-4">Edit Task</h3>
            <div className="space-y-4">
              <div>
                <label className="text-xs text-neutral-500 font-mono block mb-1">Title</label>
                <input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full bg-black border border-[#1f1f1f] rounded px-3 py-2 text-sm text-[#fafafa] font-mono outline-none focus:border-neutral-600"
                />
              </div>
              <div>
                <label className="text-xs text-neutral-500 font-mono block mb-1">Description</label>
                <textarea
                  value={editDescription ?? ''}
                  onChange={(e) => setEditDescription(e.target.value)}
                  className="w-full bg-black border border-[#1f1f1f] rounded px-3 py-2 text-sm text-[#fafafa] font-mono outline-none focus:border-neutral-600 resize-none h-20"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-neutral-500 font-mono">Acceptance Criteria</span>
                  <button
                    onClick={addAcField}
                    className="text-xs font-mono text-green-500 hover:text-green-400"
                  >
                    + Add
                  </button>
                </div>
                <div className="space-y-2">
                  {editAcceptance.map((ac, i) => (
                    // eslint-disable-next-line @eslint-react/no-array-index-key
                    <div key={`index-${i}`} className="flex gap-2">
                      <span className="text-xs text-neutral-600 font-mono mt-2 shrink-0">
                        #{i + 1}
                      </span>
                      <input
                        value={ac}
                        onChange={(e) => {
                          const next = [...editAcceptance]
                          next[i] = e.target.value
                          setEditAcceptance(next)
                        }}
                        className="flex-1 bg-black border border-[#1f1f1f] rounded px-3 py-2 text-sm text-[#fafafa] font-mono outline-none focus:border-neutral-600"
                      />
                      <button
                        onClick={() => setEditAcceptance(editAcceptance.filter((_, j) => j !== i))}
                        className="text-xs text-red-500 hover:text-red-400 mt-2"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setEditing(false)}
                className="text-xs font-mono text-neutral-500 hover:text-neutral-300 px-3 py-1.5"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                className="text-xs font-mono bg-[#fafafa] text-black px-3 py-1.5 rounded hover:bg-white"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="p-6 space-y-6">
        {/* Timestamps */}
        <div className="flex gap-6 text-xs font-mono">
          <TimestampItem label="Created" value={formatDate(task.created_at)} />
          <span className="text-neutral-700">→</span>
          <TimestampItem
            label="Started"
            value={task.started_at ? formatDate(task.started_at) : '—'}
          />
          <span className="text-neutral-700">→</span>
          <TimestampItem
            label="Completed"
            value={task.completed_at ? formatDate(task.completed_at) : '—'}
          />
          {task.started_at && (
            <>
              <span className="text-neutral-700">·</span>
              <TimestampItem
                label="Duration"
                value={formatDuration(task.started_at, task.completed_at)}
              />
            </>
          )}
          {task.archived_at && (
            <>
              <span className="text-neutral-700">·</span>
              <TimestampItem label="Archived" value={formatDate(task.archived_at)} />
            </>
          )}
        </div>

        <div className="grid grid-cols-3 gap-6">
          {/* Acceptance criteria */}
          {task.acceptance.length > 0 && (
            <div className="col-span-1">
              <SectionTitle>
                Acceptance Criteria{' '}
                <span className="text-neutral-600">
                  ({doneCount}/{task.acceptance.length})
                </span>
              </SectionTitle>
              <div className="space-y-1.5 mt-2">
                {task.acceptance.map((a) => (
                  <div key={a.id} className="flex items-start gap-2">
                    <span
                      className={`mt-0.5 text-xs font-mono shrink-0 ${a.met ? 'text-green-400' : 'text-neutral-700'}`}
                    >
                      {a.met ? '✓' : '○'}
                    </span>
                    <span className={`text-xs ${a.met ? 'text-neutral-300' : 'text-neutral-500'}`}>
                      {a.criterion}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Description */}
          {task.description && (
            <div className="col-span-2">
              <SectionTitle>Description</SectionTitle>
              <p className="text-sm text-neutral-400 mt-2 leading-relaxed">{task.description}</p>
            </div>
          )}
        </div>

        {/* Actions timeline */}
        {task.actions.length > 0 && (
          <div>
            <SectionTitle>Actions Timeline ({task.actions.length})</SectionTitle>
            <div className="mt-3 space-y-2">
              {task.actions.map((action) => (
                <ActionCard key={action.id} action={action} />
              ))}
            </div>
          </div>
        )}

        {/* Files touched */}
        {task.actions.some((a) => a.files.length > 0) && (
          <div>
            <SectionTitle>Files Touched</SectionTitle>
            <table className="w-full mt-2 text-sm">
              <thead>
                <tr className="border-b border-[#1f1f1f]">
                  {['Operation', 'File Path', 'Agent', 'Notes'].map((h) => (
                    <th
                      key={h}
                      className="text-left font-mono text-[10px] text-neutral-600 uppercase tracking-wider px-3 py-2"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {task.actions.flatMap((action) =>
                  action.files.map((f) => (
                    <tr key={f.id} className="border-b border-[#1f1f1f]">
                      <td className="px-3 py-2">
                        <OperationBadge op={f.operation} />
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-neutral-300">
                        {f.file_path}
                      </td>
                      <td className="px-3 py-2">
                        <AgentBadge agent={action.agent} size="xs" />
                      </td>
                      <td className="px-3 py-2 text-xs text-neutral-600">{f.notes ?? '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
