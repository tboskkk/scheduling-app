import { describe, it, expect } from 'vitest'
import { validateSchedule, ConflictSeverity } from '../src/lib/rules-engine'
import { ShiftRecord, EmployeeUnavailability, CoverageRequirement } from '../src/types'

describe('Validation Summary Completeness', () => {
  it('should report all types of conflicts in the summary', () => {
    // Setup: Create a scenario with one of each error type
    
    // 1. Double Booking (Hard Block)
    // Employee 1 has two overlapping shifts
    const s1: ShiftRecord = {
      id: 's1', location_id: 'l1', employee_id: 'e1', role_id: 'r1',
      start_datetime: '2024-01-01T09:00:00Z', end_datetime: '2024-01-01T12:00:00Z'
    }
    const s2: ShiftRecord = {
      id: 's2', location_id: 'l1', employee_id: 'e1', role_id: 'r1',
      start_datetime: '2024-01-01T11:00:00Z', end_datetime: '2024-01-01T14:00:00Z'
    }

    // 2. Unavailability (Hard Block)
    // Employee 2 is scheduled during time off
    const s3: ShiftRecord = {
      id: 's3', location_id: 'l1', employee_id: 'e2', role_id: 'r1',
      start_datetime: '2024-01-02T09:00:00Z', end_datetime: '2024-01-02T17:00:00Z'
    }
    const unavail: EmployeeUnavailability = {
      id: 'u1', organization_id: 'o1', employee_id: 'e2',
      start_datetime: '2024-01-02T00:00:00Z', end_datetime: '2024-01-02T23:59:59Z'
    }

    // 3. Daily Overtime (Soft Warning)
    // Employee 3 works 10 hours (limit 8)
    const s4: ShiftRecord = {
      id: 's4', location_id: 'l1', employee_id: 'e3', role_id: 'r1',
      start_datetime: '2024-01-03T08:00:00Z', end_datetime: '2024-01-03T18:00:00Z'
    }

    // 4. Weekly Overtime (Soft Warning)
    // Employee 4 works 50 hours (limit 40)
    // 5 shifts of 10 hours each
    const shiftsE4: ShiftRecord[] = []
    for(let i=0; i<5; i++) {
        shiftsE4.push({
            id: `s5-${i}`, location_id: 'l1', employee_id: 'e4', role_id: 'r1',
            start_datetime: `2024-01-0${i+1}T08:00:00Z`, 
            end_datetime: `2024-01-0${i+1}T18:00:00Z`
        })
    }

    // 5. Rest Period (Soft Warning)
    // Employee 5 has only 4 hours between shifts (limit 8)
    const s6: ShiftRecord = {
      id: 's6', location_id: 'l1', employee_id: 'e5', role_id: 'r1',
      start_datetime: '2024-01-04T08:00:00Z', end_datetime: '2024-01-04T16:00:00Z'
    }
    const s7: ShiftRecord = {
      id: 's7', location_id: 'l1', employee_id: 'e5', role_id: 'r1',
      start_datetime: '2024-01-04T20:00:00Z', end_datetime: '2024-01-05T04:00:00Z'
    }

    // 6. Coverage Gap (Soft Warning)
    // Requirement: 2 people on Role 2 on Monday 9-5
    // We have 0 people
    const covReq: CoverageRequirement = {
        id: 'c1', location_id: 'l1', role_id: 'r2', day_of_week: 1, // Monday (Jan 1 2024 is Monday)
        start_time: '09:00:00', end_time: '17:00:00', min_employees: 2
    }

    const allShifts = [s1, s2, s3, s4, ...shiftsE4, s6, s7]
    
    const errors = validateSchedule(
        allShifts, 
        [], // employees
        [], // availability
        [unavail], 
        [covReq],
        { 
            weekStart: new Date('2024-01-01T00:00:00Z'),
            maxDailyHours: 8,
            maxWeeklyHours: 40,
            minRestPeriodHours: 8
        }
    )

    // Verify Hard Blocks
    const hardBlocks = errors.filter(e => e.severity === ConflictSeverity.HARD_BLOCK)
    const doubleBooking = hardBlocks.filter(e => e.ruleType === 'DOUBLE_BOOKING')
    const unavailability = hardBlocks.filter(e => e.ruleType === 'UNAVAILABILITY')
    
    expect(doubleBooking.length).toBeGreaterThan(0) // s1 and s2 conflict
    expect(unavailability.length).toBeGreaterThan(0) // s3 conflicts

    // Verify Soft Warnings
    const softWarnings = errors.filter(e => e.severity === ConflictSeverity.SOFT_WARNING)
    const dailyOvertime = softWarnings.filter(e => e.ruleType === 'DAILY_OVERTIME')
    const weeklyOvertime = softWarnings.filter(e => e.ruleType === 'WEEKLY_OVERTIME')
    const restPeriod = softWarnings.filter(e => e.ruleType === 'REST_PERIOD')
    const coverageGap = softWarnings.filter(e => e.ruleType === 'COVERAGE_GAP')

    expect(dailyOvertime.length).toBeGreaterThan(0) // s4 is 10h
    expect(weeklyOvertime.length).toBeGreaterThan(0) // e4 has 50h
    expect(restPeriod.length).toBeGreaterThan(0) // s6-s7 gap is 4h
    expect(coverageGap.length).toBeGreaterThan(0) // Missing coverage for r2

    // Total check
    expect(errors.length).toBe(
        doubleBooking.length + 
        unavailability.length + 
        dailyOvertime.length + 
        weeklyOvertime.length + 
        restPeriod.length + 
        coverageGap.length
    )
  })
})
