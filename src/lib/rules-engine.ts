import type { ShiftRecord, GridEmployee, EmployeeAvailability, EmployeeUnavailability, CoverageRequirement } from '../types'
import { toZonedISOString } from '../components/schedule/time'

export const ConflictSeverity = {
  HARD_BLOCK: 'HARD_BLOCK',
  SOFT_WARNING: 'SOFT_WARNING',
} as const

export type ConflictSeverity = (typeof ConflictSeverity)[keyof typeof ConflictSeverity]

export interface ValidationError {
  id: string
  shiftId?: string // Optional for global/coverage errors
  severity: ConflictSeverity
  message: string
  ruleType: string
  meta?: any // For extra info like coverage details
}

export interface ValidationConfig {
  maxWeeklyHours: number
  maxDailyHours: number
  minRestPeriodHours: number
  weekStartDay: number // 0 = Sunday
  timezone?: string
  weekStart?: Date // The start of the week being validated
  enableCaliforniaRules?: boolean
}

const DEFAULT_CONFIG: ValidationConfig = {
  maxWeeklyHours: 40,
  maxDailyHours: 8,
  minRestPeriodHours: 8,
  weekStartDay: 0,
  timezone: 'UTC',
  enableCaliforniaRules: false
}

export function canPublish(errors: ValidationError[]): boolean {
  return !errors.some(e => e.severity === ConflictSeverity.HARD_BLOCK)
}

export function validateSchedule(
  shifts: ShiftRecord[],
  employees: GridEmployee[],
  availability: EmployeeAvailability[] = [],
  unavailability: EmployeeUnavailability[] = [],
  coverageRequirementsOrConfig: CoverageRequirement[] | Partial<ValidationConfig> = [],
  config: Partial<ValidationConfig> = {},
): ValidationError[] {
  const coverageRequirements = Array.isArray(coverageRequirementsOrConfig)
    ? coverageRequirementsOrConfig
    : []

  const mergedConfig = Array.isArray(coverageRequirementsOrConfig)
    ? { ...DEFAULT_CONFIG, ...config }
    : { ...DEFAULT_CONFIG, ...coverageRequirementsOrConfig }

  if (mergedConfig.enableCaliforniaRules) {
    mergedConfig.maxDailyHours = 8
    mergedConfig.maxWeeklyHours = 40
  }

  const errors: ValidationError[] = []

  // 1. Double Booking
  errors.push(...checkDoubleBooking(shifts))

  // 2. Cross-location soft warning for non-floating employees
  errors.push(...checkCrossLocation(shifts, employees))

  // 3. Unavailability
  errors.push(...checkUnavailability(shifts, availability, unavailability))

  // 4. Weekly Overtime
  errors.push(...checkWeeklyOvertime(shifts, mergedConfig))

  // 5. Daily Overtime
  errors.push(...checkDailyOvertime(shifts, mergedConfig))

  // 6. Rest Period
  errors.push(...checkRestPeriod(shifts, mergedConfig))

  // 7. Coverage Requirements
  if (mergedConfig.weekStart) {
    errors.push(...checkCoverage(shifts, coverageRequirements, mergedConfig.weekStart, mergedConfig.timezone))
  }

  return errors
}

function checkCrossLocation(shifts: ShiftRecord[], employees: GridEmployee[]): ValidationError[] {
  const errors: ValidationError[] = []
  const employeeLookup = new Map<string, GridEmployee>()
  employees.forEach((emp) => employeeLookup.set(emp.id, emp))

  for (const shift of shifts) {
    if (!shift.employee_id) continue
    const employee = employeeLookup.get(shift.employee_id)
    if (!employee) continue

    const isCrossLocation =
      !employee.is_floating &&
      Boolean(employee.home_location_id) &&
      employee.home_location_id !== shift.location_id

    if (isCrossLocation) {
      errors.push({
        id: `cl-${shift.id}`,
        shiftId: shift.id,
        severity: ConflictSeverity.SOFT_WARNING,
        message: 'Assigned outside home location (not floating)',
        ruleType: 'CROSS_LOCATION',
      })
    }
  }

  return errors
}

