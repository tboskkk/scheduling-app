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
        .gte('start', weekStartIso)
        .lt('start', weekEndIso)
        .order('start', { ascending: true })

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

  const coverageQuery = useQuery({
    queryKey: ['global-validation-coverage', organizationId],
    enabled: enabled && Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('coverage_requirements')
        .select('*')
        .eq('organization_id', organizationId)

      if (error) throw new Error(error.message)
      return data ?? []
    },
  })

  // Compute global validation errors
  const validationErrors = useMemo((): ValidationError[] => {
    if (!locationsQuery.data || !employeesQuery.data || !shiftsQuery.data) return []
    
    return validateSchedule(
      shiftsQuery.data,
      employeesQuery.data,
      availabilityQuery.data ?? [],
      unavailabilityQuery.data ?? [],
      coverageQuery.data ?? [],
      {
        weekStart: weekStartDate,
        weekStartDay: settings.week_start_day,
        maxWeeklyHours: settings.weekly_overtime_threshold,
        maxDailyHours: settings.daily_overtime_threshold,
        minRestPeriodHours: settings.min_rest_period_hours,
        enableCaliforniaRules: settings.enable_california_rules,
      }
    )
  }, [
    locationsQuery.data, 
    employeesQuery.data, 
    shiftsQuery.data, 
    availabilityQuery.data, 
    unavailabilityQuery.data, 
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
    coverageQuery.isLoading

  return {
    validationErrors,
    isLoading,
    // Expose the raw data in case components need it
    locations: locationsQuery.data ?? [],
    employees: employeesQuery.data ?? [],
    shifts: shiftsQuery.data ?? [],
    availability: availabilityQuery.data ?? [],
    unavailability: unavailabilityQuery.data ?? [],
    coverage: coverageQuery.data ?? [],
  }
}