import { describe, expect, it } from 'vitest'
import * as fc from 'fast-check'
import { copyShiftsToNextWeek } from '../src/lib/schedule-utils'
import { ShiftRecord } from '../src/types'
import { localTimeLabel } from '../src/components/schedule/time'

// Wall-clock reading of an instant in `tz`, expressed as ms of the same wall time read as UTC.
function wallAsUtcMs(ms: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
  }).formatToParts(new Date(ms))
  const get = (t: string) => Number(parts.find(p => p.type === t)!.value)
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
}

function offsetMs(ms: number, tz: string): number {
  return wallAsUtcMs(ms, tz) - Math.floor(ms / 1000) * 1000
}

// True when the wall time (dateStr 'YYYY-MM-DD', label 'HH:MM') does not exist in `tz`
// because of a DST spring-forward gap: neither the offset before nor after the
// transition maps that wall time back to itself.
function isInDstGap(dateStr: string, label: string, tz: string): boolean {
  const [y, mo, d] = dateStr.split('-').map(Number)
  const [h, mi] = label.split(':').map(Number)
  const naive = Date.UTC(y, mo - 1, d, h, mi)
  const day = 24 * 60 * 60 * 1000
  const before = offsetMs(naive - day, tz)
  const after = offsetMs(naive + day, tz)
  return [before, after].every(off => wallAsUtcMs(naive - off, tz) !== naive)
}

function addHourToLabel(label: string): string {
  const [h, m] = label.split(':').map(Number)
  return `${String((h + 1) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function localDateStr(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(iso))
}

// Expected label of a copied time: unchanged, unless the original wall time does not
// exist on the target date (DST gap), in which case it resolves exactly 1 hour later.
function expectedCopiedLabel(origLabel: string, newIso: string, tz: string): string {
  return isInDstGap(localDateStr(newIso, tz), origLabel, tz) ? addHourToLabel(origLabel) : origLabel
}

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
        fc.date({ min: new Date('2023-01-01'), max: new Date('2025-12-31'), noInvalidDate: true }),
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
            expect(newStartLabel).toBe(expectedCopiedLabel(origStartLabel, newShift.start_datetime, timezone))

            const origEndLabel = localTimeLabel(original.end_datetime, timezone)
            const newEndLabel = localTimeLabel(newShift.end_datetime, timezone)
            expect(newEndLabel).toBe(expectedCopiedLabel(origEndLabel, newShift.end_datetime, timezone))

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
