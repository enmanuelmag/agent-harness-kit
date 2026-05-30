import { createRootRouteWithContext, Link, Outlet } from '@tanstack/react-router'

import { useTheme } from '../hooks/useTheme'

import type { QueryClient } from '@tanstack/react-query'

function SunIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4"/>
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
    </svg>
  )
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootLayout,
})

const NAV = [
  { to: '/', label: 'Overview', exact: true },
  { to: '/tasks', label: 'Tasks', exact: false },
  { to: '/agents', label: 'Agents', exact: false },
  { to: '/tools', label: 'Tools', exact: false },
  { to: '/files', label: 'Files', exact: false },
] as const

function RootLayout() {
  const { theme, toggle } = useTheme()

  return (
    <div className="flex h-screen bg-[var(--color-bg-base)] text-[var(--color-text-primary)] overflow-hidden">
      {/* Sidebar */}
      <nav className="w-48 border-r border-[var(--color-border)] flex flex-col shrink-0">
        <div className="px-4 py-4 border-b border-[var(--color-border)]">
          <span className="font-mono font-bold text-sm text-[var(--color-accent)]">ahk</span>
          <span className="font-mono text-sm text-[var(--color-text-muted)] ml-1.5">dashboard</span>
        </div>

        <div className="flex-1 py-2 flex flex-col gap-0.5 px-2 overflow-y-auto">
          {NAV.map(({ to, label, exact }) => (
            <Link
              key={to}
              to={to}
              activeOptions={{ exact }}
              className="font-mono text-sm px-3 py-1.5 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-surface)] transition-colors"
              activeProps={{ className: 'font-mono text-sm px-3 py-1.5 rounded text-[var(--color-text-primary)] bg-[var(--color-bg-surface)]' }}
            >
              {label}
            </Link>
          ))}
        </div>

        <div className="px-4 py-3 border-t border-[var(--color-border)]">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] inline-block" />
            <span className="font-mono text-[10px] text-[var(--color-text-muted)]">live</span>
            <button
              onClick={toggle}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              className="ml-auto text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors p-1 rounded hover:bg-[var(--color-bg-elevated)]"
            >
              {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
            </button>
          </div>
        </div>
      </nav>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
