import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useMemo, useState } from 'react';

import { AgentBadge } from '@/components/shared/agent-badge';
import { EmptyTableRow } from '@/components/shared/empty-table-row';
import { LoadingTableRow } from '@/components/shared/loading-state';
import { PageHeader } from '@/components/shared/page-header';
import { StatusBadge } from '@/components/shared/status-badge';
import { api, formatDate, qk } from '@/lib/api';

import type { TaskSummary } from '@/schema/api';

export const Route = createFileRoute('/tasks/')({
  component: Tasks,
});

type Filter = 'all' | 'pending' | 'in_progress' | 'done' | 'blocked' | 'archived';
type ViewMode = 'list' | 'board';
type SortField = 'status' | 'created';
type SortDir = 'asc' | 'desc';

interface SortConfig {
  field: SortField | null;
  dir: SortDir;
}

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'done', label: 'Done' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'archived', label: 'Archived' },
];

const VIEWS: { value: ViewMode; label: string }[] = [
  { value: 'list', label: 'List' },
  { value: 'board', label: 'Board' },
];

const BOARD_COLUMNS: { status: string; label: string; color: string }[] = [
  { status: 'pending', label: 'Pending', color: 'text-neutral-400' },
  { status: 'in_progress', label: 'In Progress', color: 'text-amber-400' },
  { status: 'done', label: 'Done', color: 'text-green-400' },
  { status: 'blocked', label: 'Blocked', color: 'text-red-400' },
];

function lastUpdate(t: TaskSummary): string {
  return t.completed_at ?? t.started_at ?? t.created_at;
}

