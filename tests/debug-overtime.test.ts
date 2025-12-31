import { validateSchedule, getShiftDurationHours, checkDailyOvertime } from '../src/lib/rules-engine'
import type { ShiftRecord } from '../src/types'
import { ConflictSeverity } from '../src/lib/rules-engine'

describe('Daily Overtime Bug Investigation', () => {
  it('should NOT show overtime for 9h shift with 1h break (net 8h)', () => {
    // Recreate the exact scenario from the images
    const shift: ShiftRecord = {
      id: '269f3e7b-0c0a-458e-96f0-2cd47d608d2e',
      location_id: 'test-location',
      employee_id: 'test-employee',
      role_id: 'cashier-role',
      start_datetime: '2024-01-01T18:15:00Z', // 12:15 PM Regina (UTC-6)
      end_datetime: '2024-01-02T03:15:00Z',   // 9:15 PM Regina
      break_start_datetime: '2024-01-01T22:00:00Z', // 4:00 PM Regina
      break_end_datetime: '2024-01-01T23:00:00Z'    // 5:00 PM Regina
    }

    const config = { maxDailyHours: 8 }
    const errors = validateSchedule([shift], [], [], [], config)
    const overtimeErrors = errors.filter(e => e.ruleType === 'DAILY_OVERTIME')

    console.log('Shift duration calculation:')
    console.log('Start:', shift.start_datetime)
    console.log('End:', shift.end_datetime)
    console.log('Break start:', shift.break_start_datetime)
    console.log('Break end:', shift.break_end_datetime)
    
    // Calculate manually to verify
    const start = new Date(shift.start_datetime).getTime()
    const end = new Date(shift.end_datetime).getTime()
    const rawDuration = (end - start) / (1000 * 60 * 60)
    
    const bStart = new Date(shift.break_start_datetime!).getTime()
    const bEnd = new Date(shift.break_end_datetime!).getTime()
    const breakHours = (bEnd - bStart) / (1000 * 60 * 60)
    
    const netHours = rawDuration - breakHours
    
    console.log(`Raw duration: ${rawDuration}h`)
    console.log(`Break duration: ${breakHours}h`)
    console.log(`Net duration: ${netHours}h`)
    console.log(`Date key: ${shift.start_datetime.split('T')[0]}`)
    console.log(`Overtime errors found: ${overtimeErrors.length}`)
    
    if (overtimeErrors.length > 0) {
      console.log('Error message:', overtimeErrors[0].message)
    }

    // This should pass (no overtime errors) but will likely fail due to the bug
    expect(overtimeErrors.length).toBe(0)
  })

  it('should debug the exact calculation step by step', () => {
    const shift: ShiftRecord = {
      id: '269f3e7b-0c0a-458e-96f0-2cd47d608d2e',
      location_id: '1e800a84-53c5-45c1-a0df-d089ed090f3d',
      employee_id: 'c81b0ce9-0f41-498d-812b-c2883b55a6b0',
      role_id: '6072643f-2d4b-4de7-af26-b514e6bca45b',
      start_datetime: '2025-12-28T18:15:00.000Z',
      end_datetime: '2025-12-29T03:15:00.000Z',
      break_start_datetime: '2025-12-28T22:00:00.000Z',
      break_end_datetime: '2025-12-28T23:00:00.000Z'
    }

    // Import the functions directly to test them
    console.log('=== STEP BY STEP DEBUG ===')
    
    // Test getShiftDurationHours directly
    const duration = getShiftDurationHours(shift)
    console.log(`getShiftDurationHours result: ${duration}h`)
    
    // Test checkDailyOvertime directly
    const config = { maxDailyHours: 8 }
    const errors = checkDailyOvertime([shift], config)
    console.log(`checkDailyOvertime errors: ${errors.length}`)
    if (errors.length > 0) {
      console.log('Error messages:', errors.map((e: any) => e.message))
    }
    
    // Test full validateSchedule
    const fullConfig = { maxDailyHours: 8 }
    const allErrors = validateSchedule([shift], [], [], [], fullConfig)
    const overtimeErrors = allErrors.filter(e => e.ruleType === 'DAILY_OVERTIME')
    
    console.log(`Full validation overtime errors: ${overtimeErrors.length}`)
    if (overtimeErrors.length > 0) {
      console.log('Full validation error messages:', overtimeErrors.map(e => e.message))
    }
    
    // This test is just for debugging - we expect it to pass
    expect(true).toBe(true)
  })
})