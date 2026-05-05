// ─── Response types ───────────────────────────────────────────────────────────

import type { AgentStat, RecentFile, RecentTool, StatsOverview, TaskDetail, TaskSummary, TimelineEntry, TopFile, TopTool } from "@/schema/api"



// ─── Fetch helpers ────────────────────────────────────────────────────────────

const BASE = '/api'

async function get<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = params ? `${BASE}${path}?${new URLSearchParams(params)}` : `${BASE}${path}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`API ${path} → ${res.status}`)
  return res.json() as Promise<T>
}

export const api = {
  stats: () => get<StatsOverview>('/stats'),
  tasks: () => get<TaskSummary[]>('/tasks'),
  task: (id: number) => get<TaskDetail>(`/tasks/${id}`),
  topTools: (limit = 20) => get<TopTool[]>('/tools/top', { limit: String(limit) }),
  recentTools: (limit = 50) => get<RecentTool[]>('/tools/recent', { limit: String(limit) }),
  topFiles: (limit = 20) => get<TopFile[]>('/files/top', { limit: String(limit) }),
  recentFiles: (limit = 50) => get<RecentFile[]>('/files/recent', { limit: String(limit) }),
  agentStats: () => get<AgentStat[]>('/agents/stats'),
  timeline: (limit = 50) => get<TimelineEntry[]>('/timeline', { limit: String(limit) }),
}

// ─── Query keys ───────────────────────────────────────────────────────────────

export const qk = {
  stats: ['stats'] as const,
  tasks: ['tasks'] as const,
  task: (id: number) => ['tasks', id] as const,
  topTools: ['tools', 'top'] as const,
  recentTools: ['tools', 'recent'] as const,
  topFiles: ['files', 'top'] as const,
  recentFiles: ['files', 'recent'] as const,
  agentStats: ['agents', 'stats'] as const,
  timeline: ['timeline'] as const,
}

// ─── Format helpers ───────────────────────────────────────────────────────────

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export function formatDuration(start: string, end: string | null): string {
  if (!end) return '—'
  const ms = new Date(end).getTime() - new Date(start).getTime()
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}
