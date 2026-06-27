import { useQuery } from '@tanstack/react-query'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'
import type { EmployeeProfile } from '../../types'

interface EmployeeLayoutProps {
  employeeProfile: EmployeeProfile | null
  onSignOut: () => Promise<void>
}

function EmployeeLayout({ employeeProfile, onSignOut }: EmployeeLayoutProps) {
  const navigate = useNavigate()
  const empId = employeeProfile?.id ?? null

  const { data: incomingTradeCount = 0 } = useQuery<number>({
    queryKey: ['employee-layout-incoming-trades', empId],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('shift_trade_requests')
        .select('*', { count: 'exact', head: true })
        .eq('target_employee_id', empId!)
        .eq('status', 'pending')
      if (error) return 0
      return count ?? 0
    },
    enabled: Boolean(empId),
    refetchInterval: 60_000,
  })

  const navItems = [
    {
      label: 'Dashboard',
      to: '/employee/dashboard',
      badge: 0,
      icon: (
        <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5">
          <path d="M4 4h7v7H4zM13 4h7v4.5h-7zM13 11.5h7V20h-7zM4 13h7v7H4z" fill="currentColor" />
        </svg>
      ),
    },
    {
      label: 'My Schedule',
      to: '/employee/schedule',
      badge: 0,
      icon: (
        <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5">
          <path
            d="M7 4v2m10-2v2m-12 4h14m-13 4h5m-5 3h3M5 6.5A2.5 2.5 0 0 1 7.5 4H9h6h1.5A2.5 2.5 0 0 1 19 6.5V18a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ),
    },
    {
      label: 'Time Off',
      to: '/employee/time-off',
      badge: 0,
      icon: (
        <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5">
          <path
            d="M12 8v4l3 3m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ),
    },
    {
      label: 'Shift Trades',
      to: '/employee/trades',
      badge: incomingTradeCount as number,
      icon: (
        <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5">
          <path
            d="M7 16V4m0 0L4 7m3-3 3 3m7 0v12m0 0 3-3m-3 3-3-3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ),
    },
  ]

  const handleSignOut = async () => {
    await onSignOut()
    navigate('/login', { replace: true })
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="sticky top-0 z-30 border-b border-slate-800 bg-slate-900/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <NavLink to="/employee/dashboard" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 font-semibold text-white text-sm">
              S+
            </span>
            <span className="hidden sm:block text-sm font-semibold text-white">Schedule+</span>
          </NavLink>

          <nav className="flex items-center gap-1">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `relative flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition ${
                    isActive ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                  }`
                }
              >
                <span className="hidden sm:block">{item.icon}</span>
                <span>{item.label}</span>
                {item.badge > 0 && (
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-[10px] font-bold text-white">
                    {item.badge > 9 ? '9+' : item.badge}
                  </span>
                )}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <span className="hidden md:block text-sm text-slate-400 truncate max-w-[180px]">
              {employeeProfile?.name ?? ''}
            </span>
            <button
              type="button"
              onClick={handleSignOut}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-red-400 hover:text-red-200"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}

export default EmployeeLayout
