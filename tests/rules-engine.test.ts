import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { validateSchedule, ConflictSeverity } from '../src/lib/rules-engine'
import { ShiftRecord, GridEmployee, EmployeeAvailability, EmployeeUnavailability } from '../src/types'

// Generators
const minTime = new Date(Date.UTC(2024, 0, 1)).getTime()
const maxTime = new Date(Date.UTC(2025, 0, 1)).getTime()
const dateArb = fc.integer({ min: minTime, max: maxTime }).map(t => new Date(t))

const shiftArb = fc.record({
  id: fc.uuid(),
  location_id: fc.uuid(),
  employee_id: fc.uuid(),
  role_id: fc.uuid(),
  start_datetime: dateArb.map(d => d.toISOString()),
  durationMinutes: fc.integer({ min: 60, max: 480 }) // 1 to 8 hours
}).map(s => {
  const start = new Date(s.start_datetime)
  const end = new Date(start.getTime() + s.durationMinutes * 60000)
  return {
    ...s,
    end_datetime: end.toISOString()
  } as ShiftRecord
})

describe('Rules Engine', () => {
  
  describe('Double Booking', () => {
    it('should detect overlapping shifts for the same employee', () => {
      fc.assert(
        fc.property(shiftArb, shiftArb, (s1, s2) => {
          // Force same employee
          const shift1 = { ...s1, employee_id: 'emp-1' }
          const shift2 = { ...s2, employee_id: 'emp-1', id: 'shift-2' } // Ensure different IDs
          shift1.id = 'shift-1'

          // Check overlap manually
          const start1 = new Date(shift1.start_datetime).getTime()
          const end1 = new Date(shift1.end_datetime).getTime()
          const start2 = new Date(shift2.start_datetime).getTime()
          const end2 = new Date(shift2.end_datetime).getTime()
          
          const overlaps = start1 < end2 && start2 < end1
          
          const errors = validateSchedule([shift1, shift2], [])
          const doubleBookingErrors = errors.filter(e => e.ruleType === 'DOUBLE_BOOKING')
          
          if (overlaps) {
            expect(doubleBookingErrors.length).toBeGreaterThan(0)
            expect(doubleBookingErrors[0].severity).toBe(ConflictSeverity.HARD_BLOCK)
          } else {
            expect(doubleBookingErrors.length).toBe(0)
          }
        })
      )
    })
  })

  describe('Unavailability', () => {
     it('should detect conflict with unavailability', () => {
         fc.assert(
             fc.property(shiftArb, (shift) => {
                 const s = { ...shift, employee_id: 'emp-1' }
                 
                 // Create unavailability that overlaps
                 const unavail: EmployeeUnavailability = {
                     id: 'un-1',
                     organization_id: 'org-1',
                     employee_id: 'emp-1',
                     start_datetime: s.start_datetime,
                     end_datetime: s.end_datetime
                 }
                 
                 const errors = validateSchedule([s], [], [], [unavail])
                 const unavailErrors = errors.filter(e => e.ruleType === 'UNAVAILABILITY')
                 
                 expect(unavailErrors.length).toBeGreaterThan(0)
                 expect(unavailErrors[0].severity).toBe(ConflictSeverity.HARD_BLOCK)
             })
         )
     })
  })
  
  describe('Recurring Availability', () => {
      it('should allow shift within availability', () => {
          // Fixed date: Monday Jan 1 2024 10:00 UTC
          const start = new Date('2024-01-01T10:00:00Z')
          const end = new Date('2024-01-01T14:00:00Z') // 4 hours
          
          const shift: ShiftRecord = {
              id: 's1',
              location_id: 'l1',
              employee_id: 'e1',
              role_id: 'r1',
              start_datetime: start.toISOString(),
              end_datetime: end.toISOString()
          }
          
          // Availability for Monday (1) 09:00 - 17:00 UTC
          const avail: EmployeeAvailability = {
              id: 'a1',
              organization_id: 'o1',
              employee_id: 'e1',
              day_of_week: 1, // Monday
              start_time: '09:00:00',
              end_time: '17:00:00'
          }
          
          const errors = validateSchedule([shift], [], [avail], [])
          const availErrors = errors.filter(e => e.ruleType === 'AVAILABILITY')
          expect(availErrors.length).toBe(0)
      })

      it('should block shift outside availability', () => {
          // Fixed date: Monday Jan 1 2024 08:00 UTC (starts before 9)
          const start = new Date('2024-01-01T08:00:00Z')
          const end = new Date('2024-01-01T12:00:00Z') 
          
          const shift: ShiftRecord = {
              id: 's1',
              location_id: 'l1',
              employee_id: 'e1',
              role_id: 'r1',
              start_datetime: start.toISOString(),
              end_datetime: end.toISOString()
          }
          
          // Availability for Monday (1) 09:00 - 17:00 UTC
          const avail: EmployeeAvailability = {
              id: 'a1',
              organization_id: 'o1',
              employee_id: 'e1',
              day_of_week: 1, // Monday
              start_time: '09:00:00',
              end_time: '17:00:00'
          }
          
          const errors = validateSchedule([shift], [], [avail], [])
          const availErrors = errors.filter(e => e.ruleType === 'AVAILABILITY')
          expect(availErrors.length).toBeGreaterThan(0)
      })
  })

  describe('Timezone Normalization', () => {
      it('should detect overlap across timezones', () => {
          // 10:00 UTC
          const start1 = '2024-01-01T10:00:00Z'
          const end1 = '2024-01-01T12:00:00Z'
          
          // 11:00 UTC expressed in EST (UTC-5) -> 06:00 EST
          // 2024-01-01T06:00:00-05:00 is 11:00 UTC
          const start2 = '2024-01-01T06:00:00-05:00'
          const end2 = '2024-01-01T08:00:00-05:00' // 13:00 UTC
          
          const s1: ShiftRecord = {
              id: 's1', location_id: 'l1', employee_id: 'e1', role_id: 'r1',
              start_datetime: start1, end_datetime: end1
          }
          
          const s2: ShiftRecord = {
              id: 's2', location_id: 'l1', employee_id: 'e1', role_id: 'r1',
              start_datetime: start2, end_datetime: end2
          }
          
          const errors = validateSchedule([s1, s2], [])
          const dbErrors = errors.filter(e => e.ruleType === 'DOUBLE_BOOKING')
          expect(dbErrors.length).toBeGreaterThan(0)
      })
  })

  describe('Weekly Overtime', () => {
    it('should detect weekly overtime', () => {
      // Create shifts that sum to > 40 hours in a week
      const start = new Date('2024-01-01T09:00:00Z') // Monday
      const shifts: ShiftRecord[] = []
      
      // 5 days * 9 hours = 45 hours
      for (let i = 0; i < 5; i++) {
        const s = new Date(start)
        s.setUTCDate(s.getUTCDate() + i)
        const e = new Date(s)
        e.setUTCHours(e.getUTCHours() + 9)
        
        shifts.push({
          id: `s${i}`,
          location_id: 'l1',
          employee_id: 'e1',
          role_id: 'r1',
          start_datetime: s.toISOString(),
          end_datetime: e.toISOString()
        })
      }
      
      const errors = validateSchedule(shifts, [], [], [], { maxWeeklyHours: 40 })
      const otErrors = errors.filter(e => e.ruleType === 'WEEKLY_OVERTIME')
      
      expect(otErrors.length).toBeGreaterThan(0)
      expect(otErrors[0].severity).toBe(ConflictSeverity.SOFT_WARNING)
    })
  })

  describe('Daily Overtime', () => {
    it('should detect daily overtime', () => {
      const start = new Date('2024-01-01T09:00:00Z')
      const end = new Date('2024-01-01T18:00:00Z') // 9 hours
      
      const shift: ShiftRecord = {
        id: 's1',
        location_id: 'l1',
        employee_id: 'e1',
        role_id: 'r1',
        start_datetime: start.toISOString(),
        end_datetime: end.toISOString()
      }
      
      const errors = validateSchedule([shift], [], [], [], { maxDailyHours: 8 })
      const otErrors = errors.filter(e => e.ruleType === 'DAILY_OVERTIME')
      
      expect(otErrors.length).toBeGreaterThan(0)
      expect(otErrors[0].severity).toBe(ConflictSeverity.SOFT_WARNING)
    })
  })

  describe('Rest Period', () => {
    it('should detect short rest period', () => {
      const start1 = new Date('2024-01-01T09:00:00Z')
      const end1 = new Date('2024-01-01T17:00:00Z')
      
      // Next shift starts 6 hours later (23:00)
      const start2 = new Date('2024-01-01T23:00:00Z')
      const end2 = new Date('2024-01-02T07:00:00Z')
      
      const s1: ShiftRecord = {
        id: 's1', location_id: 'l1', employee_id: 'e1', role_id: 'r1',
        start_datetime: start1.toISOString(), end_datetime: end1.toISOString()
      }
      
      const s2: ShiftRecord = {
        id: 's2', location_id: 'l1', employee_id: 'e1', role_id: 'r1',
        start_datetime: start2.toISOString(), end_datetime: end2.toISOString()
      }
      
      const errors = validateSchedule([s1, s2], [], [], [], { minRestPeriodHours: 8 })
      const rpErrors = errors.filter(e => e.ruleType === 'REST_PERIOD')
      
      expect(rpErrors.length).toBeGreaterThan(0)
      expect(rpErrors[0].severity).toBe(ConflictSeverity.SOFT_WARNING)
    })
  })
})
