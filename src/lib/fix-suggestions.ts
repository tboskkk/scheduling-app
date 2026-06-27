import type { ValidationError } from './rules-engine'

export type FixSuggestion = {
  employeeId: string
  employeeName: string
}

export type AddShiftParams = {
  startTime: string
  endTime?: string
  employeeId: string
  employeeName: string
  requirementId?: string
}

// Returns a map of errorId → employees who could fill that coverage gap.
// Only suggests for understaffing gaps (no shiftId), not break-caused ones.
export function computeFixSuggestions(
  errors: ValidationError[],
  employees: { id: string; name: string }[],
  shifts: { employee_id: string | null; start_datetime: string; end_datetime: string }[],
  availability: { employee_id: string; day_of_week: number }[]
): Map<string, FixSuggestion[]> {
  const result = new Map<string, FixSuggestion[]>()

  // Index available days per employee
  const availDays = new Map<string, Set<number>>()
  for (const a of availability) {
    if (!availDays.has(a.employee_id)) availDays.set(a.employee_id, new Set())
    availDays.get(a.employee_id)!.add(a.day_of_week)
  }

  for (const err of errors) {
    if (err.ruleType !== 'COVERAGE_GAP' || err.shiftId || !err.meta?.startTime) continue

    const gapStart = new Date(err.meta.startTime).getTime()
    const gapEnd = err.meta.endTime ? new Date(err.meta.endTime).getTime() : gapStart + 3600000
    const dayOfWeek = new Date(err.meta.startTime).getDay()

    const busyIds = new Set(
      shifts
        .filter(s => {
          const sStart = new Date(s.start_datetime).getTime()
          const sEnd = new Date(s.end_datetime).getTime()
          // Use >= on sEnd so employees whose shift ends exactly at gapStart
          // are treated as busy (just came off shift — not a useful suggestion).
          return sStart < gapEnd && sEnd >= gapStart
        })
        .map(s => s.employee_id)
        .filter((id): id is string => Boolean(id))
    )

    const suggestions: FixSuggestion[] = []
    for (const emp of employees) {
      if (busyIds.has(emp.id)) continue
      if (!availDays.get(emp.id)?.has(dayOfWeek)) continue
      suggestions.push({ employeeId: emp.id, employeeName: emp.name })
      if (suggestions.length >= 3) break
    }

    if (suggestions.length > 0) result.set(err.id, suggestions)
  }

  return result
}
