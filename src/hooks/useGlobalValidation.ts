import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient'
import { validateSchedule } from '../lib/rules-engine'
import type { ValidationError } from '../lib/rules-engine'
import { startOfWeekWithOffset } from '../lib/schedule-utils'
import { useOrganizationStore } from '../lib/useOrganizationStore'
import { DEFAULT_ORGANIZATION_SETTINGS } from '../types'

interface UseGlobalValidationOptions {
  enabled?: boolean
  organizationId?: string | null
}

export function useGlobalValidation({ enabled = true, organizationId }: UseGlobalValidationOptions = {}) {
  const { organization } = useOrganizationStore()
  const settings = organization?.settings ?? DEFAULT_ORGANIZATION_SETTINGS
  
  const weekStartDate = useMemo(() => startOfWeekWithOffset(new Date(), settings.week_start_day), [settings.week_start_day])
  const weekStartIso = useMemo(() => weekStartDate.toISOString(), [weekStartDate])
  const weekEndIso = useMemo(() => {
    const end = new Date(weekStartDate)
    end.setDate(end.getDate() + 7)
    return end.toISOString()
  }, [weekStartDate])

  // Fetch all organization data needed for validation
  const locationsQuery = useQuery({
    queryKey: ['global-validation-locations', organizationId],
    enabled: enabled && Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('locations')
        .select('id, name, timezone')
        .eq('organization_id', organizationId)
        .order('name', { ascending: true })

      if (error) throw new Error(error.message)
      return data as { id: string; name: string; timezone: string | null }[]
    },
  })

  const employeesQuery = useQuery({
    queryKey: ['global-validation-employees', organizationId],
    enabled: enabled && Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('employees')
        .select('id, name, is_floating, home_location_id, is_active')
        .eq('organization_id', organizationId)
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

  const shiftsQuery = useQuery({
    queryKey: ['global-validation-shifts', organizationId, weekStartIso, weekEndIso],
    enabled: enabled && Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('shifts')
        .select('*')
        .eq('organization_id', organizationId)
        .gte('start_datetime', weekStartIso)
        .lt('start_datetime', weekEndIso)
        .order('start_datetime', { ascending: true })

      if (error) throw new Error(error.message)
      return data ?? []
    },
  })

  const availabilityQuery = useQuery({
    queryKey: ['global-validation-availability', organizationId],
    enabled: enabled && Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('employee_availability')
        .select('*')
        .eq('organization_id', organizationId)

      if (error) throw new Error(error.message)
      return data ?? []
    },
  })

  const unavailabilityQuery = useQuery({
    queryKey: ['global-validation-unavailability', organizationId],
    enabled: enabled && Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('employee_unavailability')
        .select('*')
        .eq('organization_id', organizationId)

      if (error) throw new Error(error.message)
      return data ?? []
    },
  })

  // Approved time-off requests are stored as date ranges, not datetimes.
  // Convert them to the same shape as employee_unavailability so the rules engine
  // can flag shifts scheduled on approved time-off days as HARD_BLOCK conflicts.
  const approvedTimeOffQuery = useQuery({
    queryKey: ['global-validation-approved-time-off', organizationId, weekStartIso, weekEndIso],
    enabled: enabled && Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('time_off_requests')
        .select('id, employee_id, organization_id, start_date, end_date')
        .eq('organization_id', organizationId)
        .eq('status', 'approved')
        .gte('end_date', weekStartIso.slice(0, 10))
        .lte('start_date', weekEndIso.slice(0, 10))

      if (error) throw new Error(error.message)
      return (data ?? []).map((r) => ({
        id: `tor-${r.id}`,
        organization_id: r.organization_id,
        employee_id: r.employee_id,
        start_datetime: `${r.start_date}T00:00:00.000Z`,
        end_datetime: `${r.end_date}T23:59:59.999Z`,
      }))
    },
  })

  const locationIds = useMemo(() => locationsQuery.data?.map((l) => l.id) ?? [], [locationsQuery.data])

  const coverageQuery = useQuery({
    queryKey: ['global-validation-coverage', organizationId, locationIds],
    enabled: enabled && Boolean(organizationId) && Boolean(locationsQuery.data?.length),
    queryFn: async () => {
      if (locationIds.length === 0) return []
      const { data, error } = await supabase
        .from('coverage_requirements')
        .select('*')
        .in('location_id', locationIds)

      if (error) throw new Error(error.message)
      return data ?? []
    },
  })

  const allUnavailability = useMemo(
    () => [...(unavailabilityQuery.data ?? []), ...(approvedTimeOffQuery.data ?? [])],
    [unavailabilityQuery.data, approvedTimeOffQuery.data]
  )

  // Validate per-location so each location's timezone is applied correctly.
  // A single cross-org call would default to UTC, producing false-positive
  // AVAILABILITY errors for stores in non-UTC timezones.
  const validationErrors = useMemo((): ValidationError[] => {
    if (!locationsQuery.data || !employeesQuery.data || !shiftsQuery.data) return []

    const allShifts = shiftsQuery.data
    const allEmployees = employeesQuery.data
    const allAvailability = availabilityQuery.data ?? []
    const allCoverage = coverageQuery.data ?? []
    const config = {
      weekStart: weekStartDate,
      weekStartDay: settings.week_start_day,
      maxWeeklyHours: settings.weekly_overtime_threshold,
      maxDailyHours: settings.daily_overtime_threshold,
      minRestPeriodHours: settings.min_rest_period_hours,
      enableCaliforniaRules: settings.enable_california_rules,
    }

    return locationsQuery.data.flatMap((loc) =>
      validateSchedule(
        allShifts.filter((s) => s.location_id === loc.id),
        allEmployees,
        allAvailability,
        allUnavailability,
        allCoverage.filter((c) => c.location_id === loc.id),
        { ...config, timezone: loc.timezone || 'UTC' }
      )
    )
  }, [
    locationsQuery.data,
    employeesQuery.data,
    shiftsQuery.data,
    availabilityQuery.data,
    allUnavailability,
    coverageQuery.data,
    settings,
    weekStartDate
  ])

  const isLoading =
    locationsQuery.isLoading ||
    employeesQuery.isLoading ||
    shiftsQuery.isLoading ||
    availabilityQuery.isLoading ||
    unavailabilityQuery.isLoading ||
    approvedTimeOffQuery.isLoading ||
    coverageQuery.isLoading

  return {
    validationErrors,
    isLoading,
    // Expose the raw data in case components need it
    locations: locationsQuery.data ?? [],
    employees: employeesQuery.data ?? [],
    shifts: shiftsQuery.data ?? [],
    availability: availabilityQuery.data ?? [],
    unavailability: allUnavailability,
    coverage: coverageQuery.data ?? [],
  }
}