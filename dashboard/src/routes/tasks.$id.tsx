import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, qk, formatDate, formatDuration } from '@/lib/api';
import { StatusBadge } from '@/components/StatusBadge';
import { AgentBadge } from '@/components/AgentBadge';
import { OperationBadge } from '@/components/OperationBadge';
import { PageHeader } from '@/components/PageHeader';
import { ActionDetail, ActionSection } from '@/schema/api';

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
  if (isError || !task) return <ErrorState />;

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

function ActionCard({ action }: { action: ActionDetail }) {
  const [expanded, setExpanded] = useState(false);
  const hasSections = action.sections.length > 0;
  const duration = formatDuration(action.created_at, action.completed_at);

  return (
    <div className="bg-[#0a0a0a] border border-[#1f1f1f] rounded-md">
      <button
        className="w-full flex items-start gap-3 p-3 text-left hover:bg-[#0f0f0f] transition-colors rounded-md"
        onClick={() => hasSections && setExpanded(!expanded)}
      >
        <AgentBadge agent={action.agent} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <StatusBadge status={action.status} size="xs" />
            <span className="font-mono text-xs text-neutral-600">
              {duration}
            </span>
            {action.tools.length > 0 && (
              <span className="font-mono text-[10px] text-neutral-700">
                {action.tools.length} tool{action.tools.length !== 1 ? 's' : ''}
              </span>
            )}
            {action.files.length > 0 && (
              <span className="font-mono text-[10px] text-neutral-700">
                {action.files.length} file{action.files.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          {action.summary && (
            <div className="text-xs text-neutral-400 mt-1">
              {action.summary}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="font-mono text-[10px] text-neutral-700">
            {formatDate(action.created_at)}
          </span>
          {hasSections && (
            <span className="text-neutral-600 text-xs">
              {expanded ? '▲' : '▼'}
            </span>
          )}
        </div>
      </button>

      {expanded && hasSections && (
        <div className="border-t border-[#1f1f1f] divide-y divide-[#1f1f1f]">
          {action.sections.map((section) => (
            <SectionBlock key={section.id} section={section} />
          ))}
        </div>
      )}
    </div>
  );
}

function SectionBlock({ section }: { section: ActionSection }) {
  return (
    <div className="px-3 py-2">
      <div className="font-mono text-[10px] text-neutral-600 uppercase tracking-wider mb-1">
        {section.section_type.replace(/_/g, ' ')}
      </div>
      <pre className="text-xs text-neutral-400 whitespace-pre-wrap font-mono leading-relaxed">
        {section.content}
      </pre>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-mono text-xs text-neutral-500 uppercase tracking-wider">
      {children}
    </h2>
  );
}

function TimestampItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-neutral-600 text-[10px]">{label}</div>
      <div className="text-neutral-300">{value}</div>
    </div>
  );
}

function LoadingState() {
  return <div className="p-6 font-mono text-xs text-neutral-600">Loading…</div>;
}

function ErrorState() {
  return (
    <div className="p-6">
      <Link
        to="/tasks"
        className="font-mono text-xs text-neutral-600 hover:text-neutral-400"
      >
        ← Back to tasks
      </Link>
      <p className="font-mono text-xs text-red-400 mt-4">Task not found</p>
    </div>
  );
}
