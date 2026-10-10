import { describe, expect, it } from 'vitest'
import * as fc from 'fast-check'
import { copyShiftsToNextWeek } from '../src/lib/schedule-utils'
import { ShiftRecord } from '../src/types'
import { localTimeLabel } from '../src/components/schedule/time'

describe('Property 27: Copy Week Schedule Equivalence', () => {
  const timezone = 'America/New_York'

  it('should preserve number of shifts, employee assignments, and roles', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            id: fc.uuid(),
            location_id: fc.uuid(),
            employee_id: fc.uuid(),
            role_id: fc.uuid(),
            start_offset_hours: fc.integer({ min: 0, max: 160 }), // Within a week (168h)
            duration_hours: fc.integer({ min: 1, max: 12 }),
          })
        ),
        fc.date({ min: new Date('2023-01-01'), max: new Date('2025-12-31') }),
        (shiftSpecs, weekStartBase) => {
          // Align weekStartBase to a Monday 00:00 in timezone for simplicity in test setup
          // But the function should handle any date as long as it's the "start of week"
          // Let's just use the date as is, assuming it's the start of the week.
          
          // Construct prevShifts
          const prevWeekStart = new Date(weekStartBase)
          prevWeekStart.setHours(0, 0, 0, 0) // Normalize
          
          const prevShifts: ShiftRecord[] = shiftSpecs.map(spec => {
            const start = new Date(prevWeekStart.getTime() + spec.start_offset_hours * 60 * 60 * 1000)
            const end = new Date(start.getTime() + spec.duration_hours * 60 * 60 * 1000)
            return {
              id: spec.id,
              location_id: spec.location_id,
              employee_id: spec.employee_id,
              role_id: spec.role_id,
              start_datetime: start.toISOString(),
              end_datetime: end.toISOString(),
              schedule_id: null
            }
          })

          const currentWeekStart = new Date(prevWeekStart)
          currentWeekStart.setDate(currentWeekStart.getDate() + 7)

          const newShifts = copyShiftsToNextWeek(prevShifts, prevWeekStart, currentWeekStart, timezone)

          expect(newShifts).toHaveLength(prevShifts.length)

          newShifts.forEach((newShift, i) => {
            const original = prevShifts[i]
            expect(newShift.employee_id).toBe(original.employee_id)
            expect(newShift.role_id).toBe(original.role_id)
            expect(newShift.location_id).toBe(original.location_id)
            
            // Check time preservation (local time)
            const origStartLabel = localTimeLabel(original.start_datetime, timezone)
            const newStartLabel = localTimeLabel(newShift.start_datetime, timezone)
            expect(newStartLabel).toBe(origStartLabel)

            const origEndLabel = localTimeLabel(original.end_datetime, timezone)
            const newEndLabel = localTimeLabel(newShift.end_datetime, timezone)
            expect(newEndLabel).toBe(origEndLabel)

            // Check day of week preservation
            const origDay = new Date(original.start_datetime).toLocaleDateString('en-US', { weekday: 'short', timeZone: timezone })
            const newDay = new Date(newShift.start_datetime).toLocaleDateString('en-US', { weekday: 'short', timeZone: timezone })
            expect(newDay).toBe(origDay)
          })
        }
      )
    )
  })
})
