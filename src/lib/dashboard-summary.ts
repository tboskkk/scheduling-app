import { validateSchedule, ConflictSeverity } from './rules-engine'
import { startOfWeekWithOffset } from './schedule-utils'
import type {
  GridEmployee,
  ShiftRecord,
  EmployeeAvailability,
  EmployeeUnavailability,
  CoverageRequirement,
  OrganizationSettings,
} from '../types'

export type DashboardLocation = {
  id: string
  name: string
  timezone: string | null
}

export type DashboardShiftInfo = {
  id: string
  locationId: string
  locationName: string
  employeeName: string
  start: string
  end: string
  timezone: string | null
  dayLabel: 'today' | 'tomorrow'
}

export type DashboardSummary = {
  weekStartIso: string
  weekEndIso: string
  totalShifts: number
  hardBlockCount: number
  softWarningCount: number
  locationBreakdown: {
    locationId: string
    locationName: string
    hardBlocks: number
    softWarnings: number
    shiftCount: number
  }[]
  todayShifts: DashboardShiftInfo[]
  tomorrowShifts: DashboardShiftInfo[]
}

function dateKey(date: Date, timezone: string | null): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone || undefined,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

export function computeDashboardSummary(params: {
  locations: DashboardLocation[]
  shifts: ShiftRecord[]
  employees: GridEmployee[]
  availability: EmployeeAvailability[]
  unavailability: EmployeeUnavailability[]
  coverageRequirements: CoverageRequirement[]
  settings: OrganizationSettings
  now?: Date
}): DashboardSummary {
  const { locations, shifts, employees, availability, unavailability, coverageRequirements, settings } = params
  const now = params.now ? new Date(params.now) : new Date()

  const weekStart = startOfWeekWithOffset(now, settings.week_start_day)
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekStart.getDate() + 7)

  const employeeLookup = new Map(employees.map((e) => [e.id, e]))
  const locationLookup = new Map(locations.map((loc) => [loc.id, loc]))

  const locationBreakdown = locations.map((loc) => {
    const locShifts = shifts.filter((shift) => shift.location_id === loc.id)
    const locCoverage = coverageRequirements.filter((c) => c.location_id === loc.id)

    const errors = validateSchedule(locShifts, employees, availability, unavailability, locCoverage, {
      weekStart,
      weekStartDay: settings.week_start_day,
      maxWeeklyHours: settings.weekly_overtime_threshold,
      maxDailyHours: settings.daily_overtime_threshold,
      minRestPeriodHours: settings.min_rest_period_hours,
      enableCaliforniaRules: settings.enable_california_rules,
      timezone: loc.timezone || undefined,
    })

    const hardBlocks = errors.filter((e) => e.severity === ConflictSeverity.HARD_BLOCK).length
    const softWarnings = errors.filter((e) => e.severity === ConflictSeverity.SOFT_WARNING).length

    return {
      locationId: loc.id,
      locationName: loc.name,
      hardBlocks,
      softWarnings,
      shiftCount: locShifts.length,
    }
  })

  const hardBlockCount = locationBreakdown.reduce((total, item) => total + item.hardBlocks, 0)
  const softWarningCount = locationBreakdown.reduce((total, item) => total + item.softWarnings, 0)

  const todayShifts: DashboardShiftInfo[] = []
  const tomorrowShifts: DashboardShiftInfo[] = []

  const todayByLocationKey = new Map<string, string>()
  const tomorrowByLocationKey = new Map<string, string>()

  locations.forEach((loc) => {
    todayByLocationKey.set(loc.id, dateKey(now, loc.timezone))
    const tomorrow = new Date(now)
    tomorrow.setDate(now.getDate() + 1)
    tomorrowByLocationKey.set(loc.id, dateKey(tomorrow, loc.timezone))
  })

  shifts.forEach((shift) => {
    const loc = locationLookup.get(shift.location_id)
    if (!loc) return

    const shiftDayKey = dateKey(new Date(shift.start_datetime), loc.timezone)
    const todayKey = todayByLocationKey.get(loc.id)
    const tomorrowKey = tomorrowByLocationKey.get(loc.id)

    const employeeName = shift.employee_id ? employeeLookup.get(shift.employee_id)?.name ?? 'Employee' : 'Unassigned'
    const baseInfo = {
      id: shift.id,
      locationId: loc.id,
      locationName: loc.name,
      employeeName,
      start: shift.start_datetime,
      end: shift.end_datetime,
      timezone: loc.timezone,
    }

    if (todayKey && shiftDayKey === todayKey) {
      todayShifts.push({ ...baseInfo, dayLabel: 'today' })
    } else if (tomorrowKey && shiftDayKey === tomorrowKey) {
      tomorrowShifts.push({ ...baseInfo, dayLabel: 'tomorrow' })
    }
  })

  const byStart = (a: DashboardShiftInfo, b: DashboardShiftInfo) =>
    new Date(a.start).getTime() - new Date(b.start).getTime()

  todayShifts.sort(byStart)
  tomorrowShifts.sort(byStart)

  return {
    weekStartIso: weekStart.toISOString(),
    weekEndIso: weekEnd.toISOString(),
    totalShifts: shifts.length,
    hardBlockCount,
    softWarningCount,
    locationBreakdown,
    todayShifts,
    tomorrowShifts,
  }
}
