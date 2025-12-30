import { useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import type { ManagerProfile } from '../types'
import { DEFAULT_ORGANIZATION_SETTINGS } from '../types'
import { supabase } from '../lib/supabaseClient'
import { computeDashboardSummary } from '../lib/dashboard-summary'
import { startOfWeekWithOffset } from '../lib/schedule-utils'
import { useOrganizationStore } from '../lib/useOrganizationStore'
import { formatWeekRange } from '../components/schedule/useScheduleStore'
import OnboardingWizard from '../components/OnboardingWizard'

interface DashboardPageProps {
  managerProfile: ManagerProfile | null
  isFetchingManager: boolean
  onOrganizationCreated: (orgId: string) => void
  userEmail: string
}

function DashboardPage({
  managerProfile,
  isFetchingManager,
  onOrganizationCreated,
  userEmail,
}: DashboardPageProps) {
  const { organization, fetchOrganization } = useOrganizationStore()
  const orgId = managerProfile?.organization_id ?? null
  const isManagerMissing = !managerProfile

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
  const weekEndIso = useMemo(() => {
    const end = new Date(weekStartDate)
    end.setDate(end.getDate() + 7)
    return end.toISOString()
  }, [weekStartDate])
  const weekLabel = useMemo(() => formatWeekRange(weekStartIso, null), [weekStartIso])

  const locationsQuery = useQuery({
    queryKey: ['dashboard-locations', orgId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('locations')
        .select('id, name, timezone')
        .eq('organization_id', orgId)
        .order('name', { ascending: true })

      if (error) throw new Error(error.message)
      return data as { id: string; name: string; timezone: string | null }[]
    },
  })

  const employeesQuery = useQuery({
    queryKey: ['dashboard-employees', orgId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('employees')
        .select('id, name, is_floating, home_location_id, is_active')
        .eq('organization_id', orgId)
        .eq('is_active', true)
        .order('name', { ascending: true })

      if (error) throw new Error(error.message)
      return (data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        is_floating: row.is_floating,
        home_location_id: row.home_location_id,
      }))
    },
  })

  const availabilityQuery = useQuery({
    queryKey: ['dashboard-availability', orgId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('employee_availability')
        .select('*')
        .eq('organization_id', orgId)

      if (error) throw new Error(error.message)
      return data ?? []
    },
  })

  const unavailabilityQuery = useQuery({
    queryKey: ['dashboard-unavailability', orgId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('employee_unavailability')
        .select('*')
        .eq('organization_id', orgId)

      if (error) throw new Error(error.message)
      return data ?? []
    },
  })

  const locationIds = locationsQuery.data?.map((loc) => loc.id) ?? []

  const coverageQuery = useQuery({
    queryKey: ['dashboard-coverage', locationIds.join('-')],
    enabled: locationIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('coverage_requirements')
        .select('*')
        .in('location_id', locationIds)

      if (error) throw new Error(error.message)
      return data ?? []
    },
  })

  const shiftsQuery = useQuery({
    queryKey: ['dashboard-shifts', orgId, weekStartIso, weekEndIso, locationIds.join('-')],
    enabled: locationIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('shifts')
        .select('id, location_id, employee_id, role_id, start_datetime, end_datetime')
        .eq('organization_id', orgId)
        .in('location_id', locationIds)
        .gte('start_datetime', weekStartIso)
        .lt('start_datetime', weekEndIso)
        .order('start_datetime', { ascending: true })

      if (error) throw new Error(error.message)
      return data ?? []
    },
  })

  const isLoading =
    locationsQuery.isLoading ||
    employeesQuery.isLoading ||
    shiftsQuery.isLoading ||
    availabilityQuery.isLoading ||
    unavailabilityQuery.isLoading ||
    coverageQuery.isLoading

  const summary = useMemo(() => {
    if (!locationsQuery.data || !employeesQuery.data || !shiftsQuery.data) return null
    return computeDashboardSummary({
      locations: locationsQuery.data,
      shifts: shiftsQuery.data,
      employees: employeesQuery.data,
      availability: availabilityQuery.data ?? [],
      unavailability: unavailabilityQuery.data ?? [],
      coverageRequirements: coverageQuery.data ?? [],
      settings,
      now: new Date(),
    })
  }, [locationsQuery.data, employeesQuery.data, shiftsQuery.data, availabilityQuery.data, unavailabilityQuery.data, coverageQuery.data, settings])

  const hasData = Boolean(summary && locationsQuery.data?.length)

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
                  <p className="text-lg font-semibold text-white">{locationsQuery.data?.length ?? 0}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.12em] text-slate-500">Active employees</p>
                  <p className="text-lg font-semibold text-white">{employeesQuery.data?.length ?? 0}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.12em] text-slate-500">Week start</p>
                  <p className="text-sm font-semibold text-white">{new Date(summary.weekStartIso).toLocaleDateString()}</p>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-5">
              <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Conflicts</p>
              <div className="mt-2 flex items-center gap-3 text-sm font-semibold text-white">
                <span className="inline-flex items-center gap-2 rounded-md bg-red-500/10 px-3 py-1 text-red-200 ring-1 ring-red-500/30">
                  🔴 {summary.hardBlockCount}
                </span>
                <span className="inline-flex items-center gap-2 rounded-md bg-amber-500/10 px-3 py-1 text-amber-200 ring-1 ring-amber-500/30">
                  ⚠️ {summary.softWarningCount}
                </span>
              </div>
              <div className="mt-3 space-y-2 text-sm text-slate-200">
                {summary.locationBreakdown.map((loc) => (
                  <div key={loc.locationId} className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
                    <div>
                      <p className="font-semibold text-white">{loc.locationName}</p>
                      <p className="text-[12px] text-slate-400">{loc.shiftCount} shifts</p>
                    </div>
                    <div className="flex items-center gap-2 text-[12px] font-semibold">
                      <span className="rounded-full bg-red-500/10 px-2 py-[2px] text-red-200 ring-1 ring-red-500/30">{loc.hardBlocks}</span>
                      <span className="rounded-full bg-amber-500/10 px-2 py-[2px] text-amber-200 ring-1 ring-amber-500/30">{loc.softWarnings}</span>
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
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-5 md:col-span-2">
              <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Location quick links</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {locationsQuery.data?.map((loc) => (
                  <Link
                    key={loc.id}
                    to={`/schedule/${loc.id}`}
                    className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-3 text-sm font-semibold text-slate-100 transition hover:border-blue-500 hover:text-white"
                  >
                    <div>
                      <p className="text-white">{loc.name}</p>
                      <p className="text-[12px] text-slate-400">Timezone: {loc.timezone || 'Local'}</p>
                    </div>
                    <span className="rounded-full bg-slate-800 px-2 py-[2px] text-[11px] text-slate-200">Open</span>
                  </Link>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-5">
              <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Publish readiness</p>
              <p className="mt-1 text-sm text-slate-300">Resolve hard blocks before publishing. Soft warnings can be acknowledged during publish.</p>
              <div className="mt-3 space-y-2 text-sm text-slate-200">
                {summary.locationBreakdown.map((loc) => (
                  <div key={loc.locationId} className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
                    <span className="font-semibold text-white">{loc.locationName}</span>
                    {loc.hardBlocks === 0 ? (
                      <span className="rounded-full bg-emerald-500/10 px-2 py-[2px] text-[11px] font-semibold text-emerald-200 ring-1 ring-emerald-500/30">Ready</span>
                    ) : (
                      <span className="rounded-full bg-red-500/10 px-2 py-[2px] text-[11px] font-semibold text-red-200 ring-1 ring-red-500/30">Blocked</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default DashboardPage
