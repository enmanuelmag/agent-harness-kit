import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { api, qk, formatDate } from '@/lib/api';
import { StatusBadge } from '@/components/StatusBadge';
import { AgentBadge } from '@/components/AgentBadge';
import { PageHeader } from '@/components/PageHeader';
import { TimelineEntry } from '@/schema/api';

export const Route = createFileRoute('/')({
  component: Overview,
});

function Overview() {
  const stats = useQuery({ queryKey: qk.stats, queryFn: api.stats });
  const tasks = useQuery({ queryKey: qk.tasks, queryFn: api.tasks });
  const timeline = useQuery({
    queryKey: qk.timeline,
    queryFn: () => api.timeline(15),
  });

  const activeTasks =
    tasks.data?.filter((t) => t.status === 'in_progress') ?? [];
  const s = stats.data;

  return (
    <div>
      <PageHeader title="Overview" subtitle="Harness state at a glance" />

      <div className="p-6 space-y-6">
        {/* Status cards */}
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'Pending', key: 'pending', color: 'text-neutral-400' },
            {
              label: 'In Progress',
              key: 'in_progress',
              color: 'text-amber-400',
            },
            { label: 'Done', key: 'done', color: 'text-green-400' },
            { label: 'Blocked', key: 'blocked', color: 'text-red-400' },
          ].map(({ label, key, color }) => (
            <div
              key={key}
              className="bg-[#0a0a0a] border border-[#1f1f1f] rounded-md p-4"
            >
              <div className={`font-mono text-2xl font-semibold ${color}`}>
                {s ? (s.byStatus[key as keyof typeof s.byStatus] ?? 0) : '—'}
              </div>
              <div className="text-xs text-neutral-500 mt-1">{label}</div>
            </div>
          ))}
        </div>

        {/* Mini stats */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Total Actions', value: s?.totalActions },
            { label: 'Files Touched', value: s?.totalFiles },
            { label: 'Unique Tools', value: s?.uniqueTools },
          ].map(({ label, value }) => (
            <div
              key={label}
              className="bg-[#0a0a0a] border border-[#1f1f1f] rounded-md px-4 py-3 flex items-center gap-3"
            >
              <span className="font-mono text-lg text-[#fafafa]">
                {value ?? '—'}
              </span>
              <span className="text-xs text-neutral-500">{label}</span>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-6">
          {/* Active tasks */}
          <div>
            <h2 className="font-mono text-xs text-neutral-500 uppercase tracking-wider mb-3">
              Active Tasks
            </h2>
            {activeTasks.length === 0 ? (
              <p className="text-xs text-neutral-600 font-mono">
                No tasks in progress
              </p>
            ) : (
              <div className="space-y-2">
                {activeTasks.map((t) => (
                  <Link
                    key={t.id}
                    to="/tasks/$id"
                    params={{ id: String(t.id) }}
                    className="block bg-[#0a0a0a] border border-[#1f1f1f] rounded-md p-3 hover:border-neutral-700 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-mono text-sm text-[#fafafa] truncate">
                          {t.title}
                        </div>
                        <div className="font-mono text-xs text-neutral-600 mt-0.5">
                          {t.slug}
                        </div>
                      </div>
                      {t.assigned_to && (
                        <AgentBadge agent={t.assigned_to} size="xs" />
                      )}
                    </div>
                    {t.acceptance_total > 0 && (
                      <div className="mt-2">
                        <div className="flex justify-between text-[10px] font-mono text-neutral-600 mb-1">
                          <span>acceptance</span>
                          <span>
                            {t.acceptance_met}/{t.acceptance_total}
                          </span>
                        </div>
                        <div className="w-full bg-neutral-900 rounded-full h-1">
                          <div
                            className="bg-green-600 h-1 rounded-full transition-all"
                            style={{
                              width: `${(t.acceptance_met / t.acceptance_total) * 100}%`,
                            }}
                          />
                        </div>
                      </div>
                    )}
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Recent timeline */}
          <div>
            <h2 className="font-mono text-xs text-neutral-500 uppercase tracking-wider mb-3">
              Recent Activity
            </h2>
            <div className="space-y-1">
              {(timeline.data ?? []).map((entry) => (
                <TimelineRow key={entry.id} entry={entry} />
              ))}
              {timeline.data?.length === 0 && (
                <p className="text-xs text-neutral-600 font-mono">
                  No activity yet
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TimelineRow({ entry }: { entry: TimelineEntry }) {
  return (
    <Link
      to="/tasks/$id"
      params={{ id: String(entry.task_id) }}
      className="flex items-start gap-2 px-2 py-1.5 rounded hover:bg-[#0a0a0a] transition-colors group"
    >
      <AgentBadge agent={entry.agent} size="xs" />
      <div className="min-w-0 flex-1">
        <div className="text-xs text-neutral-300 truncate group-hover:text-white transition-colors">
          {entry.summary ?? entry.task_title}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="font-mono text-[10px] text-neutral-600">
            {entry.task_slug}
          </span>
          <StatusBadge status={entry.status} size="xs" />
        </div>
      </div>
      <span className="font-mono text-[10px] text-neutral-700 shrink-0">
        {formatDate(entry.created_at)}
      </span>
    </Link>
  );
}
