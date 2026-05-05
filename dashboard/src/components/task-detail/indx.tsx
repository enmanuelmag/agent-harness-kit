import { formatDate, formatDuration } from '@/lib/api';
import { ActionDetail, ActionSection } from '@/schema/api';
import { useState } from 'react';
import { AgentBadge } from '../shared/agent-badge';
import { StatusBadge } from '../shared/status-badge';

export function ActionCard({ action }: { action: ActionDetail }) {
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

export function SectionBlock({ section }: { section: ActionSection }) {
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

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-mono text-xs text-neutral-500 uppercase tracking-wider">
      {children}
    </h2>
  );
}

export function TimestampItem({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div>
      <div className="text-neutral-600 text-[10px]">{label}</div>
      <div className="text-neutral-300">{value}</div>
    </div>
  );
}
