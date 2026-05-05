import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { api, qk } from '@/lib/api';
import { AgentBadge } from '@/components/shared/agent-badge';
import { LoadingState } from '@/components/shared/loading-state';
import { PageHeader } from '@/components/shared/page-header';
import { AgentStat } from '@/schema/api';

export const Route = createFileRoute('/agents')({
  component: AgentsPage,
});

function AgentsPage() {
  const { data: agents = [], isLoading } = useQuery({
    queryKey: qk.agentStats,
    queryFn: api.agentStats,
  });

  return (
    <div>
      <PageHeader title="Agents" subtitle="Activity breakdown per agent role" />

      <div className="p-6 space-y-4">
        {isLoading && <LoadingState />}

        <div className="grid grid-cols-2 gap-4">
          {agents.map((a) => (
            <AgentCard key={a.agent} stat={a} />
          ))}
        </div>

        {agents.length === 0 && !isLoading && (
          <p className="font-mono text-xs text-neutral-600">
            No agent activity yet.
          </p>
        )}

        {/* All actions table */}
        {agents.length > 0 && (
          <div className="mt-6">
            <h2 className="font-mono text-xs text-neutral-500 uppercase tracking-wider mb-3">
              Summary Table
            </h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#1f1f1f]">
                  {[
                    'Agent',
                    'Total Actions',
                    'Completed',
                    'Blocked',
                    'Tasks',
                    'Files',
                  ].map((h) => (
                    <th
                      key={h}
                      className="text-left font-mono text-[10px] text-neutral-600 uppercase tracking-wider px-4 py-2"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {agents.map((a) => (
                  <tr
                    key={a.agent}
                    className="border-b border-[#1f1f1f] hover:bg-[#0a0a0a] transition-colors"
                  >
                    <td className="px-4 py-3">
                      <AgentBadge agent={a.agent} />
                    </td>
                    <td className="px-4 py-3 font-mono text-sm">
                      {a.actions_total}
                    </td>
                    <td className="px-4 py-3 font-mono text-sm text-green-400">
                      {a.actions_done}
                    </td>
                    <td className="px-4 py-3 font-mono text-sm text-red-400">
                      {a.actions_blocked}
                    </td>
                    <td className="px-4 py-3 font-mono text-sm">
                      {a.tasks_worked}
                    </td>
                    <td className="px-4 py-3 font-mono text-sm">
                      {a.files_touched}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function AgentCard({ stat }: { stat: AgentStat }) {
  const pctDone =
    stat.actions_total > 0
      ? Math.round((stat.actions_done / stat.actions_total) * 100)
      : 0;

  return (
    <div className="bg-[#0a0a0a] border border-[#1f1f1f] rounded-md p-4 space-y-3">
      <div className="flex items-center justify-between">
        <AgentBadge agent={stat.agent} />
        <span className="font-mono text-xs text-neutral-600">
          {pctDone}% done
        </span>
      </div>

      <div className="w-full bg-neutral-900 rounded-full h-1">
        <div
          className="bg-green-700 h-1 rounded-full"
          style={{ width: `${pctDone}%` }}
        />
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        <Stat label="Actions" value={stat.actions_total} />
        <Stat
          label="Completed"
          value={stat.actions_done}
          color="text-green-400"
        />
        <Stat label="Tasks" value={stat.tasks_worked} />
        <Stat
          label="Blocked"
          value={stat.actions_blocked}
          color={stat.actions_blocked > 0 ? 'text-red-400' : undefined}
        />
        <Stat label="Files touched" value={stat.files_touched} />
        <Stat
          label="In progress"
          value={stat.actions_total - stat.actions_done - stat.actions_blocked}
          color="text-amber-400"
        />
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-xs text-neutral-600">{label}</span>
      <span className={`font-mono text-xs ${color ?? 'text-neutral-300'}`}>
        {value}
      </span>
    </div>
  );
}
