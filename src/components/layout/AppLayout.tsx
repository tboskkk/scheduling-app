import { useEffect, useMemo, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabaseClient'
import type { ManagerProfile } from '../../types'
import type { LocationRecord } from '../LocationsManager'
import { formatWeekRange, useScheduleStore } from '../schedule/useScheduleStore'
import { useOrganizationStore } from '../../lib/useOrganizationStore'
import { OfflineIndicator } from '../OfflineIndicator'

interface AppLayoutProps {
  session: Session
  managerProfile: ManagerProfile | null
  onSignOut: () => Promise<void>
  isManagerLoading: boolean
}

function AppLayout({ session, managerProfile, onSignOut, isManagerLoading }: AppLayoutProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false)
  const [selectedLocationId, setSelectedLocationId] = useState('')
  const { weekStartIso, shiftWeek, goToToday, setTimezone, setOrganizationSettings } = useScheduleStore()
  const { organization, fetchOrganization } = useOrganizationStore()

  useEffect(() => {
    fetchOrganization()
  }, [fetchOrganization])

  useEffect(() => {
    if (organization) {
      setOrganizationSettings(organization.settings)
    }
  }, [organization, setOrganizationSettings])

  const { data: locations, isLoading: areLocationsLoading } = useQuery<LocationRecord[]>({
    queryKey: ['layout-locations', managerProfile?.organization_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('locations')
        .select('id, name, address, timezone, created_at')
        .order('created_at', { ascending: false })
      if (error) throw new Error(error.message)
      return (data ?? []) as LocationRecord[]
    },
    enabled: Boolean(managerProfile?.organization_id),
  })

  useEffect(() => {
    const scheduleMatch = location.pathname.match(/\/schedule\/([^/]+)/)
    if (scheduleMatch?.[1]) {
      setSelectedLocationId(decodeURIComponent(scheduleMatch[1]))
      return
    }

    if (!selectedLocationId && locations?.length) {
      setSelectedLocationId(locations[0].id)
    }
  }, [location.pathname, locations, selectedLocationId])

  useEffect(() => {
    if (!isManagerLoading && !managerProfile && location.pathname !== '/dashboard') {
      navigate('/dashboard', { replace: true })
    }
  }, [isManagerLoading, managerProfile, location.pathname, navigate])

  const navItems = useMemo(() => {
    const icons = {
      dashboard: (
        <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5">
          <path d="M4 4h7v7H4zM13 4h7v4.5h-7zM13 11.5h7V20h-7zM4 13h7v7H4z" fill="currentColor" />
        </svg>
      ),
      schedule: (
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
      employees: (
        <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5">
          <path
            d="M8 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8.5-1.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM4 18.5c0-2 2.5-3.5 4-3.5s4 1.5 4 3.5V20H4Zm11.5-3c1.2 0 2.5.6 3.2 1.6.2.3.3.6.3.9V20h-5v-1.3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ),
      locations: (
        <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5">
          <path
            d="M12 21s6-5.1 6-10.2A6 6 0 0 0 6 10.8C6 15.9 12 21 12 21Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="12" cy="10" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      ),
      settings: (
        <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5">
          <path
            d="M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Zm6.5 2.5c0-.4-.1-.7-.1-1l2-1.5-2-3.5-2.3.8c-.5-.4-1-.7-1.6-.9L14 3h-4l-.5 3.4c-.6.2-1.1.5-1.6.9l-2.3-.8-2 3.5 2 1.5c0 .3-.1.7-.1 1s.1.7.1 1l-2 1.5 2 3.5 2.3-.8c.5.4 1 .7 1.6.9L10 21h4l.5-3.4c.6-.2 1.1-.5 1.6-.9l2.3.8 2-3.5-2-1.5c0-.3.1-.6.1-1Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ),
    }

    if (!managerProfile) {
      return [{ label: 'Dashboard', to: '/dashboard', icon: icons.dashboard }]
    }

    const schedulePath = selectedLocationId ? `/schedule/${selectedLocationId}` : '/schedule'

    return [
      { label: 'Dashboard', to: '/dashboard', icon: icons.dashboard },
      { label: 'Schedule', to: schedulePath, icon: icons.schedule },
      { label: 'Employees', to: '/employees', icon: icons.employees },
      { label: 'Locations', to: '/locations', icon: icons.locations },
      { label: 'Settings', to: '/settings', icon: icons.settings },
    ]
  }, [selectedLocationId, managerProfile])

  const activeTimezone = useMemo(() => {
    const match = locations?.find((loc) => loc.id === selectedLocationId)
    return match?.timezone ?? null
  }, [locations, selectedLocationId])

  useEffect(() => {
    setTimezone(activeTimezone ?? null)
  }, [activeTimezone, setTimezone])

  const weekRangeLabel = useMemo(() => formatWeekRange(weekStartIso, activeTimezone), [weekStartIso, activeTimezone])

  const warningCount = 0
  const hardBlockCount = 0

  const handleWeekChange = (delta: number) => shiftWeek(delta)

  const handleSelectToday = () => goToToday()

  const handleLocationChange = (value: string) => {
    if (!value) return
    setSelectedLocationId(value)
    navigate(`/schedule/${value}`)
    setIsMobileNavOpen(false)
  }

  const toggleSidebar = () => setIsSidebarCollapsed((prev) => !prev)

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <OfflineIndicator />
      <div className="flex min-h-screen flex-col md:flex-row">
        <aside
          className={`fixed inset-y-0 left-0 z-40 flex flex-col border-r border-slate-800/80 bg-slate-900/90 p-4 shadow-2xl transition-transform duration-200 md:relative md:z-auto md:bg-slate-900/70 md:shadow-none ${isMobileNavOpen ? 'translate-x-0 w-72' : '-translate-x-full w-72 md:translate-x-0'} ${isSidebarCollapsed ? 'md:w-16 md:items-center md:px-3' : 'md:w-64 md:px-4 md:pr-6'}`}
          style={{ minWidth: isSidebarCollapsed ? '4rem' : undefined }}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 font-semibold text-white">
                S+
              </span>
              {!isSidebarCollapsed && (
                <div className="leading-tight">
                  <p className="text-sm font-semibold text-white">Schedule+</p>
                  <p className="text-xs text-slate-400">Manager</p>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsMobileNavOpen(false)}
                className="rounded-lg border border-slate-700 px-2 py-1 text-xs font-semibold text-slate-200 hover:border-slate-500 md:hidden"
              >
                Close
              </button>
            </div>
          </div>

          <div className="mt-6 space-y-1">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() => setIsMobileNavOpen(false)}
                title={item.label}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold transition ${isActive ? 'bg-blue-600 text-white' : 'text-slate-200 hover:bg-slate-800/80'}`
                }
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-md bg-slate-800 text-slate-200">
                  {item.icon}
                </span>
                {!isSidebarCollapsed && <span>{item.label}</span>}
              </NavLink>
            ))}
          </div>

          {!isSidebarCollapsed && (
            <div className="mt-8 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Location</p>
              <div className="rounded-lg border border-slate-700 bg-slate-900/80 p-3 text-xs text-slate-200">
                {isManagerLoading && <p>Loading manager…</p>}
                {!isManagerLoading && !managerProfile && <p>Add an organization to pick a location.</p>}
                {managerProfile && (
                  <select
                    value={selectedLocationId}
                    onChange={(e) => handleLocationChange(e.target.value)}
                    disabled={areLocationsLoading || !locations?.length}
                    className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-2 text-sm text-white outline-none ring-2 ring-transparent transition focus:border-blue-500 focus:ring-blue-500 disabled:opacity-60"
                  >
                    {!selectedLocationId && <option value="">Select a location</option>}
                    {(locations ?? []).map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          )}

          {!isSidebarCollapsed && (
            <div className="mt-auto pt-6">
              <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-3 text-xs text-slate-200">
                <p className="font-semibold text-white">{session.user.email}</p>
                <p className="text-slate-400">Signed in</p>
                <button
                  type="button"
                  onClick={onSignOut}
                  className="mt-3 w-full rounded-md border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-red-400 hover:text-red-200"
                >
                  Sign out
                </button>
              </div>
            </div>
          )}

          <button
            type="button"
            aria-label={isSidebarCollapsed ? 'Expand navigation' : 'Collapse navigation'}
            aria-pressed={!isSidebarCollapsed}
            onClick={toggleSidebar}
            className="group absolute right-[-18px] top-1/2 hidden -translate-y-1/2 items-center gap-2 rounded-full border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-bold text-slate-100 shadow-2xl ring-1 ring-black/30 transition hover:-translate-x-0.5 hover:border-slate-500 hover:bg-slate-700 md:flex"
          >
            <span className="text-sm">{isSidebarCollapsed ? '⟩' : '⟨'}</span>
            <span className="max-w-0 overflow-hidden whitespace-nowrap text-[11px] font-semibold opacity-0 transition-all duration-150 ease-out group-hover:max-w-[80px] group-hover:opacity-100">
              {isSidebarCollapsed ? 'Expand' : 'Collapse'}
            </span>
          </button>
        </aside>

        {isMobileNavOpen && (
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setIsMobileNavOpen(false)}
            className="fixed inset-0 z-30 bg-black/50 md:hidden"
          />
        )}

        <main className="flex-1 bg-slate-950/60 md:ml-0">
          <header className="sticky top-0 z-20 border-b border-slate-800 bg-slate-900/80 backdrop-blur">
            <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 md:px-6">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
                <button
                  type="button"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-700 text-base md:hidden"
                  onClick={() => setIsMobileNavOpen(true)}
                  aria-label="Open navigation"
                >
                  ☰
                </button>

                <button
                  type="button"
                  onClick={() => handleWeekChange(-1)}
                  className="rounded-md border border-slate-700 px-2 py-2 text-xs transition hover:border-slate-500"
                  aria-label="Previous week"
                >
                  ◀
                </button>
                <div className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-left">
                  <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Week</p>
                  <p className="text-sm font-semibold text-white">{weekRangeLabel}</p>
                </div>
                <button
                  type="button"
                  onClick={() => handleWeekChange(1)}
                  className="rounded-md border border-slate-700 px-2 py-2 text-xs transition hover:border-slate-500"
                  aria-label="Next week"
                >
                  ▶
                </button>
                <button
                  type="button"
                  onClick={handleSelectToday}
                  className="rounded-md border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-100 transition hover:border-blue-400 hover:text-white"
                >
                  Today
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-200">
                  ⚠️ <span>{warningCount}</span>
                </div>
                <div className="inline-flex items-center gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-200">
                  🔴 <span>{hardBlockCount}</span>
                </div>
              </div>
            </div>
          </header>

          <div className="mx-auto max-w-6xl px-4 py-6 md:px-6">
            <div className="mb-4 block rounded-lg border border-blue-500/30 bg-blue-500/10 p-3 text-xs text-blue-100 md:hidden">
              Best experienced on desktop. Mobile is viewable, but full Smart Grid editing is desktop-first.
            </div>
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}

export default AppLayout
