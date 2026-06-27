import { useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabaseClient'
import type { EmployeeProfile } from '../../types'

interface Props {
  employeeProfile: EmployeeProfile
  onSaved: () => void
  onCancel: () => void
}

function TimeOffRequestForm({ employeeProfile, onSaved, onCancel }: Props) {
  const today = new Date().toISOString().slice(0, 10)
  const [startDate, setStartDate] = useState(today)
  const [endDate, setEndDate] = useState(today)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)

    if (endDate < startDate) {
      setError('End date must be on or after start date.')
      return
    }

    setIsSubmitting(true)
    const { error: insertError } = await supabase.from('time_off_requests').insert({
      organization_id: employeeProfile.organization_id,
      employee_id: employeeProfile.id,
      start_date: startDate,
      end_date: endDate,
      reason: reason.trim() || null,
    })
    setIsSubmitting(false)

    if (insertError) {
      setError(insertError.message)
      return
    }

    onSaved()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-slate-700 bg-slate-900/60 p-5">
      <h3 className="text-sm font-semibold text-white">New Time Off Request</h3>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="text-xs font-semibold text-slate-300">Start date</span>
          <input
            type="date"
            value={startDate}
            min={today}
            onChange={(e) => {
              setStartDate(e.target.value)
              if (endDate < e.target.value) setEndDate(e.target.value)
            }}
            required
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-blue-500"
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs font-semibold text-slate-300">End date</span>
          <input
            type="date"
            value={endDate}
            min={startDate}
            onChange={(e) => setEndDate(e.target.value)}
            required
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-blue-500"
          />
        </label>
      </div>

      <label className="block space-y-1">
        <span className="text-xs font-semibold text-slate-300">Reason <span className="text-slate-500">(optional)</span></span>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder="Vacation, personal appointment, etc."
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

export default TimeOffRequestForm
