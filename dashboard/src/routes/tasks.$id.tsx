import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';

import { AgentBadge } from '@/components/shared/agent-badge';
import { ErrorState } from '@/components/shared/error-state';
import { LoadingState } from '@/components/shared/loading-state';
import { OperationBadge } from '@/components/shared/operation-badge';
import { PageHeader } from '@/components/shared/page-header';
import { StatusBadge } from '@/components/shared/status-badge';
import {
  ActionCard,
  SectionTitle,
  TimestampItem,
} from '@/components/task-detail/indx';
import { api, formatDate, formatDuration,qk } from '@/lib/api';

export const Route = createFileRoute('/tasks/$id')({
  component: TaskDetailPage,
});

function TaskDetailPage() {
  const { id } = Route.useParams();
  const {
    data: task,
    isLoading,
    isError,
  } = useQuery({
    queryKey: qk.task(Number(id)),
    queryFn: () => api.task(Number(id)),
  });

  if (isLoading) return <LoadingState />;
  if (isError || !task) return <ErrorState message="Task not found" backTo="/tasks" backLabel="← Back to tasks" />;

  const doneCount = task.acceptance.filter((a) => a.met).length;

  return (
    <div>
      <PageHeader
        title={task.title}
        subtitle={task.slug}
        right={
          <div className="flex items-center gap-2">
            <StatusBadge status={task.status} />
            {task.assigned_to && <AgentBadge agent={task.assigned_to} />}
          </div>
        }
      />

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
                    <span
                      className={`text-xs ${a.met ? 'text-neutral-300' : 'text-neutral-500'}`}
                    >
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
              <p className="text-sm text-neutral-400 mt-2 leading-relaxed">
                {task.description}
              </p>
            </div>
          )}
        </div>

        {/* Actions timeline */}
        {task.actions.length > 0 && (
          <div>
            <SectionTitle>
              Actions Timeline ({task.actions.length})
            </SectionTitle>
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
                      <td className="px-3 py-2 text-xs text-neutral-600">
                        {f.notes ?? '—'}
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

