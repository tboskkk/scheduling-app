import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabaseClient'
import type { GridEmployee, ShiftRecord } from '../../types'
import type { RoleInfo } from './ShiftCard'
import { toZonedISOString, localTimeLabel } from './time'

const PRESETS = [
  { label: 'Morning', start: '08:00', end: '12:00' },
  { label: 'Day', start: '09:00', end: '17:00' },
  { label: 'Evening', start: '12:00', end: '20:00' },
  { label: 'Night', start: '22:00', end: '06:00' },
]

type EditShiftDialogProps = {
  isOpen: boolean
  onClose: () => void
  shift: ShiftRecord | null
  timezone: string | null
  employees: GridEmployee[]
  roles: RoleInfo[]
  onUpdated: (shift: ShiftRecord) => void
  onDeleted: (shiftId: string) => void
}

function EditShiftDialog({ isOpen, onClose, shift, timezone, employees, roles, onUpdated, onDeleted }: EditShiftDialogProps) {
  const [roleId, setRoleId] = useState('')
  const [employeeId, setEmployeeId] = useState<string | null>(null)
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('17:00')
  const [breakStartTime, setBreakStartTime] = useState<string>('')
  const [breakEndTime, setBreakEndTime] = useState<string>('')
  const [hasBreak, setHasBreak] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  useEffect(() => {
    if (!isOpen || !shift) return
    setError(null)
    setRoleId(shift.role_id ?? '')
    setEmployeeId(shift.employee_id)
    setStartTime(localTimeLabel(shift.start_datetime, timezone))
    setEndTime(localTimeLabel(shift.end_datetime, timezone))
    
    if (shift.break_start_datetime && shift.break_end_datetime) {
      setHasBreak(true)
      setBreakStartTime(localTimeLabel(shift.break_start_datetime, timezone))
      setBreakEndTime(localTimeLabel(shift.break_end_datetime, timezone))
    } else {
      setHasBreak(false)
      setBreakStartTime('')
      setBreakEndTime('')
    }
  }, [isOpen, shift, timezone])

  const dayLabel = useMemo(() => {
    if (!shift) return ''
    const date = new Date(shift.start_datetime)
    return date.toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
      timeZone: timezone || undefined,
    })
  }, [shift, timezone])

  if (!isOpen || !shift) return null

  const isQuarterHour = (value: string) => {
    const [, minute] = value.split(':').map(Number)
    return minute % 15 === 0
  }

  const handlePreset = (start: string, end: string) => {
    setStartTime(start)
    setEndTime(end)
    // Reset break when preset is clicked, or maybe recalculate?
    // For now, let's just reset it if it's enabled, or maybe leave it?
    // The user asked for auto-populated suggestion.
    // Let's trigger the auto-population logic if hasBreak is true.
    if (hasBreak) {
      suggestBreak(start, end)
    }
  }

  const suggestBreak = (s: string, e: string) => {
    // Simple logic: 30 mins halfway
    const [sh, sm] = s.split(':').map(Number)
    const [eh, em] = e.split(':').map(Number)
    
    let startMins = sh * 60 + sm
    let endMins = eh * 60 + em
    
    if (endMins <= startMins) endMins += 24 * 60 // Handle overnight for calculation
    
    const mid = Math.floor((startMins + endMins) / 2)
    const breakStartMins = mid - 15
    const breakEndMins = mid + 15
    
    const formatMins = (m: number) => {
      let h = Math.floor(m / 60) % 24
      let min = m % 60
      return `${h.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`
    }
    
    setBreakStartTime(formatMins(breakStartMins))
    setBreakEndTime(formatMins(breakEndMins))
  }

  // Watch for time changes to update break if it's enabled and looks like a default
  // Actually, maybe just a button or only on initial enable?
  // "auto populated suggestion time" implies when I enable it, it should suggest.
  // Or if I change the shift times, it should update? That might be annoying if I set a custom break.
  // Let's just do it when enabling.

  const handleToggleBreak = (enabled: boolean) => {
    setHasBreak(enabled)
    if (enabled && (!breakStartTime || !breakEndTime)) {
      suggestBreak(startTime, endTime)
    }
  }

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this shift?')) return
    try {
      setIsDeleting(true)
      const { error: deleteError } = await supabase
        .from('shifts')
        .delete()
        .eq('id', shift.id)

      if (deleteError) throw new Error(deleteError.message)
      if (shift.id) onDeleted(shift.id)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete shift')
    } finally {
      setIsDeleting(false)
    }
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    if (!startTime || !endTime) {
      setError('Pick start and end times.')
      return
    }
    if (!isQuarterHour(startTime) || !isQuarterHour(endTime)) {
      setError('Times must align to 15-minute increments.')
      return
    }

    try {
      setIsSaving(true)
      const date = new Date(shift.start_datetime)
      const startIso = toZonedISOString(date, startTime, timezone)
      let endIso = toZonedISOString(date, endTime, timezone)
      
      // Handle overnight shifts
      if (new Date(endIso) <= new Date(startIso)) {
        const nextDay = new Date(date)
        nextDay.setDate(nextDay.getDate() + 1)
        endIso = toZonedISOString(nextDay, endTime, timezone)
      }

      let breakStartIso: string | null = null
      let breakEndIso: string | null = null

      if (hasBreak) {
        if (!breakStartTime || !breakEndTime) {
          setError('Pick break start and end times.')
          return
        }
        
        // We need to figure out the date for the break.
        // It could be same day as start, or next day if shift is overnight.
        // Simple heuristic: if break time < shift start time, it's probably next day (for overnight shifts).
        // But wait, what if shift is 23:00 - 07:00 and break is 03:00?
        // 03:00 < 23:00, so yes next day.
        // What if shift is 08:00 - 16:00 and break is 12:00?
        // 12:00 > 08:00, so same day.
        
        // Let's use the shift start date as base.
        breakStartIso = toZonedISOString(date, breakStartTime, timezone)
        breakEndIso = toZonedISOString(date, breakEndTime, timezone)
        
        // If break start is before shift start, assume it's next day (overnight)
        // UNLESS the shift itself didn't cross midnight yet?
        // Actually, we should compare with the full ISOs.
        
        if (new Date(breakStartIso) < new Date(startIso)) {
           const nextDay = new Date(date)
           nextDay.setDate(nextDay.getDate() + 1)
           breakStartIso = toZonedISOString(nextDay, breakStartTime, timezone)
        }
        
          if (new Date(breakEndIso) <= new Date(breakStartIso)) {
            // Break crosses midnight or ends next day; handled by bumping end below
          }

          // Robust approach:
        // 1. Construct candidate break start on Day 1.
        // 2. If candidate < startIso, try Day 2.
        // 3. Check if inside shift.
        
        let bStart = new Date(toZonedISOString(date, breakStartTime, timezone))
        if (bStart < new Date(startIso)) {
           bStart.setDate(bStart.getDate() + 1)
        }
        breakStartIso = bStart.toISOString()
        
        let bEnd = new Date(toZonedISOString(date, breakEndTime, timezone))
        // If end time is smaller than start time, it must be next day relative to the break start's base date?
        // No, just ensure bEnd > bStart
        if (bEnd <= bStart) {
           bEnd.setDate(bEnd.getDate() + 1)
        }
        // If bEnd is still way before bStart (like > 24h?), something is wrong, but let's assume standard inputs.
        // Actually, if bEnd < bStart, we added a day.
        // But what if break is 23:00 - 01:00?
        // bStart (Day 1 23:00). bEnd (Day 1 01:00) -> add day -> Day 2 01:00. Correct.
        
        breakEndIso = bEnd.toISOString()
        
        // Validate break is within shift
        if (bStart < new Date(startIso) || bEnd > new Date(endIso)) {
           setError('Break must be within shift hours.')
           setIsSaving(false)
           return
        }
      }

      const { data, error: updateError } = await supabase
        .from('shifts')
        .update({
          employee_id: employeeId,
          role_id: roleId || null,
          start_datetime: startIso,
          end_datetime: endIso,
          break_start_datetime: breakStartIso,
          break_end_datetime: breakEndIso,
        })
        .eq('id', shift.id)
        .select('id, location_id, employee_id, role_id, start_datetime, end_datetime, break_start_datetime, break_end_datetime')
        .single()

      if (updateError || !data) throw new Error(updateError?.message || 'Unable to update shift')
      onUpdated(data as ShiftRecord)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update shift')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-8">
      <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-950 p-5 shadow-2xl shadow-black/50">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Edit Shift</p>
            <h3 className="text-lg font-semibold text-white">{dayLabel}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-700 px-2 py-1 text-[12px] font-semibold text-slate-200 transition hover:border-slate-500"
          >
            Close
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-3 text-sm text-slate-100">
          <label className="space-y-1 block">
            <span className="text-xs uppercase tracking-[0.12em] text-slate-500">Employee</span>
            <select
              value={employeeId ?? ''}
              onChange={(e) => setEmployeeId(e.target.value || null)}
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none ring-2 ring-transparent transition focus:border-blue-500 focus:ring-blue-500"
            >
              <option value="">Unassigned</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.name}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1 block">
            <span className="text-xs uppercase tracking-[0.12em] text-slate-500">Role</span>
            <select
              value={roleId}
              onChange={(e) => setRoleId(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none ring-2 ring-transparent transition focus:border-blue-500 focus:ring-blue-500"
            >
              <option value="">No role</option>
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="text-xs uppercase tracking-[0.12em] text-slate-500">Start</span>
              <input
                type="time"
                step="900"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none ring-2 ring-transparent transition focus:border-blue-500 focus:ring-blue-500"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs uppercase tracking-[0.12em] text-slate-500">End</span>
              <input
                type="time"
                step="900"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none ring-2 ring-transparent transition focus:border-blue-500 focus:ring-blue-500"
              />
            </label>
          </div>

          <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-900/50 p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-[0.12em] text-slate-500">Unpaid Break</span>
              <label className="relative inline-flex cursor-pointer items-center">
                <input type="checkbox" checked={hasBreak} onChange={(e) => handleToggleBreak(e.target.checked)} className="peer sr-only" />
                <div className="peer h-5 w-9 rounded-full bg-slate-700 after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:bg-blue-600 peer-checked:after:translate-x-full peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-500/50"></div>
              </label>
            </div>
            
            {hasBreak && (
              <div className="grid grid-cols-2 gap-3 pt-1">
                <label className="space-y-1">
                  <span className="text-[10px] uppercase tracking-wider text-slate-500">Start</span>
                  <input
                    type="time"
                    value={breakStartTime}
                    onChange={(e) => setBreakStartTime(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none ring-2 ring-transparent transition focus:border-blue-500 focus:ring-blue-500"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] uppercase tracking-wider text-slate-500">End</span>
                  <input
                    type="time"
                    value={breakEndTime}
                    onChange={(e) => setBreakEndTime(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none ring-2 ring-transparent transition focus:border-blue-500 focus:ring-blue-500"
                  />
                </label>
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2 text-xs">
            {PRESETS.map((preset) => (
              <button
                type="button"
                key={preset.label}
                onClick={() => handlePreset(preset.start, preset.end)}
                className="rounded-full border border-slate-700 px-3 py-1 font-semibold text-slate-100 transition hover:border-blue-400 hover:text-white"
              >
                {preset.label}: {preset.start} – {preset.end}
              </button>
            ))}
          </div>

          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[13px] text-red-200">
              {error}
            </div>
          )}

          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              onClick={handleDelete}
              disabled={isDeleting || isSaving}
              className="rounded-lg border border-red-900/50 px-4 py-2 text-xs font-semibold text-red-400 transition hover:bg-red-900/20 hover:text-red-300 disabled:opacity-50"
            >
              {isDeleting ? 'Deleting…' : 'Delete shift'}
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-100 transition hover:border-slate-500"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSaving || isDeleting}
                className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-blue-500 disabled:opacity-70"
              >
                {isSaving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}

export default EditShiftDialog
