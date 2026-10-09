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
import DemoBanner from '../DemoBanner'
import { ErrorDetailsModal } from '../schedule/ErrorDetailsModal'
import { ConflictSeverity } from '../../lib/rules-engine'
import { computeFixSuggestions } from '../../lib/fix-suggestions'
import type { AddShiftParams } from '../../lib/fix-suggestions'

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
  const [showErrorDetails, setShowErrorDetails] = useState(false)
  const { weekStartIso, shiftWeek, goToToday, setTimezone, setOrganizationSettings, validationErrors, employees, shifts, availability } = useScheduleStore()
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

  const { data: pendingRequestsCount = 0 } = useQuery<number>({
    queryKey: ['manager-pending-counts', managerProfile?.organization_id],
    queryFn: async () => {
      const [torRes, strRes] = await Promise.all([
        supabase
          .from('time_off_requests')
          .select('*', { count: 'exact', head: true })
          .eq('organization_id', managerProfile!.organization_id)
          .eq('status', 'pending'),
        supabase
          .from('shift_trade_requests')
          .select('*', { count: 'exact', head: true })
          .eq('organization_id', managerProfile!.organization_id)
          .eq('status', 'accepted'),
      ])
      return (torRes.count ?? 0) + (strRes.count ?? 0)
    },
    enabled: Boolean(managerProfile?.organization_id),
    refetchInterval: 60_000,
  })

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
      requests: (
        <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5">
          <path
            d="M4 4h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H8l-4 4V5a1 1 0 0 1 1-1Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="M8 9h8M8 12h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      ),
    }

    if (!managerProfile) {
      return [{ label: 'Dashboard', to: '/dashboard', icon: icons.dashboard, badge: 0 }]
    }

    const schedulePath = selectedLocationId ? `/schedule/${selectedLocationId}` : '/schedule'

    return [
      { label: 'Dashboard', to: '/dashboard', icon: icons.dashboard, badge: 0 },
      { label: 'Schedule', to: schedulePath, icon: icons.schedule, badge: 0 },
      { label: 'Employees', to: '/employees', icon: icons.employees, badge: 0 },
      { label: 'Locations', to: '/locations', icon: icons.locations, badge: 0 },
      { label: 'Requests', to: '/requests', icon: icons.requests, badge: pendingRequestsCount },
      { label: 'Settings', to: '/settings', icon: icons.settings, badge: 0 },
    ]
  }, [selectedLocationId, managerProfile, pendingRequestsCount])

  const activeTimezone = useMemo(() => {
    const match = locations?.find((loc) => loc.id === selectedLocationId)
    return match?.timezone ?? null
  }, [locations, selectedLocationId])

  useEffect(() => {
    setTimezone(activeTimezone ?? null)
  }, [activeTimezone, setTimezone])

  const weekRangeLabel = useMemo(() => formatWeekRange(weekStartIso, activeTimezone), [weekStartIso, activeTimezone])

  // Compute error counts from validation errors
  const warningCount = useMemo(() => 
    validationErrors.filter(error => error.severity === ConflictSeverity.SOFT_WARNING).length, 
    [validationErrors]
  )
  const hardBlockCount = useMemo(() =>
    validationErrors.filter(error => error.severity === ConflictSeverity.HARD_BLOCK).length,
    [validationErrors]
  )

  const fixSuggestions = useMemo(
    () => computeFixSuggestions(validationErrors, employees, shifts, availability),
    [validationErrors, employees, shifts, availability]
  )

  const isOnSchedule = location.pathname.startsWith('/schedule')
  const pageTitle = location.pathname.startsWith('/employees') ? 'Employees'
    : location.pathname.startsWith('/locations') ? 'Locations'
    : location.pathname.startsWith('/requests') ? 'Requests'
    : location.pathname.startsWith('/settings') ? 'Settings'
    : 'Dashboard'

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
      <DemoBanner email={session.user.email ?? null} role="manager" />
      <div className="flex min-h-screen flex-col md:flex-row">
        <aside
          className={`fixed top-0 left-0 h-screen z-40 flex flex-col border-r border-slate-800/80 bg-slate-900/90 p-4 shadow-2xl transition-transform duration-200 md:z-auto md:bg-slate-900/70 md:shadow-none ${isMobileNavOpen ? 'translate-x-0 w-72' : '-translate-x-full w-72 md:translate-x-0'} ${isSidebarCollapsed ? 'md:w-16 md:items-center md:px-3' : 'md:w-64 md:px-4 md:pr-6'}`}
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
                className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-slate-500 md:hidden"
              >
                Close
              </button>
            </div>
          </div>

          <div className="mt-6 flex-1 overflow-y-auto space-y-1">
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
                <span className="relative flex h-8 w-8 items-center justify-center rounded-md bg-slate-800 text-slate-200">
                  {item.icon}
                  {item.badge > 0 && (
                    <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-[10px] font-bold text-white">
                      {item.badge > 99 ? '99+' : item.badge}
                    </span>
                  )}
                </span>
                {!isSidebarCollapsed && <span>{item.label}</span>}
              </NavLink>
            ))}

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
          </div>

          {!isSidebarCollapsed && (
            <div className="flex-shrink-0 pt-6">
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

        <main className={`flex-1 bg-slate-950/60 transition-all duration-200 ${isSidebarCollapsed ? 'md:ml-16' : 'md:ml-64'}`}>
          <header className="sticky top-0 z-30 border-b border-slate-800 bg-slate-900/80 backdrop-blur">
            <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 md:px-6">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
                <button
                  type="button"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-slate-700 text-base md:hidden"
                  onClick={() => setIsMobileNavOpen(true)}
                  aria-label="Open navigation"
                >
                  ☰
                </button>

                {isOnSchedule ? (
                  <>
                    <button
                      type="button"
                      onClick={() => handleWeekChange(-1)}
                      className="rounded-md border border-slate-700 px-2.5 py-2.5 text-xs transition hover:border-slate-500"
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
                      className="rounded-md border border-slate-700 px-2.5 py-2.5 text-xs transition hover:border-slate-500"
                      aria-label="Next week"
                    >
                      ▶
                    </button>
                    <button
                      type="button"
                      onClick={handleSelectToday}
                      className="rounded-md border border-slate-700 px-3 py-2.5 text-xs font-semibold text-slate-100 transition hover:border-blue-400 hover:text-white"
                    >
                      Today
                    </button>
                  </>
                ) : (
                  <span className="text-sm font-semibold text-white">{pageTitle}</span>
                )}
              </div>

              {isOnSchedule && (
                <div className="flex items-center gap-2">
                  <select
                    value={selectedLocationId}
                    onChange={(e) => handleLocationChange(e.target.value)}
                    disabled={areLocationsLoading || !locations?.length}
                    className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-semibold text-white outline-none transition focus:border-blue-500 disabled:opacity-60"
                  >
                    {!selectedLocationId && <option value="">Select location</option>}
                    {(locations ?? []).map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.name}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => setShowErrorDetails(true)}
                    className="inline-flex items-center gap-2.5 rounded-md border border-slate-700 bg-slate-950/40 px-3 py-2.5 text-xs font-semibold transition hover:border-slate-500"
                  >
                    <span className="text-red-300">🔴 {hardBlockCount}</span>
                    <span className="text-slate-600">·</span>
                    <span className="text-amber-300">⚠️ {warningCount}</span>
                  </button>
                </div>
              )}
            </div>
          </header>

          <div className="mx-auto max-w-7xl px-4 py-6 md:px-6 xl:max-w-none xl:px-8">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Error Details Modal */}
      <ErrorDetailsModal
        isOpen={showErrorDetails}
        onClose={() => setShowErrorDetails(false)}
        errors={validationErrors}
        title="All Schedule Issues"
        onShiftClick={(shiftId) => {
          setShowErrorDetails(false)
          const target = `/schedule/${selectedLocationId}`
          if (!location.pathname.startsWith('/schedule')) {
            navigate(`${target}?highlight=${shiftId}`)
          } else {
            navigate(`${location.pathname}?highlight=${shiftId}`, { replace: true })
          }
        }}
        suggestions={fixSuggestions}
        onAddShift={(params: AddShiftParams) => {
          setShowErrorDetails(false)
          const target = `/schedule/${selectedLocationId}`
          const qs = `?fixDate=${encodeURIComponent(params.startTime)}&fixEmployee=${encodeURIComponent(params.employeeId)}`
          if (!location.pathname.startsWith('/schedule')) {
            navigate(`${target}${qs}`)
          } else {
            navigate(`${location.pathname}${qs}`, { replace: true })
          }
        }}
      />
    </div>
  )
}

export default AppLayout
