import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { useOrganizationStore } from '../../lib/useOrganizationStore'
import type { GridEmployee, ShiftRecord } from '../../types'
import type { RoleInfo } from './ShiftCard'
import { toZonedISOString } from './time'


type QuickAddShiftDialogProps = {
  isOpen: boolean
  onClose: () => void
  date: Date | null
  timezone: string | null
  employee: GridEmployee | null
  locationId: string
  organizationId: string
  roles: RoleInfo[]
  onCreated: (shift: ShiftRecord) => void
}

function QuickAddShiftDialog({ isOpen, onClose, date, timezone, employee, locationId, organizationId, roles, onCreated }: QuickAddShiftDialogProps) {
  const { organization, fetchOrganization } = useOrganizationStore()
  const [roleId, setRoleId] = useState('')
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('17:00')
  const [breakStartTime, setBreakStartTime] = useState<string>('')
  const [breakEndTime, setBreakEndTime] = useState<string>('')
  const [hasBreak, setHasBreak] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const quickShifts = organization?.settings?.quick_shifts || []
  const timeFormat = organization?.settings?.time_format || '12h'

  // Helper function to format time strings (HH:MM) for display
  const formatTimeForDisplay = (timeString: string) => {
    const [h, m] = timeString.split(':').map(Number)
    if (timeFormat === '24h') {
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
    }
    const hour12 = h % 12 || 12
    const ampm = h < 12 ? 'AM' : 'PM'
    return `${hour12}:${String(m).padStart(2, '0')} ${ampm}`
  }

  useEffect(() => {
    if (isOpen && !organization) {
      fetchOrganization()
    }
  }, [isOpen, organization, fetchOrganization])

  useEffect(() => {
    if (!isOpen) return
    setError(null)
    setRoleId(roles[0]?.id ?? '')
    setHasBreak(false)
    setBreakStartTime('')
    setBreakEndTime('')
  }, [isOpen, roles])

  const dayLabel = useMemo(() => {
    if (!date) return ''
    return date.toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
      timeZone: timezone || undefined,
    })
  }, [date, timezone])

  if (!isOpen || !date) return null

  const isQuarterHour = (value: string) => {
    const [, minute] = value.split(':').map(Number)
    return minute % 15 === 0
  }

  const handlePreset = (start: string, end: string) => {
    setStartTime(start)
    setEndTime(end)
    if (hasBreak) {
      suggestBreak(start, end)
    }
  }

  const suggestBreak = (s: string, e: string) => {
    const [sh, sm] = s.split(':').map(Number)
    const [eh, em] = e.split(':').map(Number)
    
    const startMins = sh * 60 + sm
    let endMins = eh * 60 + em
    
    if (endMins <= startMins) endMins += 24 * 60
    
    const mid = Math.floor((startMins + endMins) / 2)
    const breakStartMins = mid - 15
    const breakEndMins = mid + 15
    
    const formatMins = (m: number) => {
      const h = Math.floor(m / 60) % 24
      const min = m % 60
      return `${h.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`
    }
    
    setBreakStartTime(formatMins(breakStartMins))
    setBreakEndTime(formatMins(breakEndMins))
  }

  const handleToggleBreak = (enabled: boolean) => {
    setHasBreak(enabled)
    if (enabled && (!breakStartTime || !breakEndTime)) {
      suggestBreak(startTime, endTime)
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
      const startIso = toZonedISOString(date, startTime, timezone)
      let endIso = toZonedISOString(date, endTime, timezone)
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
        
        const bStart = new Date(toZonedISOString(date, breakStartTime, timezone))
        if (bStart < new Date(startIso)) {
           bStart.setDate(bStart.getDate() + 1)
        }
        breakStartIso = bStart.toISOString()
        
        const bEnd = new Date(toZonedISOString(date, breakEndTime, timezone))
        if (bEnd <= bStart) {
           bEnd.setDate(bEnd.getDate() + 1)
        }
        breakEndIso = bEnd.toISOString()
        
        if (bStart < new Date(startIso) || bEnd > new Date(endIso)) {
           setError('Break must be within shift hours.')
           setIsSaving(false)
           return
        }
      }

      const { data, error: insertError } = await supabase
        .from('shifts')
        .insert({
          organization_id: organizationId,
          location_id: locationId,
          employee_id: employee?.id ?? null,
          role_id: roleId || null,
          start_datetime: startIso,
          end_datetime: endIso,
          break_start_datetime: breakStartIso,
          break_end_datetime: breakEndIso,
        })
        .select('id, location_id, employee_id, role_id, start_datetime, end_datetime, break_start_datetime, break_end_datetime')
        .single()

      if (insertError || !data) throw new Error(insertError?.message || 'Unable to create shift')
      onCreated(data as ShiftRecord)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create shift')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-4 sm:py-8">
      <div className="w-full max-w-md overflow-y-auto max-h-[90dvh] rounded-2xl border border-slate-700 bg-slate-950 p-5 shadow-2xl shadow-black/50">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Quick add</p>
            <h3 className="text-lg font-semibold text-white">{dayLabel}</h3>
            <p className="text-sm text-slate-300">{employee ? `Assign to ${employee.name}` : 'Leave unassigned for now.'}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-slate-500"
          >
            Close
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-3 text-sm text-slate-100">
          <label className="space-y-1 block">
            <span className="text-xs uppercase tracking-[0.12em] text-slate-500">Role</span>
            <select
              value={roleId}
              onChange={(e) => setRoleId(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-hidden ring-2 ring-transparent transition focus:border-blue-500 focus:ring-blue-500"
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
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-hidden ring-2 ring-transparent transition focus:border-blue-500 focus:ring-blue-500"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs uppercase tracking-[0.12em] text-slate-500">End</span>
              <input
                type="time"
                step="900"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-hidden ring-2 ring-transparent transition focus:border-blue-500 focus:ring-blue-500"
              />
            </label>
          </div>

          <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-900/50 p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-[0.12em] text-slate-500">Unpaid Break</span>
              <label className="relative inline-flex cursor-pointer items-center">
                <input type="checkbox" checked={hasBreak} onChange={(e) => handleToggleBreak(e.target.checked)} className="peer sr-only" />
                <div className="peer h-5 w-9 rounded-full bg-slate-700 after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:bg-blue-600 peer-checked:after:translate-x-full peer-focus:outline-hidden peer-focus:ring-2 peer-focus:ring-blue-500/50"></div>
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
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-hidden ring-2 ring-transparent transition focus:border-blue-500 focus:ring-blue-500"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] uppercase tracking-wider text-slate-500">End</span>
                  <input
                    type="time"
                    value={breakEndTime}
                    onChange={(e) => setBreakEndTime(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-hidden ring-2 ring-transparent transition focus:border-blue-500 focus:ring-blue-500"
                  />
                </label>
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2 text-xs">
            {quickShifts.map((preset) => (
              <button
                type="button"
                key={preset.id}
                onClick={() => handlePreset(preset.start, preset.end)}
                className="rounded-full border border-slate-700 px-3 py-1 font-semibold text-slate-100 transition hover:border-blue-400 hover:text-white"
              >
                {preset.label}: {formatTimeForDisplay(preset.start)} – {formatTimeForDisplay(preset.end)}
              </button>
            ))}
          </div>

          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[13px] text-red-200">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-100 transition hover:border-slate-500"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-blue-500 disabled:opacity-70"
            >
              {isSaving ? 'Saving…' : 'Add shift'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default QuickAddShiftDialog