function checkDoubleBooking(shifts: ShiftRecord[]): ValidationError[] {
  const errors: ValidationError[] = []
  const shiftsByEmployee = new Map<string, ShiftRecord[]>()

  for (const shift of shifts) {
    if (!shift.employee_id) continue
    const employeeShifts = shiftsByEmployee.get(shift.employee_id) || []
    employeeShifts.push(shift)
    shiftsByEmployee.set(shift.employee_id, employeeShifts)
  }

  for (const [, employeeShifts] of shiftsByEmployee) {
    for (let i = 0; i < employeeShifts.length; i++) {
      for (let j = i + 1; j < employeeShifts.length; j++) {
        const s1 = employeeShifts[i]
        const s2 = employeeShifts[j]

        if (areIntervalsOverlapping(s1.start_datetime, s1.end_datetime, s2.start_datetime, s2.end_datetime)) {
           errors.push({
             id: `db-${s1.id}-${s2.id}`,
             shiftId: s1.id,
             severity: ConflictSeverity.HARD_BLOCK,
             message: 'Double booked with another shift',
             ruleType: 'DOUBLE_BOOKING'
           })
           errors.push({
             id: `db-${s2.id}-${s1.id}`,
             shiftId: s2.id,
             severity: ConflictSeverity.HARD_BLOCK,
             message: 'Double booked with another shift',
             ruleType: 'DOUBLE_BOOKING'
           })
        }
      }
    }
  }
  
  return errors
}

function checkUnavailability(
  shifts: ShiftRecord[],
  availability: EmployeeAvailability[],
  unavailability: EmployeeUnavailability[]
): ValidationError[] {
  const errors: ValidationError[] = []

  for (const shift of shifts) {
    if (!shift.employee_id) continue

    // Check specific unavailability (Time Off)
    const employeeUnavailability = unavailability.filter(u => u.employee_id === shift.employee_id)
    for (const u of employeeUnavailability) {
      if (areIntervalsOverlapping(shift.start_datetime, shift.end_datetime, u.start_datetime, u.end_datetime)) {
        errors.push({
          id: `un-${shift.id}-${u.id}`,
          shiftId: shift.id,
          severity: ConflictSeverity.HARD_BLOCK,
          message: 'Shift conflicts with time off',
          ruleType: 'UNAVAILABILITY'
        })
      }
    }

    // Check recurring availability
    const employeeAvailability = availability.filter(a => a.employee_id === shift.employee_id)
    if (employeeAvailability.length > 0) {
        if (!isShiftCoveredByAvailability(shift, employeeAvailability)) {
             errors.push({
              id: `av-${shift.id}`,
              shiftId: shift.id,
              severity: ConflictSeverity.HARD_BLOCK,
              message: 'Shift is outside of employee availability',
              ruleType: 'AVAILABILITY'
            })
        }
    }
  }

  return errors
}

function areIntervalsOverlapping(start1: string, end1: string, start2: string, end2: string): boolean {
  const s1 = new Date(start1).getTime()
  const e1 = new Date(end1).getTime()
  const s2 = new Date(start2).getTime()
  const e2 = new Date(end2).getTime()
  
  return s1 < e2 && s2 < e1
}

function isShiftCoveredByAvailability(shift: ShiftRecord, availability: EmployeeAvailability[]): boolean {
    const shiftStart = new Date(shift.start_datetime)
    const shiftEnd = new Date(shift.end_datetime)
    
    const segments = splitShiftIntoDailySegments(shiftStart, shiftEnd)
    
    for (const segment of segments) {
        const dayOfWeek = segment.start.getUTCDay() // 0-6 UTC
        const dayAvailability = availability.filter(a => a.day_of_week === dayOfWeek)
        
        if (dayAvailability.length === 0) return false 
        
        const isCovered = dayAvailability.some(a => {
            const availStart = parseTimeUTC(a.start_time, segment.start)
            const availEnd = parseTimeUTC(a.end_time, segment.start)
            
            return segment.start.getTime() >= availStart.getTime() && segment.end.getTime() <= availEnd.getTime()
        })
        
        if (!isCovered) return false
    }
    
    return true
}