function Tasks() {
  const [filter, setFilter] = useState<Filter>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [sortConfig, setSortConfig] = useState<SortConfig>({ field: null, dir: 'asc' });
  const { data: tasks = [], isLoading } = useQuery({
    queryKey: qk.allTasks(true),
    queryFn: () => api.allTasks(true),
  });

  const filtered =
    filter === 'all'
      ? tasks.filter((t) => !t.archived_at)
      : filter === 'archived'
        ? tasks.filter((t) => t.archived_at)
        : tasks.filter((t) => t.status === filter && !t.archived_at);

  const sorted = useMemo(() => {
    if (!sortConfig.field) return filtered;
    return [...filtered].sort((a, b) => {
      if (sortConfig.field === 'status') {
        const cmp = a.status.localeCompare(b.status);
        return sortConfig.dir === 'asc' ? cmp : -cmp;
      }
      if (sortConfig.field === 'created') {
        const cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        return sortConfig.dir === 'asc' ? cmp : -cmp;
      }
      return 0;
    });
  }, [filtered, sortConfig]);

  const boardColumns = useMemo(() => {
    const groups: Record<string, TaskSummary[]> = {
      pending: [],
      in_progress: [],
      done: [],
      blocked: [],
    };
    for (const t of filtered) {
      if (groups[t.status]) {
        groups[t.status].push(t);
      }
    }
    for (const key of Object.keys(groups)) {
      groups[key].sort(
        (a, b) => new Date(lastUpdate(b)).getTime() - new Date(lastUpdate(a)).getTime(),
      );
    }
    return groups;
  }, [filtered]);

  return (
    <div>
      <PageHeader
        title="Tasks"
        subtitle={`${filtered.length} task${filtered.length !== 1 ? 's' : ''}`}
        right={
          <div className="flex gap-1 items-center">
            {VIEWS.map(({ value, label }) => (
              <button
                key={value}
                onClick={() => setViewMode(value)}
                className={`font-mono text-xs px-3 py-1.5 rounded transition-colors ${
                  viewMode === value
                    ? 'bg-[#0a0a0a] text-[#fafafa] border border-[#3a3a3a]'
                    : 'text-neutral-500 hover:text-neutral-300 border border-transparent'
                }`}
              >
                {label}
              </button>
            ))}
            <span className="w-px h-5 bg-[#1f1f1f] mx-1" />
            {FILTERS.map(({ value, label }) => (
              <button
                key={value}
                onClick={() => setFilter(value)}
                className={`font-mono text-xs px-3 py-1.5 rounded transition-colors ${
                  filter === value
                    ? 'bg-[#0a0a0a] text-[#fafafa] border border-[#3a3a3a]'
                    : 'text-neutral-500 hover:text-neutral-300 border border-transparent'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        }
      />

      {viewMode === 'list' ? (
        <ListView tasks={sorted} sortConfig={sortConfig} onSortChange={setSortConfig} isLoading={isLoading} />
      ) : (
        <BoardView columns={boardColumns} />
      )}
    </div>
  );
}

// ─── List View ────────────────────────────────────────────────────────────────

function ListView({
  tasks,
  sortConfig,
  onSortChange,
  isLoading,
}: {
  tasks: TaskSummary[];
  sortConfig: SortConfig;
  onSortChange: (config: SortConfig) => void;
  isLoading: boolean;
}) {
  const handleSort = (field: SortField) => {
    if (sortConfig.field === field) {
      onSortChange({ field, dir: sortConfig.dir === 'asc' ? 'desc' : 'asc' });
    } else {
      onSortChange({ field, dir: 'asc' });
    }
  };

  const sortArrow = (field: SortField) => {
    if (sortConfig.field !== field) return '';
    return sortConfig.dir === 'asc' ? ' ▲' : ' ▼';
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[#1f1f1f]">
            <th className="text-left font-mono text-[10px] text-neutral-600 uppercase tracking-wider px-4 py-3">
              #
            </th>
            <th className="text-left font-mono text-[10px] text-neutral-600 uppercase tracking-wider px-4 py-3">
              Title
            </th>
            <th className="text-left font-mono text-[10px] text-neutral-600 uppercase tracking-wider px-4 py-3">
              Slug
            </th>
            <th
              className="text-left font-mono text-[10px] text-neutral-600 uppercase tracking-wider px-4 py-3 cursor-pointer select-none hover:text-neutral-400 transition-colors"
              onClick={() => handleSort('status')}
            >
              Status{sortArrow('status')}
            </th>
            <th className="text-left font-mono text-[10px] text-neutral-600 uppercase tracking-wider px-4 py-3">
              Assigned
            </th>
            <th className="text-left font-mono text-[10px] text-neutral-600 uppercase tracking-wider px-4 py-3">
              Acceptance
            </th>
            <th
              className="text-left font-mono text-[10px] text-neutral-600 uppercase tracking-wider px-4 py-3 cursor-pointer select-none hover:text-neutral-400 transition-colors"
              onClick={() => handleSort('created')}
            >
              Created{sortArrow('created')}
            </th>
            <th className="text-left font-mono text-[10px] text-neutral-600 uppercase tracking-wider px-4 py-3">
              Archived
            </th>
          </tr>
        </thead>
        <tbody>
          {isLoading && <LoadingTableRow cols={8} />}
          {tasks.map((t) => (
            <TaskRow key={t.id} task={t} />
          ))}
          {!isLoading && tasks.length === 0 && <EmptyTableRow cols={8} message="No tasks" />}
        </tbody>
      </table>
    </div>
  );
}

function TaskRow({ task }: { task: TaskSummary }) {
  return (
    <tr className="border-b border-[#1f1f1f] hover:bg-[#0a0a0a] transition-colors group">
      <td className="px-4 py-3 font-mono text-xs text-neutral-600">{task.id}</td>
      <td className="px-4 py-3">
        <Link
          to="/tasks/$id"
          params={{ id: String(task.id) }}
          className="font-mono text-sm text-[#fafafa] hover:text-green-400 transition-colors"
        >
          {task.title}
        </Link>
        {task.description && (
          <div className="text-xs text-neutral-600 mt-0.5 truncate max-w-xs">{task.description}</div>
        )}
      </td>
      <td className="px-4 py-3 font-mono text-xs text-neutral-500">{task.slug}</td>
      <td className="px-4 py-3">
        <StatusBadge status={task.status} />
      </td>
      <td className="px-4 py-3">
        {task.assigned_to ? (
          <AgentBadge agent={task.assigned_to} size="xs" />
        ) : (
          <span className="text-neutral-700 text-xs">—</span>
        )}
      </td>
      <td className="px-4 py-3">
        {task.acceptance_total > 0 ? (
          <div className="flex items-center gap-2">
            <div className="w-16 bg-neutral-900 rounded-full h-1">
              <div
                className="bg-green-600 h-1 rounded-full"
                style={{
                  width: `${(task.acceptance_met / task.acceptance_total) * 100}%`,
                }}
              />
            </div>
            <span className="font-mono text-[10px] text-neutral-600">
              {task.acceptance_met}/{task.acceptance_total}
            </span>
          </div>
        ) : (
          <span className="text-neutral-700 text-xs">—</span>
        )}
      </td>
      <td className="px-4 py-3 font-mono text-xs text-neutral-600">{formatDate(task.created_at)}</td>
      <td className="px-4 py-3">
        {task.archived_at ? (
          <span className="text-[10px] font-mono text-yellow-600/80 bg-yellow-500/5 px-2 py-0.5 rounded">
            archived
          </span>
        ) : (
          <span className="text-neutral-800 text-xs">—</span>
        )}
      </td>
    </tr>
  );
}

// ─── Board View ───────────────────────────────────────────────────────────────

function BoardView({ columns }: { columns: Record<string, TaskSummary[]> }) {
  return (
    <div className="overflow-x-auto px-6 pb-6">
      <div className="flex gap-4 min-h-[calc(100vh-12rem)]">
        {BOARD_COLUMNS.map(({ status, label, color }) => {
          const tasks = columns[status] ?? [];
          return (
            <div key={status} className="w-72 shrink-0 flex flex-col">
              <div className="flex items-center gap-2 px-1 py-3 border-b border-[#1f1f1f] mb-3">
                <h3 className={`font-mono text-sm font-medium ${color}`}>{label}</h3>
                <span className="font-mono text-xs text-neutral-600">({tasks.length})</span>
              </div>
              <div className="flex-1 overflow-y-auto max-h-[calc(100vh-16rem)] space-y-2 pr-1">
                {tasks.length > 0 ? (
                  tasks.map((task) => <TaskCard key={task.id} task={task} />)
                ) : (
                  <div className="text-xs font-mono text-neutral-700 text-center py-8">No tasks</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TaskCard({ task }: { task: TaskSummary }) {
  return (
    <div className="border border-[#1f1f1f] rounded bg-black p-3 hover:bg-[#0a0a0a] transition-colors space-y-2">
      <div className="font-mono text-[10px] text-neutral-600">#{task.id}</div>
      <Link
        to="/tasks/$id"
        params={{ id: String(task.id) }}
        className="font-mono text-sm text-[#fafafa] hover:text-green-400 transition-colors block"
      >
        {task.title}
      </Link>
      <div className="flex items-center gap-2">
        {task.assigned_to ? (
          <AgentBadge agent={task.assigned_to} size="xs" />
        ) : (
          <span className="text-neutral-700 text-xs">—</span>
        )}
      </div>
      {task.acceptance_total > 0 && (
        <div className="flex items-center gap-2">
          <div className="flex-1 bg-neutral-900 rounded-full h-1">
            <div
              className="bg-green-600 h-1 rounded-full"
              style={{ width: `${(task.acceptance_met / task.acceptance_total) * 100}%` }}
            />
          </div>
          <span className="font-mono text-[10px] text-neutral-600">
            {task.acceptance_met}/{task.acceptance_total}
          </span>
        </div>
      )}
      <div className="font-mono text-[10px] text-neutral-600">{formatDate(task.created_at)}</div>
    </div>
  );
}
