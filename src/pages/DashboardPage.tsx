import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import type { ManagerProfile } from '../types'
import { DEFAULT_ORGANIZATION_SETTINGS } from '../types'
import { computeDashboardSummary } from '../lib/dashboard-summary'
import { startOfWeekWithOffset } from '../lib/schedule-utils'
import { useOrganizationStore } from '../lib/useOrganizationStore'
import { formatWeekRange } from '../components/schedule/useScheduleStore'
import OnboardingWizard from '../components/OnboardingWizard'
import { ErrorDetailsModal } from '../components/schedule/ErrorDetailsModal'
import { validateSchedule } from '../lib/rules-engine'
import { useGlobalValidation } from '../hooks/useGlobalValidation'
import { supabase } from '../lib/supabaseClient'

interface DashboardPageProps {
  managerProfile: ManagerProfile | null
  isFetchingManager: boolean
  onOrganizationCreated: (orgId: string) => void
}

function DashboardPage({
  managerProfile,
  isFetchingManager,
  onOrganizationCreated,
}: DashboardPageProps) {
  const { organization, fetchOrganization } = useOrganizationStore()
  const orgId = managerProfile?.organization_id ?? null
  const isManagerMissing = !managerProfile

  // Modal state for error details
  const [showGlobalErrors, setShowGlobalErrors] = useState(false)
  const [selectedLocationErrors, setSelectedLocationErrors] = useState<{ locationId: string; locationName: string } | null>(null)

  // Use global validation hook
  const { 
    validationErrors: globalErrors, 
    locations, 
    employees, 
    shifts, 
    availability, 
    unavailability, 
    coverage,
    isLoading 
  } = useGlobalValidation({
    organizationId: orgId,
    enabled: Boolean(orgId)
  })

  const { data: pendingRequestsCount = 0 } = useQuery<number>({
    queryKey: ['manager-pending-counts', orgId],
    queryFn: async () => {
      const [torRes, strRes] = await Promise.all([
        supabase
          .from('time_off_requests')
          .select('*', { count: 'exact', head: true })
          .eq('organization_id', orgId!)
          .eq('status', 'pending'),
        supabase
          .from('shift_trade_requests')
          .select('*', { count: 'exact', head: true })
          .eq('organization_id', orgId!)
          .eq('status', 'accepted'),
      ])
      return (torRes.count ?? 0) + (strRes.count ?? 0)
    },
    enabled: Boolean(orgId),
    refetchInterval: 60_000,
  })

  useEffect(() => {
    if (!organization) {
      fetchOrganization().catch(() => {
        // errors are stored in the organization store
      })
    }
  }, [organization, fetchOrganization])

  const settings = organization?.settings ?? DEFAULT_ORGANIZATION_SETTINGS
  const weekStartDate = useMemo(() => startOfWeekWithOffset(new Date(), settings.week_start_day), [settings.week_start_day])
  const weekStartIso = useMemo(() => weekStartDate.toISOString(), [weekStartDate])
  const weekLabel = useMemo(() => formatWeekRange(weekStartIso, null), [weekStartIso])

  const summary = useMemo(() => {
    if (!locations || !employees || !shifts) return null
    return computeDashboardSummary({
      locations: locations,
      shifts: shifts,
      employees: employees,
      availability: availability,
      unavailability: unavailability,
      coverageRequirements: coverage,
      settings,
      now: new Date(),
    })
  }, [locations, employees, shifts, availability, unavailability, coverage, settings])

  // Compute location-specific errors
  const locationErrors = useMemo(() => {
    if (!selectedLocationErrors || !locations || !employees || !shifts) return []
    
    const locationShifts = shifts.filter(shift => shift.location_id === selectedLocationErrors.locationId)
    const locationCoverage = coverage.filter(c => c.location_id === selectedLocationErrors.locationId)
    const location = locations.find(loc => loc.id === selectedLocationErrors.locationId)
    
    return validateSchedule(
      locationShifts,
      employees,
      availability,
      unavailability,
      locationCoverage,
      {
        weekStart: weekStartDate,
        weekStartDay: settings.week_start_day,
        maxWeeklyHours: settings.weekly_overtime_threshold,
        maxDailyHours: settings.daily_overtime_threshold,
        minRestPeriodHours: settings.min_rest_period_hours,
        enableCaliforniaRules: settings.enable_california_rules,
        timezone: location?.timezone || undefined,
      }
    )
  }, [selectedLocationErrors, locations, employees, shifts, availability, unavailability, coverage, settings, weekStartDate])

  const hasData = Boolean(summary && locations?.length)

  if (isFetchingManager) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-6 text-sm text-slate-200">
        Loading manager profile…
      </div>
    )
  }

  if (isManagerMissing) {
    return (
      <OnboardingWizard 
        onComplete={onOrganizationCreated} 
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
        <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Dashboard</p>
        <h2 className="text-2xl font-semibold text-white">Week overview</h2>
        <p className="text-sm text-slate-300">Live summary for the current week: conflicts, coverage, and quick links.</p>
      </div>

      {isLoading && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-5 text-sm text-slate-300">Loading dashboard data…</div>
      )}

      {!isLoading && !hasData && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-5 text-sm text-slate-300">
          Add at least one location to view the schedule dashboard.
        </div>
      )}

      {summary && hasData && (
        <>
          {pendingRequestsCount > 0 && (
            <Link
              to="/requests"
              className="flex items-center justify-between rounded-xl border border-amber-500/30 bg-amber-500/10 px-5 py-4 transition hover:border-amber-500/60 hover:bg-amber-500/20"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/20 text-amber-300">
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 4h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H8l-4 4V5a1 1 0 0 1 1-1Z" />
                  </svg>
                </span>
                <div>
                  <p className="text-sm font-semibold text-amber-200">
                    {pendingRequestsCount} request{pendingRequestsCount !== 1 ? 's' : ''} awaiting your action
                  </p>
                  <p className="text-xs text-amber-300/70">Review time off and shift trade requests</p>
                </div>
              </div>
              <span className="text-xs font-semibold text-amber-300">Review →</span>
            </Link>
          )}
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-5">
              <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Current week</p>
              <h3 className="text-xl font-semibold text-white">{weekLabel}</h3>
              <div className="mt-3 grid grid-cols-2 gap-3 text-sm text-slate-200">
                <div>
                  <p className="text-xs uppercase tracking-[0.12em] text-slate-500">Shifts</p>
                  <p className="text-lg font-semibold text-white">{summary.totalShifts}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.12em] text-slate-500">Locations</p>
                  <p className="text-lg font-semibold text-white">{locations?.length ?? 0}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.12em] text-slate-500">Active employees</p>
                  <p className="text-lg font-semibold text-white">{employees?.length ?? 0}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.12em] text-slate-500">Week start</p>
                  <p className="text-sm font-semibold text-white">{new Date(summary.weekStartIso).toLocaleDateString()}</p>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-5">
              <div className="flex items-center justify-between">
                <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Locations</p>
                <button
                  onClick={() => setShowGlobalErrors(true)}
                  className="inline-flex items-center gap-2 rounded-md border border-slate-700 bg-slate-950/40 px-2.5 py-1 text-[11px] font-semibold transition hover:border-slate-500"
                >
                  <span className="text-red-300">🔴 {summary.hardBlockCount}</span>
                  <span className="text-slate-600">·</span>
                  <span className="text-amber-300">⚠️ {summary.softWarningCount}</span>
                </button>
              </div>
              <div className="mt-3 space-y-2">
                {summary.locationBreakdown.map((loc) => (
                  <div key={loc.locationId} className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
                    <div>
                      <p className="text-sm font-semibold text-white">{loc.locationName}</p>
                      <p className="text-[12px] text-slate-400">{loc.shiftCount} shifts</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {loc.hardBlocks === 0 ? (
                        <span className="rounded-full bg-emerald-500/10 px-2 py-[2px] text-[11px] font-semibold text-emerald-200 ring-1 ring-emerald-500/30">Ready</span>
                      ) : (
                        <span className="rounded-full bg-red-500/10 px-2 py-[2px] text-[11px] font-semibold text-red-200 ring-1 ring-red-500/30">Blocked</span>
                      )}
                      <button
                        onClick={() => setSelectedLocationErrors({ locationId: loc.locationId, locationName: loc.locationName })}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold transition hover:opacity-80"
                      >
                        <span className="rounded-full bg-red-500/10 px-2 py-[2px] text-red-200 ring-1 ring-red-500/30">{loc.hardBlocks}</span>
                        <span className="rounded-full bg-amber-500/10 px-2 py-[2px] text-amber-200 ring-1 ring-amber-500/30">{loc.softWarnings}</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-5">
              <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Upcoming</p>
              <div className="mt-2 grid grid-cols-2 gap-3 text-sm text-slate-200">
                <div>
                  <p className="text-[12px] uppercase tracking-[0.1em] text-slate-500">Today</p>
                  {summary.todayShifts.length === 0 && <p className="text-slate-400">No shifts</p>}
                  {summary.todayShifts.slice(0, 4).map((shift) => (
                    <div key={shift.id} className="mt-1 rounded-md border border-slate-800 bg-slate-950/60 px-2 py-1">
                      <p className="font-semibold text-white">{shift.employeeName}</p>
                      <p className="text-[12px] text-slate-400">{shift.locationName}</p>
                      <p className="text-[12px] text-slate-500">
                        {new Date(shift.start).toLocaleTimeString(undefined, {
                          hour: 'numeric',
                          minute: '2-digit',
                          timeZone: shift.timezone || undefined,
                        })}{' '}
                        –{' '}
                        {new Date(shift.end).toLocaleTimeString(undefined, {
                          hour: 'numeric',
                          minute: '2-digit',
                          timeZone: shift.timezone || undefined,
                        })}
                      </p>
                    </div>
                  ))}
                  {summary.todayShifts.length > 4 && (
                    <p className="mt-1 text-[11px] text-slate-500">and {summary.todayShifts.length - 4} more</p>
                  )}
                </div>
                <div>
                  <p className="text-[12px] uppercase tracking-[0.1em] text-slate-500">Tomorrow</p>
                  {summary.tomorrowShifts.length === 0 && <p className="text-slate-400">No shifts</p>}
                  {summary.tomorrowShifts.slice(0, 4).map((shift) => (
                    <div key={shift.id} className="mt-1 rounded-md border border-slate-800 bg-slate-950/60 px-2 py-1">
                      <p className="font-semibold text-white">{shift.employeeName}</p>
                      <p className="text-[12px] text-slate-400">{shift.locationName}</p>
                      <p className="text-[12px] text-slate-500">
                        {new Date(shift.start).toLocaleTimeString(undefined, {
                          hour: 'numeric',
                          minute: '2-digit',
                          timeZone: shift.timezone || undefined,
                        })}{' '}
                        –{' '}
                        {new Date(shift.end).toLocaleTimeString(undefined, {
                          hour: 'numeric',
                          minute: '2-digit',
                          timeZone: shift.timezone || undefined,
                        })}
                      </p>
                    </div>
                  ))}
                  {summary.tomorrowShifts.length > 4 && (
                    <p className="mt-1 text-[11px] text-slate-500">and {summary.tomorrowShifts.length - 4} more</p>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-5">
            <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Location quick links</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {locations?.map((loc) => (
                <Link
                  key={loc.id}
                  to={`/schedule/${loc.id}`}
                  className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-3 text-sm font-semibold text-slate-100 transition hover:border-blue-500 hover:text-white"
                >
                  <div>
                    <p className="text-white">{loc.name}</p>
                    {loc.timezone ? (
                      <p className="text-[12px] text-slate-400">{loc.timezone}</p>
                    ) : (
                      <p className="text-[12px] text-amber-400">No timezone set</p>
                    )}
                  </div>
                  <span className="rounded-full bg-slate-800 px-2 py-[2px] text-[11px] text-slate-200">Open →</span>
                </Link>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Error Details Modals */}
      <ErrorDetailsModal
        isOpen={showGlobalErrors}
        onClose={() => setShowGlobalErrors(false)}
        errors={globalErrors}
        title="All Schedule Issues"
      />

      <ErrorDetailsModal
        isOpen={!!selectedLocationErrors}
        onClose={() => setSelectedLocationErrors(null)}
        errors={locationErrors}
        title={selectedLocationErrors ? `${selectedLocationErrors.locationName} Issues` : "Location Issues"}
      />
    </div>
  )
}

export default DashboardPage
