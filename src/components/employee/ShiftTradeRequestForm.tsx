import { useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import type { EmployeeProfile } from '../../types'

interface Props {
  employeeProfile: EmployeeProfile
  onSaved: () => void
  onCancel: () => void
}

function formatShift(s: { start_datetime: string; end_datetime: string; locations: { name: string } | null }) {
  const date = new Date(s.start_datetime).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
  const start = new Date(s.start_datetime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const end = new Date(s.end_datetime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const loc = s.locations?.name ?? ''
  return `${date} · ${start}–${end}${loc ? ` @ ${loc}` : ''}`
}

type ShiftRow = {
  id: string
  start_datetime: string
  end_datetime: string
  locations: { name: string } | null
}

type ColleagueRow = {
  id: string
  name: string
}

function ShiftTradeRequestForm({ employeeProfile, onSaved, onCancel }: Props) {
  const empId = employeeProfile.id
  const orgId = employeeProfile.organization_id

  const [myShiftId, setMyShiftId] = useState('')
  const [targetEmployeeId, setTargetEmployeeId] = useState('')
  const [theirShiftId, setTheirShiftId] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const now = new Date().toISOString()

  // Start of today (local midnight) — used for the target employee's shifts so
  // a colleague's shift that started earlier today still shows as tradeable.
  const todayStart = (() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d.toISOString()
  })()

  // My upcoming published shifts (must not have started yet)
  const { data: myShifts = [] } = useQuery<ShiftRow[]>({
    queryKey: ['employee-my-shifts-for-trade', empId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('shifts')
        .select('id, start_datetime, end_datetime, locations(name), schedules!inner(status)')
        .eq('employee_id', empId)
        .eq('schedules.status', 'published')
        .gte('start_datetime', now)
        .order('start_datetime', { ascending: true })
      if (error) throw new Error(error.message)
      return (data ?? []) as unknown as ShiftRow[]
    },
  })

  // Colleagues in same org (from public view — no sensitive data)
  const { data: colleagues = [] } = useQuery<ColleagueRow[]>({
    queryKey: ['employee-colleagues', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('employee_public_profiles')
        .select('id, name')
        .eq('organization_id', orgId)
        .eq('is_active', true)
        .neq('id', empId)
        .order('name', { ascending: true })
      if (error) throw new Error(error.message)
      return (data ?? []) as ColleagueRow[]
    },
  })

  // Target employee's shifts from today onward — use start-of-day so a colleague's
  // shift that began earlier today still appears as a swap option.
  const { data: theirShifts = [] } = useQuery<ShiftRow[]>({
    queryKey: ['colleague-shifts', targetEmployeeId, todayStart],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('shifts')
        .select('id, start_datetime, end_datetime, locations(name), schedules!inner(status)')
        .eq('employee_id', targetEmployeeId)
        .eq('schedules.status', 'published')
        .gte('start_datetime', todayStart)
        .order('start_datetime', { ascending: true })
      if (error) throw new Error(error.message)
      return (data ?? []) as unknown as ShiftRow[]
    },
    enabled: Boolean(targetEmployeeId),
  })

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!myShiftId) { setError('Select one of your shifts.'); return }
    if (!targetEmployeeId) { setError('Select a colleague.'); return }

    setIsSubmitting(true)
    const { error: insertError } = await supabase.from('shift_trade_requests').insert({
      organization_id: orgId,
      requesting_employee_id: empId,
      target_employee_id: targetEmployeeId,
      requesting_shift_id: myShiftId,
      target_shift_id: theirShiftId || null,
      requester_note: note.trim() || null,
    })
    setIsSubmitting(false)

    if (insertError) { setError(insertError.message); return }
    onSaved()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-slate-700 bg-slate-900/60 p-5">
      <h3 className="text-sm font-semibold text-white">Propose Shift Trade / Give-Away</h3>

      <label className="block space-y-1">
        <span className="text-xs font-semibold text-slate-300">My shift to trade / give away</span>
        <select
          value={myShiftId}
          onChange={(e) => setMyShiftId(e.target.value)}
          required
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-blue-500"
        >
          <option value="">Select a shift…</option>
          {myShifts.map(s => (
            <option key={s.id} value={s.id}>{formatShift(s)}</option>
          ))}
        </select>
        {myShifts.length === 0 && (
          <p className="text-xs text-slate-500">No upcoming published shifts found.</p>
        )}
      </label>

      <label className="block space-y-1">
        <span className="text-xs font-semibold text-slate-300">Colleague to request from</span>
        <select
          value={targetEmployeeId}
          onChange={(e) => { setTargetEmployeeId(e.target.value); setTheirShiftId('') }}
          required
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-blue-500"
        >
          <option value="">Select a colleague…</option>
          {colleagues.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </label>

      {targetEmployeeId && (
        <label className="block space-y-1">
          <span className="text-xs font-semibold text-slate-300">
            Their shift to swap with <span className="text-slate-500">(optional — leave blank for a give-away)</span>
          </span>
          <select
            value={theirShiftId}
            onChange={(e) => setTheirShiftId(e.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-blue-500"
          >
            <option value="">No swap — just give away my shift</option>
            {theirShifts.map(s => (
              <option key={s.id} value={s.id}>{formatShift(s)}</option>
            ))}
          </select>
        </label>
      )}

      <label className="block space-y-1">
        <span className="text-xs font-semibold text-slate-300">Note <span className="text-slate-500">(optional)</span></span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="Any context for your colleague…"
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-blue-500 resize-none"
        />
      </label>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row">
        <button
          type="button"
          onClick={onCancel}
          className="w-full rounded-lg border border-slate-700 px-4 py-2.5 text-sm font-semibold text-slate-200 transition hover:border-slate-500 sm:w-auto"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:opacity-60 sm:w-auto"
        >
          {isSubmitting ? 'Submitting…' : 'Submit request'}
        </button>
      </div>
    </form>
  )
}

export default ShiftTradeRequestForm
