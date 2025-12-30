import { create } from 'zustand'
import { DEFAULT_ORGANIZATION_SETTINGS } from '../../types'
import type { ShiftRecord, GridEmployee, EmployeeAvailability, EmployeeUnavailability, CoverageRequirement, OrganizationSettings, Schedule } from '../../types'
import { validateSchedule } from '../../lib/rules-engine'
import type { ValidationError } from '../../lib/rules-engine'
import { startOfWeekWithOffset } from '../../lib/schedule-utils'
import { toZonedISOString } from './time'

type ScheduleStore = {
  weekStartIso: string
  timezone: string | null
  schedule: Schedule | null
  shifts: ShiftRecord[]
  employees: GridEmployee[]
  availability: EmployeeAvailability[]
  unavailability: EmployeeUnavailability[]
  coverageRequirements: CoverageRequirement[]
  organizationSettings: OrganizationSettings
  isLoading: boolean
  error: string | null
  selectedShiftIds: string[]
  clipboardShifts: ShiftRecord[]
  validationErrors: ValidationError[]
  setWeekStart: (value: Date) => void
  shiftWeek: (delta: number) => void
  goToToday: () => void
  setTimezone: (value: string | null) => void
  setSchedule: (value: Schedule | null) => void
  setShifts: (value: ShiftRecord[] | ((prev: ShiftRecord[]) => ShiftRecord[])) => void
  setEmployees: (value: GridEmployee[]) => void
  setAvailability: (value: EmployeeAvailability[]) => void
  setUnavailability: (value: EmployeeUnavailability[]) => void
  setCoverageRequirements: (value: CoverageRequirement[]) => void
  setOrganizationSettings: (value: OrganizationSettings) => void
  setIsLoading: (value: boolean) => void
  setError: (value: string | null) => void
  toggleShiftSelection: (id: string) => void
  clearSelection: () => void
  setClipboardShifts: (shifts: ShiftRecord[]) => void
  validate: () => void
}

export function startOfWeek(date: Date) {
  return startOfWeekWithOffset(date, 0)
}

export function formatWeekRange(startIso: string, timezone?: string | null) {
  const start = new Date(startIso)
  const end = new Date(start)
  end.setDate(start.getDate() + 6)
  const format = (d: Date) =>
    d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: timezone || undefined,
    })
  return `${format(start)} – ${format(end)}`
}

const initialWeekStart = startOfWeek(new Date()).toISOString()