function splitShiftIntoDailySegments(start: Date, end: Date): { start: Date, end: Date }[] {
    const segments: { start: Date, end: Date }[] = []
    let current = new Date(start)
    
    while (current < end) {
        const nextMidnight = new Date(current)
        nextMidnight.setUTCHours(24, 0, 0, 0) // UTC Midnight
        
        const segmentEnd = nextMidnight < end ? nextMidnight : end
        segments.push({ start: new Date(current), end: new Date(segmentEnd) })
        current = segmentEnd
    }
    
    return segments
}

function parseTimeUTC(timeStr: string, date: Date): Date {
    const [hours, minutes, seconds] = timeStr.split(':').map(Number)
    const result = new Date(date)
    result.setUTCHours(hours, minutes, seconds || 0, 0)
    return result
}

function checkWeeklyOvertime(shifts: ShiftRecord[], config: ValidationConfig): ValidationError[] {
  const errors: ValidationError[] = []
  const shiftsByEmployee = groupShiftsByEmployee(shifts)

  for (const [, employeeShifts] of shiftsByEmployee) {
    // Group by week
    const hoursByWeek = new Map<string, number>()
    const shiftsByWeek = new Map<string, ShiftRecord[]>()

    for (const shift of employeeShifts) {
      const weekStart = getWeekStart(new Date(shift.start_datetime), config.weekStartDay)
      const weekKey = weekStart.toISOString()
      
      const duration = getShiftDurationHours(shift)
      hoursByWeek.set(weekKey, (hoursByWeek.get(weekKey) || 0) + duration)
      
      const weekShifts = shiftsByWeek.get(weekKey) || []
      weekShifts.push(shift)
      shiftsByWeek.set(weekKey, weekShifts)
    }

    for (const [weekKey, hours] of hoursByWeek) {
      if (hours > config.maxWeeklyHours) {
        const weekShifts = shiftsByWeek.get(weekKey) || []
        for (const shift of weekShifts) {
          errors.push({
            id: `wo-${shift.id}`,
            shiftId: shift.id,
            severity: ConflictSeverity.SOFT_WARNING,
            message: `Weekly overtime: ${hours.toFixed(1)}h > ${config.maxWeeklyHours}h`,
            ruleType: 'WEEKLY_OVERTIME'
          })
        }
      }
    }
  }

  return errors
}

export function checkDailyOvertime(shifts: ShiftRecord[], config: ValidationConfig): ValidationError[] {
  const errors: ValidationError[] = []
  const shiftsByEmployee = groupShiftsByEmployee(shifts)

  for (const [, employeeShifts] of shiftsByEmployee) {
    const hoursByDay = new Map<string, number>()
    const shiftsByDay = new Map<string, ShiftRecord[]>()

    for (const shift of employeeShifts) {
      const dateKey = shift.start_datetime.split('T')[0]
      const duration = getShiftDurationHours(shift)
      hoursByDay.set(dateKey, (hoursByDay.get(dateKey) || 0) + duration)

      const dayShifts = shiftsByDay.get(dateKey) || []
      dayShifts.push(shift)
      shiftsByDay.set(dateKey, dayShifts)
    }

    for (const [dateKey, hours] of hoursByDay) {
      if (hours > config.maxDailyHours) {
        const dayShifts = shiftsByDay.get(dateKey) || []
        for (const shift of dayShifts) {
          errors.push({
            id: `do-${shift.id}`,
            shiftId: shift.id,
            severity: ConflictSeverity.SOFT_WARNING,
            message: `Daily overtime: ${hours.toFixed(1)}h > ${config.maxDailyHours}h`,
            ruleType: 'DAILY_OVERTIME',
          })
        }
      }
    }
  }

  return errors
}

