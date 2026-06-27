import { describe, expect, it } from 'vitest'
import { validateSchedule } from '../src/lib/rules-engine'
import type { ShiftRecord, GridEmployee, CoverageRequirement } from '../src/types'

describe('Property 26: Unassigned Shift Coverage Counting', () => {
  const sundayWeekStart = new Date('2023-12-31T00:00:00Z')
  const employees: GridEmployee[] = []

  it('counts unassigned shifts towards coverage requirements', () => {
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

    // Unassigned shift (employee_id is null)
    const shifts: ShiftRecord[] = [
      {
        id: 'shift1',
        location_id: 'loc1',
        employee_id: null,
        role_id: 'role1',
        start_datetime: '2024-01-01T09:00:00Z',
        end_datetime: '2024-01-01T17:00:00Z'
      }
    ]

    const errors = validateSchedule(shifts, employees, [], [], requirements, { weekStart: sundayWeekStart })
    
    expect(errors).toHaveLength(0)
  })

  it('counts mix of assigned and unassigned shifts', () => {
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

    const shifts: ShiftRecord[] = [
      {
        id: 'shift1',
        location_id: 'loc1',
        employee_id: 'emp1',
        role_id: 'role1',
        start_datetime: '2024-01-01T09:00:00Z',
        end_datetime: '2024-01-01T17:00:00Z'
      },
      {
        id: 'shift2',
        location_id: 'loc1',
        employee_id: null, // Unassigned
        role_id: 'role1',
        start_datetime: '2024-01-01T09:00:00Z',
        end_datetime: '2024-01-01T17:00:00Z'
      }
    ]

    const errors = validateSchedule(shifts, employees, [], [], requirements, { weekStart: sundayWeekStart })
    
    expect(errors).toHaveLength(0)
  })
})
