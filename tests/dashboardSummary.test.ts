import { describe, expect, it } from 'vitest'
import { computeDashboardSummary } from '../src/lib/dashboard-summary'
import type {
  CoverageRequirement,
  EmployeeAvailability,
  EmployeeUnavailability,
  GridEmployee,
  OrganizationSettings,
  ShiftRecord,
} from '../src/types'

const defaultSettings: OrganizationSettings = {
  weekly_overtime_threshold: 40,
  daily_overtime_threshold: 8,
  min_rest_period_hours: 8,
  week_start_day: 1,
  enable_california_rules: false,
  time_format: '12h',
  currency: 'CAD',
}

describe('Property 22: Dashboard Conflict Count Accuracy', () => {
  it('aggregates hard blocks, soft warnings, and upcoming shifts across locations', () => {
    const now = new Date('2024-06-10T12:00:00Z') // Monday

    const locations = [
      { id: 'loc-a', name: 'East', timezone: 'America/New_York' },
      { id: 'loc-b', name: 'West', timezone: 'America/Los_Angeles' },
    ]

    const employees: GridEmployee[] = [
      { id: 'emp-anchored', name: 'Anchored', is_floating: false, home_location_id: 'loc-a' },
      { id: 'emp-floater', name: 'Floater', is_floating: true, home_location_id: 'loc-b' },
    ]

    const shifts: ShiftRecord[] = [
      {
        id: 's1',
        location_id: 'loc-a',
        employee_id: 'emp-anchored',
        role_id: 'role-1',
        start_datetime: '2024-06-10T13:00:00Z',
        end_datetime: '2024-06-10T17:00:00Z',
        schedule_id: null,
      },
      {
        id: 's2',
        location_id: 'loc-a',
        employee_id: 'emp-anchored',
        role_id: 'role-1',
        start_datetime: '2024-06-10T15:00:00Z',
        end_datetime: '2024-06-10T18:00:00Z',
        schedule_id: null,
      },
      {
        id: 's3',
        location_id: 'loc-b',
        employee_id: 'emp-anchored',
        role_id: 'role-2',
        start_datetime: '2024-06-11T16:00:00Z',
        end_datetime: '2024-06-11T19:00:00Z',
        schedule_id: null,
      },
      {
        id: 's4',
        location_id: 'loc-b',
        employee_id: 'emp-floater',
        role_id: 'role-3',
        start_datetime: '2024-06-10T18:00:00Z',
        end_datetime: '2024-06-10T20:00:00Z',
        schedule_id: null,
      },
    ]

    const availability: EmployeeAvailability[] = []
    const unavailability: EmployeeUnavailability[] = []
    const coverage: CoverageRequirement[] = []

    const summary = computeDashboardSummary({
      locations,
      shifts,
      employees,
      availability,
      unavailability,
      coverageRequirements: coverage,
      settings: defaultSettings,
      now,
    })

    const east = summary.locationBreakdown.find((loc) => loc.locationId === 'loc-a')
    const west = summary.locationBreakdown.find((loc) => loc.locationId === 'loc-b')

    expect(east?.hardBlocks).toBe(2)
    expect(east?.softWarnings).toBe(0)
    expect(west?.hardBlocks).toBe(0)
    expect(west?.softWarnings).toBe(1)

    expect(summary.hardBlockCount).toBe(2)
    expect(summary.softWarningCount).toBe(1)

    expect(summary.todayShifts.map((s) => s.id)).toEqual(expect.arrayContaining(['s1', 's2', 's4']))
    expect(summary.tomorrowShifts.map((s) => s.id)).toContain('s3')
  })
})
