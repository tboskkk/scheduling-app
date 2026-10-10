import { describe, expect, it } from 'vitest'
import { validateSchedule, ConflictSeverity } from '../src/lib/rules-engine'
import type { ShiftRecord, GridEmployee, CoverageRequirement } from '../src/types'

describe('Property 14: Coverage Gap Detection', () => {
  // weekStart: 2024-01-01 (Monday)
  const employees: GridEmployee[] = [
    { id: 'emp1', name: 'Alice', is_floating: false, home_location_id: 'loc1' },
    { id: 'emp2', name: 'Bob', is_floating: false, home_location_id: 'loc1' }
  ]

  it('detects coverage gaps when no shifts are scheduled', () => {
    const shifts: ShiftRecord[] = []
    const requirements: CoverageRequirement[] = [
      {
        id: 'req1',
        location_id: 'loc1',
        role_id: 'role1',
        day_of_week: 0, // Monday (relative to weekStart if weekStart is Monday? No, day_of_week is 0-6 usually Sunday-Saturday or Monday-Sunday depending on convention. In our app, 0=Sunday usually, but let's check rules-engine logic)
        // In rules-engine: reqDate.setUTCDate(reqDate.getUTCDate() + req.day_of_week)
        // If weekStart is Monday (2024-01-01), and day_of_week is 0, then reqDate is Monday.
        // Wait, if weekStart is Sunday, then 0 is Sunday.
        // The app uses 0=Sunday.
        // If weekStart is 2024-01-01 (Monday), then +0 is Monday.
        // So day_of_week is relative to weekStart?
        // No, usually day_of_week is absolute (0=Sun, 1=Mon).
        // But in `checkCoverage`:
        // const reqDate = new Date(weekStart)
        // reqDate.setUTCDate(reqDate.getUTCDate() + req.day_of_week)
        // This implies day_of_week is an offset from weekStart.
        // If weekStart is Sunday, then 0=Sunday, 1=Monday.
        // If weekStart is Monday, then 0=Monday, 1=Tuesday.
        // This seems to be the logic implemented.
        // Let's assume weekStart is the start of the week (e.g. Sunday).
        
        start_time: '09:00:00',
        end_time: '17:00:00',
        min_employees: 1
      }
    ]

    // Let's assume weekStart passed to validateSchedule is the actual start of the week (e.g. Sunday Dec 31 2023 if we want Monday Jan 1 to be index 1)
    // Or if the app treats weekStart as the first day of the grid.
    // In `useScheduleStore`, `weekStartIso` is set to `startOfWeek(new Date())` which sets it to Sunday (0).
    // So `weekStart` is Sunday.
    // So `day_of_week` 0 is Sunday, 1 is Monday.
    
    // Let's use a Sunday as weekStart.
    const sundayWeekStart = new Date('2023-12-31T00:00:00Z') // Sunday
    
    const errors = validateSchedule(shifts, employees, [], [], requirements, { weekStart: sundayWeekStart })
    
    expect(errors).toHaveLength(1)
    expect(errors[0].ruleType).toBe('COVERAGE_GAP')
    expect(errors[0].severity).toBe(ConflictSeverity.SOFT_WARNING)
    expect(errors[0].meta?.missingCount).toBe(1)
  })

  it('detects partial coverage gaps', () => {
    const sundayWeekStart = new Date('2023-12-31T00:00:00Z')
    
    // Requirement: Monday 9-5, 2 employees
    const requirements: CoverageRequirement[] = [
      {
        id: 'req1',
        location_id: 'loc1',
        role_id: 'role1',
        day_of_week: 1, // Monday
        start_time: '09:00:00',
        end_time: '17:00:00',
        min_employees: 2
      }
    ]

    // Shift: Monday 9-5, 1 employee
    const shifts: ShiftRecord[] = [
      {
        id: 'shift1',
        location_id: 'loc1',
        employee_id: 'emp1',
        role_id: 'role1',
        start_datetime: '2024-01-01T09:00:00Z',
        end_datetime: '2024-01-01T17:00:00Z'
      }
    ]

    const errors = validateSchedule(shifts, employees, [], [], requirements, { weekStart: sundayWeekStart })
    
    // Should have error because we need 2, have 1
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0].ruleType).toBe('COVERAGE_GAP')
    expect(errors[0].meta?.missingCount).toBe(1)
  })

  it('detects gaps when shift covers only part of the requirement', () => {
    const sundayWeekStart = new Date('2023-12-31T00:00:00Z')
    
    // Requirement: Monday 9-5, 1 employee
    const requirements: CoverageRequirement[] = [
      {
        id: 'req1',
        location_id: 'loc1',
        role_id: 'role1',
        day_of_week: 1, // Monday
        start_time: '09:00:00',
        end_time: '17:00:00',
        min_employees: 1
      }
    ]

    // Shift: Monday 9-12, 1 employee (Gap 12-5)
    const shifts: ShiftRecord[] = [
      {
        id: 'shift1',
        location_id: 'loc1',
        employee_id: 'emp1',
        role_id: 'role1',
        start_datetime: '2024-01-01T09:00:00Z',
        end_datetime: '2024-01-01T12:00:00Z'
      }
    ]

    const errors = validateSchedule(shifts, employees, [], [], requirements, { weekStart: sundayWeekStart })
    
    expect(errors.length).toBeGreaterThan(0)
    const gapError = errors.find(e => e.ruleType === 'COVERAGE_GAP')
    expect(gapError).toBeDefined()
    // The gap is from 12:00 to 17:00
    expect(gapError?.meta?.startTime).toBe('2024-01-01T12:00:00.000Z')
    expect(gapError?.meta?.endTime).toBe('2024-01-01T17:00:00.000Z')
  })

  it('treats coverage as location-specific even when other locations are staffed', () => {
    const sundayWeekStart = new Date('2023-12-31T00:00:00Z')

    const requirements: CoverageRequirement[] = [
      {
        id: 'req1',
        location_id: 'loc1',
        role_id: 'role1',
        day_of_week: 1, // Monday
        start_time: '09:00:00',
        end_time: '17:00:00',
        min_employees: 1
      }
    ]

    const shifts: ShiftRecord[] = [
      {
        id: 'shift-loc1',
        location_id: 'loc1',
        employee_id: 'emp1',
        role_id: 'role1',
        start_datetime: '2024-01-01T09:00:00Z',
        end_datetime: '2024-01-01T17:00:00Z',
        break_start_datetime: '2024-01-01T12:00:00Z',
        break_end_datetime: '2024-01-01T13:00:00Z'
      },
      {
        id: 'shift-loc2',
        location_id: 'loc2',
        employee_id: 'emp2',
        role_id: 'role1',
        start_datetime: '2024-01-01T09:00:00Z',
        end_datetime: '2024-01-01T17:00:00Z'
      }
    ]

    const errors = validateSchedule(shifts, employees, [], [], requirements, { weekStart: sundayWeekStart })

    const gapErrors = errors.filter((e) => e.ruleType === 'COVERAGE_GAP')
    expect(gapErrors.length).toBeGreaterThan(0)
    expect(gapErrors.some((e) => e.meta?.missingCount === 1)).toBe(true)
  })

  it('resolves error when coverage is met', () => {
    const sundayWeekStart = new Date('2023-12-31T00:00:00Z')
    
    const requirements: CoverageRequirement[] = [
      {
        id: 'req1',
        location_id: 'loc1',
        role_id: 'role1',
        day_of_week: 1, // Monday
        start_time: '09:00:00',
        end_time: '17:00:00',
        min_employees: 1
      }
    ]

    const shifts: ShiftRecord[] = [
      {
        id: 'shift1',
        location_id: 'loc1',
        employee_id: 'emp1',
        role_id: 'role1',
        start_datetime: '2024-01-01T09:00:00Z',
        end_datetime: '2024-01-01T17:00:00Z'
      }
    ]

    const errors = validateSchedule(shifts, employees, [], [], requirements, { weekStart: sundayWeekStart })
    
    expect(errors).toHaveLength(0)
  })
})
