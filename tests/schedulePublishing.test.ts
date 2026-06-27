import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { validateSchedule, canPublish, ConflictSeverity } from '../src/lib/rules-engine'
import type { ShiftRecord, GridEmployee } from '../src/types'

describe('Property 18: Schedule Publishing Guards', () => {
  it('should prevent publishing if hard blocks exist', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            id: fc.uuid(),
            location_id: fc.uuid(),
            schedule_id: fc.option(fc.uuid(), { nil: undefined }),
            employee_id: fc.uuid(),
            role_id: fc.uuid(),
            start_datetime: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }).map(d => d.toISOString()),
            duration: fc.integer({ min: 1, max: 8 })
          }),
          { minLength: 1, maxLength: 5 }
        ),
        (shiftData) => {
          // Create shifts
          const shifts: ShiftRecord[] = shiftData.map(s => {
            const start = new Date(s.start_datetime)
            const end = new Date(start.getTime() + s.duration * 60 * 60 * 1000)
            return {
              ...s,
              schedule_id: s.schedule_id ?? null,
              end_datetime: end.toISOString()
            }
          })

          // Create a hard block scenario: Double booking
          // Pick one shift and duplicate it
          if (shifts.length > 0) {
             const duplicate = { ...shifts[0], id: 'duplicate-id' }
             shifts.push(duplicate)
          }

          const employees: GridEmployee[] = shifts
            .map(s => s.employee_id)
            .filter((id): id is string => id !== null)
            .map(id => ({
                id,
                name: 'Test Employee',
                is_floating: false,
                home_location_id: 'loc-1',
                organization_id: 'org-1',
                is_active: true
            }))

          const errors = validateSchedule(shifts, employees)
          
          // We expect hard blocks because of double booking
          const hasHardBlock = errors.some(e => e.severity === ConflictSeverity.HARD_BLOCK)
          
          // If we have hard blocks, canPublish should be false
          if (hasHardBlock) {
              expect(canPublish(errors)).toBe(false)
          } else {
              expect(canPublish(errors)).toBe(true)
          }
        }
      )
    )
  })
})
