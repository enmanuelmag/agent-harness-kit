import { useState } from 'react';

import { AgentBadge } from '@/components/shared/agent-badge';
import { StatusBadge } from '@/components/shared/status-badge';
import { formatDate, formatDuration } from '@/lib/api';

import type { ActionDetail, ActionSection } from '@/schema/api';

export function ActionCard({ action }: { action: ActionDetail }) {
  const [expanded, setExpanded] = useState(false);
  const hasSections = action.sections.length > 0;
  const duration = formatDuration(action.created_at, action.completed_at);

  return (
    <div className="bg-[var(--color-bg-surface)] border border-[var(--color-border)] rounded-md">
      <button
        className="w-full flex items-start gap-3 p-3 text-left hover:bg-[var(--color-bg-elevated)] transition-colors rounded-md"
        onClick={() => hasSections && setExpanded(!expanded)}
      >
        <AgentBadge agent={action.agent} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <StatusBadge status={action.status} size="xs" />
            <span className="font-mono text-xs text-[var(--color-text-faint)]">
              {duration}
            </span>
            {action.tools.length > 0 && (
              <span className="font-mono text-[10px] text-[var(--color-text-faint)]">
                {action.tools.length} tool{action.tools.length !== 1 ? 's' : ''}
              </span>
            )}
            {action.files.length > 0 && (
              <span className="font-mono text-[10px] text-[var(--color-text-faint)]">
                {action.files.length} file{action.files.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          {action.summary && (
            <div className="text-xs text-[var(--color-text-secondary)] mt-1">
              {action.summary}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="font-mono text-[10px] text-[var(--color-text-faint)]">
            {formatDate(action.created_at)}
          </span>
          {hasSections && (
            <span className="text-[var(--color-text-faint)] text-xs">
              {expanded ? '▲' : '▼'}
            </span>
          )}
        </div>
      </button>

      {expanded && hasSections && (
        <div className="border-t border-[var(--color-border)] divide-y divide-[var(--color-border)]">
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
      <div className="font-mono text-[10px] text-[var(--color-text-faint)] uppercase tracking-wider mb-1">
        {section.section_type.replace(/_/g, ' ')}
      </div>
      <pre className="text-xs text-[var(--color-text-secondary)] whitespace-pre-wrap font-mono leading-relaxed">
        {section.content}
      </pre>
    </div>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-mono text-xs text-[var(--color-text-muted)] uppercase tracking-wider">
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
      <div className="text-[var(--color-text-faint)] text-[10px]">{label}</div>
      <div className="text-[var(--color-text-secondary)]">{value}</div>
    </div>
  );
}
