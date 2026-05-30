import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';

import { AgentBadge } from '@/components/shared/agent-badge';
import { EmptyTableRow } from '@/components/shared/empty-table-row';
import { LoadingTableRow } from '@/components/shared/loading-state';
import { PageHeader } from '@/components/shared/page-header';
import { api, formatDate,qk } from '@/lib/api';

import type { RecentTool } from '@/schema/api';

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
          <h2 className="font-mono text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-4">
            Top Tools
          </h2>
          {topTools.isLoading && (
            <p className="font-mono text-xs text-[var(--color-text-faint)]">Loading…</p>
          )}

          <div className="space-y-1.5">
            {(topTools.data ?? []).map(({ tool_name, uses }) => (
              <div key={tool_name} className="flex items-center gap-3">
                <div className="w-48 font-mono text-xs text-[var(--color-text-secondary)] text-right shrink-0 truncate">
                  {tool_name}
                </div>
                <div className="flex-1 flex items-center gap-2">
                  <div className="flex-1 bg-[var(--color-bg-elevated)] rounded-sm h-5 overflow-hidden">
                    <div
                      className="bg-violet-900 h-full transition-all flex items-center px-2"
                      style={{ width: `${(uses / maxUses) * 100}%` }}
                    />
                  </div>
                  <span className="font-mono text-xs text-[var(--color-text-muted)] w-8 text-right shrink-0">
                    {uses}
                  </span>
                </div>
              </div>
            ))}
            {!topTools.isLoading && topTools.data?.length === 0 && (
              <p className="font-mono text-xs text-[var(--color-text-faint)]">
                No tool calls recorded yet.
              </p>
            )}
          </div>
        </div>

        {/* Recent tool calls */}
        <div>
          <h2 className="font-mono text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-3">
            Recent Calls
          </h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                {['Tool', 'Agent', 'Task', 'Args', 'Result', 'Called'].map(
                  (h) => (
                    <th
                      key={h}
                      className="text-left font-mono text-[10px] text-[var(--color-text-faint)] uppercase tracking-wider px-4 py-2"
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {recentTools.isLoading && <LoadingTableRow cols={6} />}
              {(recentTools.data ?? []).map((t) => (
                <RecentToolRow key={t.id} tool={t} />
              ))}
              {!recentTools.isLoading && recentTools.data?.length === 0 && (
                <EmptyTableRow cols={6} message="No recent calls" />
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
    <tr className="border-b border-[var(--color-border)] hover:bg-[var(--color-bg-surface)] transition-colors">
      <td className="px-4 py-2 font-mono text-xs text-violet-400">
        {tool.tool_name}
      </td>
      <td className="px-4 py-2">
        <AgentBadge agent={tool.agent} size="xs" />
      </td>
      <td className="px-4 py-2 font-mono text-xs text-[var(--color-text-muted)] max-w-[120px] truncate">
        {tool.task_slug}
      </td>
      <td className="px-4 py-2 font-mono text-xs text-[var(--color-text-faint)] max-w-[180px] truncate">
        {argsPreview}
      </td>
      <td className="px-4 py-2 text-xs text-[var(--color-text-muted)] max-w-[180px] truncate">
        {tool.result_summary ?? '—'}
      </td>
      <td className="px-4 py-2 font-mono text-[10px] text-[var(--color-text-faint)]">
        {formatDate(tool.called_at)}
      </td>
    </tr>
  );
}
