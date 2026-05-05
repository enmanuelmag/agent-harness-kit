import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { api, qk, formatDate } from '@/lib/api';
import { AgentBadge } from '@/components/AgentBadge';
import { PageHeader } from '@/components/PageHeader';
import { RecentTool } from '@/schema/api';

export const Route = createFileRoute('/tools')({
  component: ToolsPage,
});

function ToolsPage() {
  const topTools = useQuery({
    queryKey: qk.topTools,
    queryFn: () => api.topTools(25),
  });
  const recentTools = useQuery({
    queryKey: qk.recentTools,
    queryFn: () => api.recentTools(50),
  });

  const maxUses = topTools.data?.[0]?.uses ?? 1;

  return (
    <div>
      <PageHeader
        title="Tools"
        subtitle="Tool usage across all agent actions"
      />

      <div className="p-6 space-y-8">
        {/* Top tools bar chart */}
        <div>
          <h2 className="font-mono text-xs text-neutral-500 uppercase tracking-wider mb-4">
            Top Tools
          </h2>
          {topTools.isLoading && (
            <p className="font-mono text-xs text-neutral-600">Loading…</p>
          )}
          <div className="space-y-1.5">
            {(topTools.data ?? []).map(({ tool_name, uses }) => (
              <div key={tool_name} className="flex items-center gap-3">
                <div className="w-48 font-mono text-xs text-neutral-400 text-right shrink-0 truncate">
                  {tool_name}
                </div>
                <div className="flex-1 flex items-center gap-2">
                  <div className="flex-1 bg-neutral-900 rounded-sm h-5 overflow-hidden">
                    <div
                      className="bg-violet-900 h-full transition-all flex items-center px-2"
                      style={{ width: `${(uses / maxUses) * 100}%` }}
                    />
                  </div>
                  <span className="font-mono text-xs text-neutral-500 w-8 text-right shrink-0">
                    {uses}
                  </span>
                </div>
              </div>
            ))}
            {!topTools.isLoading && topTools.data?.length === 0 && (
              <p className="font-mono text-xs text-neutral-600">
                No tool calls recorded yet.
              </p>
            )}
          </div>
        </div>

        {/* Recent tool calls */}
        <div>
          <h2 className="font-mono text-xs text-neutral-500 uppercase tracking-wider mb-3">
            Recent Calls
          </h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#1f1f1f]">
                {['Tool', 'Agent', 'Task', 'Args', 'Result', 'Called'].map(
                  (h) => (
                    <th
                      key={h}
                      className="text-left font-mono text-[10px] text-neutral-600 uppercase tracking-wider px-4 py-2"
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {recentTools.isLoading && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-4 text-center font-mono text-xs text-neutral-600"
                  >
                    Loading…
                  </td>
                </tr>
              )}
              {(recentTools.data ?? []).map((t) => (
                <RecentToolRow key={t.id} tool={t} />
              ))}
              {!recentTools.isLoading && recentTools.data?.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-4 text-center font-mono text-xs text-neutral-600"
                  >
                    No recent calls
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function RecentToolRow({ tool }: { tool: RecentTool }) {
  let argsPreview = '—';
  if (tool.args_json) {
    try {
      const parsed = JSON.parse(tool.args_json);
      argsPreview =
        JSON.stringify(parsed).slice(0, 60) +
        (JSON.stringify(parsed).length > 60 ? '…' : '');
    } catch {
      argsPreview = tool.args_json.slice(0, 60);
    }
  }

  return (
    <tr className="border-b border-[#1f1f1f] hover:bg-[#0a0a0a] transition-colors">
      <td className="px-4 py-2 font-mono text-xs text-violet-400">
        {tool.tool_name}
      </td>
      <td className="px-4 py-2">
        <AgentBadge agent={tool.agent} size="xs" />
      </td>
      <td className="px-4 py-2 font-mono text-xs text-neutral-500 max-w-[120px] truncate">
        {tool.task_slug}
      </td>
      <td className="px-4 py-2 font-mono text-xs text-neutral-600 max-w-[180px] truncate">
        {argsPreview}
      </td>
      <td className="px-4 py-2 text-xs text-neutral-500 max-w-[180px] truncate">
        {tool.result_summary ?? '—'}
      </td>
      <td className="px-4 py-2 font-mono text-[10px] text-neutral-700">
        {formatDate(tool.called_at)}
      </td>
    </tr>
  );
}
