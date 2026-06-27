import { describe, expect, it } from 'vitest'
import { validateSchedule, ConflictSeverity } from '../src/lib/rules-engine'
import type { GridEmployee, ShiftRecord } from '../src/types'

describe('Property 5: Floating Employee Cross-Location Scheduling', () => {
  const employees: GridEmployee[] = [
    { id: 'emp-floating', name: 'Floater', is_floating: true, home_location_id: 'loc-a' },
    { id: 'emp-anchored', name: 'Anchored', is_floating: false, home_location_id: 'loc-a' },
  ]

  it('does not warn when a floating employee works another location', () => {
    const shift: ShiftRecord = {
      id: 'shift-float',
      location_id: 'loc-b',
      employee_id: 'emp-floating',
      role_id: 'role-1',
      start_datetime: '2024-01-01T12:00:00Z',
      end_datetime: '2024-01-01T18:00:00Z',
      schedule_id: null,
    }

    const errors = validateSchedule([shift], employees)
    const crossLocation = errors.filter((e) => e.ruleType === 'CROSS_LOCATION')

    expect(crossLocation.length).toBe(0)
  })

  it('adds a soft warning when a non-floating employee is scheduled outside the home location', () => {
    const shift: ShiftRecord = {
      id: 'shift-cross',
      location_id: 'loc-b',
      employee_id: 'emp-anchored',
      role_id: 'role-1',
      start_datetime: '2024-01-02T12:00:00Z',
      end_datetime: '2024-01-02T18:00:00Z',
      schedule_id: null,
    }

    const errors = validateSchedule([shift], employees)
    const crossLocation = errors.filter((e) => e.ruleType === 'CROSS_LOCATION')

    expect(crossLocation.length).toBeGreaterThan(0)
    expect(crossLocation[0]?.severity).toBe(ConflictSeverity.SOFT_WARNING)
  })
})
