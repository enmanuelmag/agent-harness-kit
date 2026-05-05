import { createRootRouteWithContext, Link, Outlet } from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'

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
  return (
    <div className="flex h-screen bg-black text-[#fafafa] overflow-hidden">
      {/* Sidebar */}
      <nav className="w-48 border-r border-[#1f1f1f] flex flex-col shrink-0">
        <div className="px-4 py-4 border-b border-[#1f1f1f]">
          <span className="font-mono font-bold text-sm text-green-400">ahk</span>
          <span className="font-mono text-sm text-neutral-600 ml-1.5">dashboard</span>
        </div>

        <div className="flex-1 py-2 flex flex-col gap-0.5 px-2 overflow-y-auto">
          {NAV.map(({ to, label, exact }) => (
            <Link
              key={to}
              to={to}
              activeOptions={{ exact }}
              className="font-mono text-sm px-3 py-1.5 rounded text-neutral-500 hover:text-[#fafafa] hover:bg-[#0a0a0a] transition-colors"
              activeProps={{ className: 'font-mono text-sm px-3 py-1.5 rounded text-[#fafafa] bg-[#0a0a0a]' }}
            >
              {label}
            </Link>
          ))}
        </div>

        <div className="px-4 py-3 border-t border-[#1f1f1f]">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />
            <span className="font-mono text-[10px] text-neutral-600">live</span>
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