function checkRestPeriod(shifts: ShiftRecord[], config: ValidationConfig): ValidationError[] {
  const errors: ValidationError[] = []
  const shiftsByEmployee = groupShiftsByEmployee(shifts)

  for (const [, employeeShifts] of shiftsByEmployee) {
    const sortedShifts = [...employeeShifts].sort(
      (a, b) => new Date(a.start_datetime).getTime() - new Date(b.start_datetime).getTime(),
    )

    for (let i = 0; i < sortedShifts.length - 1; i++) {
      const currentShift = sortedShifts[i]
      const nextShift = sortedShifts[i + 1]

      const endCurrent = new Date(currentShift.end_datetime).getTime()
      const startNext = new Date(nextShift.start_datetime).getTime()

      const gapHours = (startNext - endCurrent) / (1000 * 60 * 60)

      if (gapHours < config.minRestPeriodHours && gapHours >= 0) {
        errors.push({
          id: `rp-${nextShift.id}`,
          shiftId: nextShift.id,
          severity: ConflictSeverity.SOFT_WARNING,
          message: `Rest period too short: ${gapHours.toFixed(1)}h < ${config.minRestPeriodHours}h`,
          ruleType: 'REST_PERIOD',
        })
      }
    }
  }

  return errors
}

function checkCoverage(
  shifts: ShiftRecord[], 
  requirements: CoverageRequirement[], 
  weekStart: Date,
  timezone: string = 'UTC'
): ValidationError[] {
  const errors: ValidationError[] = []
  
  // For each requirement, check if it's met
  for (const req of requirements) {
    // Calculate the specific date for this requirement in the current week
    const targetDate = new Date(weekStart)
    targetDate.setUTCDate(targetDate.getUTCDate() + req.day_of_week)
    
    const reqStartIso = toZonedISOString(targetDate, req.start_time, timezone)
    const reqEndIso = toZonedISOString(targetDate, req.end_time, timezone)
    
    const reqStart = new Date(reqStartIso)
    const reqEnd = new Date(reqEndIso)
    
    // Find shifts that overlap with this requirement and have the correct role
    // Note: We include unassigned shifts (employee_id is null) if they have the role assigned?
    // Requirement 15.3 says "Include unassigned shifts".
    // Usually unassigned shifts have a role_id.
    
    const relevantShifts = shifts.filter(s => {
      if (s.location_id !== req.location_id) return false
      if (s.role_id !== req.role_id) return false
      
      // Check overlap
      return areIntervalsOverlapping(
        s.start_datetime, 
        s.end_datetime, 
        reqStart.toISOString(), 
        reqEnd.toISOString()
      )
    })
    
    // We need to check if at any point in the requirement window, the count drops below min_employees
    // We can do this by checking "points of interest" (start/end times of shifts)
    
    const points = new Set<number>()
    points.add(reqStart.getTime())
    points.add(reqEnd.getTime())
    
    for (const s of relevantShifts) {
      const sStart = new Date(s.start_datetime).getTime()
      const sEnd = new Date(s.end_datetime).getTime()
      
      if (sStart > reqStart.getTime() && sStart < reqEnd.getTime()) points.add(sStart)
      if (sEnd > reqStart.getTime() && sEnd < reqEnd.getTime()) points.add(sEnd)

      // Add break points as well, because coverage changes during breaks
      if (s.break_start_datetime && s.break_end_datetime) {
        const bStart = new Date(s.break_start_datetime).getTime()
        const bEnd = new Date(s.break_end_datetime).getTime()
        if (bStart > reqStart.getTime() && bStart < reqEnd.getTime()) points.add(bStart)
        if (bEnd > reqStart.getTime() && bEnd < reqEnd.getTime()) points.add(bEnd)
      }
    }
    
    const sortedPoints = Array.from(points).sort((a, b) => a - b)
    
    for (let i = 0; i < sortedPoints.length - 1; i++) {
      const p1 = sortedPoints[i]
      const p2 = sortedPoints[i+1]
      const midPoint = (p1 + p2) / 2
      
      // Count shifts active at midPoint
      const count = relevantShifts.filter(s => {
        const sStart = new Date(s.start_datetime).getTime()
        const sEnd = new Date(s.end_datetime).getTime()
        
        // Basic check: is the shift active?
        const isActive = sStart <= midPoint && sEnd >= midPoint
        if (!isActive) return false

        // Break check: is the employee on break?
        if (s.break_start_datetime && s.break_end_datetime) {
          const bStart = new Date(s.break_start_datetime).getTime()
          const bEnd = new Date(s.break_end_datetime).getTime()
          if (midPoint >= bStart && midPoint < bEnd) return false
        }

        return true
      }).length
      
      if (count < req.min_employees) {
        errors.push({
          id: `cov-${req.id}-${p1}`,
          severity: ConflictSeverity.SOFT_WARNING,
          message: `Coverage missing: ${count}/${req.min_employees} for role`,
          ruleType: 'COVERAGE_GAP',
          meta: {
            requirementId: req.id,
            startTime: new Date(p1).toISOString(),
            endTime: new Date(p2).toISOString(),
            missingCount: req.min_employees - count
          }
        })

        // Find shifts that are on break during this gap
        const shiftsOnBreak = relevantShifts.filter(s => {
            if (!s.break_start_datetime || !s.break_end_datetime) return false
            const bStart = new Date(s.break_start_datetime).getTime()
            const bEnd = new Date(s.break_end_datetime).getTime()
            // Check if break overlaps with the gap interval [p1, p2]
            // Gap is [p1, p2]. Break is [bStart, bEnd].
            // Overlap if bStart < p2 && bEnd > p1
            return bStart < p2 && bEnd > p1
        })

        for (const s of shiftsOnBreak) {
             errors.push({
                id: `cov-break-${req.id}-${p1}-${s.id}`,
                shiftId: s.id,
                severity: ConflictSeverity.SOFT_WARNING,
                message: `Break causes coverage gap (${count}/${req.min_employees})`,
                ruleType: 'COVERAGE_GAP',
                meta: {
                    requirementId: req.id,
                    startTime: new Date(p1).toISOString(),
                    endTime: new Date(p2).toISOString(),
                    missingCount: req.min_employees - count
                }
             })
        }
      }
    }
  }
  
  return errors
}

