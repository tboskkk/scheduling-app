import type { ShiftRecord } from '../types'
import { localTimeLabel, toZonedISOString } from '../components/schedule/time'

export function copyShiftsToNextWeek(
  prevShifts: ShiftRecord[],
  prevWeekStart: Date,
  currentWeekStart: Date,
  timezone: string | null
): Omit<ShiftRecord, 'id'>[] {
  return prevShifts.map((shift) => {
    const startLabel = localTimeLabel(shift.start_datetime, timezone)
    const endLabel = localTimeLabel(shift.end_datetime, timezone)
    
    let dayIndex = 0
    const shiftDateStr = new Intl.DateTimeFormat('en-CA', { timeZone: timezone || undefined }).format(new Date(shift.start_datetime))
    
    for (let i = 0; i < 7; i++) {
      const d = new Date(prevWeekStart)
      d.setDate(d.getDate() + i)
      const dStr = new Intl.DateTimeFormat('en-CA', { timeZone: timezone || undefined }).format(d)
      if (dStr === shiftDateStr) {
        dayIndex = i
        break
      }
    }

    const targetDate = new Date(currentWeekStart)
    targetDate.setDate(targetDate.getDate() + dayIndex)

    const newStartIso = toZonedISOString(targetDate, startLabel, timezone)
    let newEndIso = toZonedISOString(targetDate, endLabel, timezone)

    const originalStartStr = new Intl.DateTimeFormat('en-CA', { timeZone: timezone || undefined }).format(new Date(shift.start_datetime))
    const originalEndStr = new Intl.DateTimeFormat('en-CA', { timeZone: timezone || undefined }).format(new Date(shift.end_datetime))
    
    if (originalStartStr !== originalEndStr) {
       const d1 = new Date(originalStartStr)
       const d2 = new Date(originalEndStr)
       const diffDays = Math.round((d2.getTime() - d1.getTime()) / (24 * 60 * 60 * 1000))
       
       const targetEndDate = new Date(targetDate)
       targetEndDate.setDate(targetEndDate.getDate() + diffDays)
       newEndIso = toZonedISOString(targetEndDate, endLabel, timezone)
    }

    let newBreakStartIso: string | null = null
    let newBreakEndIso: string | null = null

    if (shift.break_start_datetime && shift.break_end_datetime) {
      const breakStartLabel = localTimeLabel(shift.break_start_datetime, timezone)
      const breakEndLabel = localTimeLabel(shift.break_end_datetime, timezone)
      
      // Calculate offset days for break relative to shift start
      const shiftStart = new Date(shift.start_datetime)
      const breakStart = new Date(shift.break_start_datetime)
      const breakEnd = new Date(shift.break_end_datetime)
      
      const startDiffDays = Math.floor((breakStart.getTime() - shiftStart.getTime()) / (24 * 60 * 60 * 1000))
      const endDiffDays = Math.floor((breakEnd.getTime() - shiftStart.getTime()) / (24 * 60 * 60 * 1000))

      const targetBreakStartDate = new Date(targetDate)
      targetBreakStartDate.setDate(targetBreakStartDate.getDate() + startDiffDays)
      newBreakStartIso = toZonedISOString(targetBreakStartDate, breakStartLabel, timezone)

      const targetBreakEndDate = new Date(targetDate)
      targetBreakEndDate.setDate(targetBreakEndDate.getDate() + endDiffDays)
      newBreakEndIso = toZonedISOString(targetBreakEndDate, breakEndLabel, timezone)
    }

    return {
      location_id: shift.location_id,
      employee_id: shift.employee_id,
      role_id: shift.role_id,
      start_datetime: newStartIso,
      end_datetime: newEndIso,
      schedule_id: null,
      break_start_datetime: newBreakStartIso,
      break_end_datetime: newBreakEndIso
    }
  })
}

export function startOfWeekWithOffset(anchor: Date, weekStartDay: number): Date {
  const normalized = new Date(anchor)
  normalized.setHours(0, 0, 0, 0)
  const day = normalized.getDay()
  const diff = (day - weekStartDay + 7) % 7
  normalized.setDate(normalized.getDate() - diff)
  normalized.setHours(0, 0, 0, 0)
  return normalized
}