export const useScheduleStore = create<ScheduleStore>((set) => ({
  weekStartIso: initialWeekStart,
  timezone: null,
  schedule: null,
  shifts: [],
  employees: [],
  availability: [],
  unavailability: [],
  coverageRequirements: [],
  organizationSettings: DEFAULT_ORGANIZATION_SETTINGS,
  isLoading: false,
  error: null,
  selectedShiftIds: [],
  clipboardShifts: [],
  validationErrors: [],
  setWeekStart: (value) => set((state) => ({ weekStartIso: startOfWeekWithOffset(value, state.organizationSettings.week_start_day).toISOString() })),
  shiftWeek: (delta) =>
    set((state) => {
      const next = new Date(state.weekStartIso)
      next.setDate(next.getDate() + delta * 7)
      return { weekStartIso: startOfWeekWithOffset(next, state.organizationSettings.week_start_day).toISOString() }
    }),
  goToToday: () => set((state) => ({ weekStartIso: startOfWeekWithOffset(new Date(), state.organizationSettings.week_start_day).toISOString() })),
  setTimezone: (value) =>
    set((state) => {
      // Re-run validation when timezone changes because coverage calculations depend on local time boundaries
      const weekStart = value
        ? new Date(toZonedISOString(new Date(state.weekStartIso), '00:00', value))
        : new Date(state.weekStartIso)

      const errors = validateSchedule(
        state.shifts,
        state.employees,
        state.availability,
        state.unavailability,
        state.coverageRequirements,
        {
          weekStart,
          timezone: value || 'UTC',
          maxWeeklyHours: state.organizationSettings.weekly_overtime_threshold,
          maxDailyHours: state.organizationSettings.daily_overtime_threshold,
          minRestPeriodHours: state.organizationSettings.min_rest_period_hours,
          weekStartDay: state.organizationSettings.week_start_day,
          enableCaliforniaRules: state.organizationSettings.enable_california_rules,
        },
      )

      return { timezone: value, validationErrors: errors }
    }),
  setSchedule: (value) => set({ schedule: value }),
  setShifts: (value) =>
    set((state) => {
      const nextShifts = typeof value === 'function' ? value(state.shifts) : value
      const weekStart = state.timezone 
        ? new Date(toZonedISOString(new Date(state.weekStartIso), '00:00', state.timezone))
        : new Date(state.weekStartIso)

      const errors = validateSchedule(
        nextShifts, 
        state.employees, 
        state.availability, 
        state.unavailability, 
        state.coverageRequirements,
        { 
          weekStart,
          timezone: state.timezone || 'UTC',
          maxWeeklyHours: state.organizationSettings.weekly_overtime_threshold,
          maxDailyHours: state.organizationSettings.daily_overtime_threshold,
          minRestPeriodHours: state.organizationSettings.min_rest_period_hours,
          weekStartDay: state.organizationSettings.week_start_day,
          enableCaliforniaRules: state.organizationSettings.enable_california_rules
        }
      )
      return { shifts: nextShifts, validationErrors: errors }
    }),
  setEmployees: (value) =>
    set((state) => {
      const weekStart = state.timezone 
        ? new Date(toZonedISOString(new Date(state.weekStartIso), '00:00', state.timezone))
        : new Date(state.weekStartIso)

      const errors = validateSchedule(
        state.shifts, 
        value, 
        state.availability, 
        state.unavailability,
        state.coverageRequirements,
        { 
          weekStart,
          timezone: state.timezone || 'UTC',
          maxWeeklyHours: state.organizationSettings.weekly_overtime_threshold,
          maxDailyHours: state.organizationSettings.daily_overtime_threshold,
          minRestPeriodHours: state.organizationSettings.min_rest_period_hours,
          weekStartDay: state.organizationSettings.week_start_day,
          enableCaliforniaRules: state.organizationSettings.enable_california_rules
        }
      )
      return { employees: value, validationErrors: errors }
    }),
  setAvailability: (value) =>
    set((state) => {
      const weekStart = state.timezone 
        ? new Date(toZonedISOString(new Date(state.weekStartIso), '00:00', state.timezone))
        : new Date(state.weekStartIso)

      const errors = validateSchedule(
        state.shifts, 
        state.employees, 
        value, 
        state.unavailability,
        state.coverageRequirements,
        { 
          weekStart,
          timezone: state.timezone || 'UTC',
          maxWeeklyHours: state.organizationSettings.weekly_overtime_threshold,
          maxDailyHours: state.organizationSettings.daily_overtime_threshold,
          minRestPeriodHours: state.organizationSettings.min_rest_period_hours,
          weekStartDay: state.organizationSettings.week_start_day,
          enableCaliforniaRules: state.organizationSettings.enable_california_rules
        }
      )
      return { availability: value, validationErrors: errors }
    }),
  setUnavailability: (value) =>
    set((state) => {
      const weekStart = state.timezone 
        ? new Date(toZonedISOString(new Date(state.weekStartIso), '00:00', state.timezone))
        : new Date(state.weekStartIso)

      const errors = validateSchedule(
        state.shifts, 
        state.employees, 
        state.availability, 
        value,
        state.coverageRequirements,
        { 
          weekStart,
          timezone: state.timezone || 'UTC',
          maxWeeklyHours: state.organizationSettings.weekly_overtime_threshold,
          maxDailyHours: state.organizationSettings.daily_overtime_threshold,
          minRestPeriodHours: state.organizationSettings.min_rest_period_hours,
          weekStartDay: state.organizationSettings.week_start_day,
          enableCaliforniaRules: state.organizationSettings.enable_california_rules
        }
      )
      return { unavailability: value, validationErrors: errors }
    }),
  setCoverageRequirements: (value) =>
    set((state) => {
      const weekStart = state.timezone 
        ? new Date(toZonedISOString(new Date(state.weekStartIso), '00:00', state.timezone))
        : new Date(state.weekStartIso)

      const errors = validateSchedule(
        state.shifts, 
        state.employees, 
        state.availability, 
        state.unavailability, 
        value,
        { 
          weekStart,
          timezone: state.timezone || 'UTC',
          maxWeeklyHours: state.organizationSettings.weekly_overtime_threshold,
          maxDailyHours: state.organizationSettings.daily_overtime_threshold,
          minRestPeriodHours: state.organizationSettings.min_rest_period_hours,
          weekStartDay: state.organizationSettings.week_start_day,
          enableCaliforniaRules: state.organizationSettings.enable_california_rules
        }
      )
      return { coverageRequirements: value, validationErrors: errors }
    }),
  setOrganizationSettings: (value) =>
    set((state) => {
      let newWeekStartIso = state.weekStartIso
      if (state.organizationSettings.week_start_day !== value.week_start_day) {
        const anchor = new Date(state.weekStartIso)
        anchor.setDate(anchor.getDate() + 3)
        newWeekStartIso = startOfWeekWithOffset(anchor, value.week_start_day).toISOString()
      }

      const weekStart = state.timezone 
        ? new Date(toZonedISOString(new Date(newWeekStartIso), '00:00', state.timezone))
        : new Date(newWeekStartIso)

      const errors = validateSchedule(
        state.shifts, 
        state.employees, 
        state.availability, 
        state.unavailability, 
        state.coverageRequirements,
        { 
          weekStart,
          timezone: state.timezone || 'UTC',
          maxWeeklyHours: value.weekly_overtime_threshold,
          maxDailyHours: value.daily_overtime_threshold,
          minRestPeriodHours: value.min_rest_period_hours,
          weekStartDay: value.week_start_day,
          enableCaliforniaRules: value.enable_california_rules
        }
      )
      return { organizationSettings: value, validationErrors: errors, weekStartIso: newWeekStartIso }
    }),
  setIsLoading: (value) => set({ isLoading: value }),
  setError: (value) => set({ error: value }),
  toggleShiftSelection: (id) =>
    set((state) => {
      const isSelected = state.selectedShiftIds.includes(id)
      return {
        selectedShiftIds: isSelected
          ? state.selectedShiftIds.filter((sid) => sid !== id)
          : [...state.selectedShiftIds, id],
      }
    }),
  clearSelection: () => set({ selectedShiftIds: [] }),
  setClipboardShifts: (shifts) => set({ clipboardShifts: shifts }),
  validate: () =>
    set((state) => {
      const weekStart = state.timezone 
        ? new Date(toZonedISOString(new Date(state.weekStartIso), '00:00', state.timezone))
        : new Date(state.weekStartIso)

      return {
        validationErrors: validateSchedule(
          state.shifts, 
          state.employees, 
          state.availability, 
          state.unavailability, 
          state.coverageRequirements,
          { 
            weekStart,
            timezone: state.timezone || 'UTC',
            maxWeeklyHours: state.organizationSettings.weekly_overtime_threshold,
            maxDailyHours: state.organizationSettings.daily_overtime_threshold,
            minRestPeriodHours: state.organizationSettings.min_rest_period_hours,
            weekStartDay: state.organizationSettings.week_start_day,
            enableCaliforniaRules: state.organizationSettings.enable_california_rules
          }
        ),
      }
    }),
}))