function groupShiftsByEmployee(shifts: ShiftRecord[]): Map<string, ShiftRecord[]> {
  const map = new Map<string, ShiftRecord[]>()
  for (const shift of shifts) {
    if (!shift.employee_id) continue
    const list = map.get(shift.employee_id) || []
    list.push(shift)
    map.set(shift.employee_id, list)
  }
  return map
}

function getWeekStart(date: Date, weekStartDay: number): Date {
  const d = new Date(date)
  d.setUTCHours(0, 0, 0, 0)
  const day = d.getUTCDay()
  const diff = d.getUTCDate() - day + (day < weekStartDay ? -7 : 0) + weekStartDay
  d.setUTCDate(diff)
  return d
}

export function getShiftDurationHours(shift: ShiftRecord): number {
  const start = new Date(shift.start_datetime).getTime()
  const end = new Date(shift.end_datetime).getTime()
  const rawDuration = (end - start) / (1000 * 60 * 60)
  
  let breakHours = 0
  if (shift.break_start_datetime && shift.break_end_datetime) {
    const bStart = new Date(shift.break_start_datetime).getTime()
    const bEnd = new Date(shift.break_end_datetime).getTime()
    breakHours = Math.max(0, (bEnd - bStart) / (1000 * 60 * 60))
  }
  
  return Math.max(0, rawDuration - breakHours)
}
