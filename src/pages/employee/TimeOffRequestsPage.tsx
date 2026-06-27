import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import type { EmployeeProfile, TimeOffRequest } from '../../types'
import TimeOffRequestForm from '../../components/employee/TimeOffRequestForm'

interface Props {
  employeeProfile: EmployeeProfile | null
}

const statusColors: Record<TimeOffRequest['status'], string> = {
  pending: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  approved: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  denied: 'border-red-500/40 bg-red-500/10 text-red-300',
}

const statusLabels: Record<TimeOffRequest['status'], string> = {
  pending: 'Pending',
  approved: 'Approved',
  denied: 'Denied',
}

function formatDateRange(start: string, end: string) {
  const s = new Date(start + 'T00:00:00').toLocaleDateString([], { month: 'short', day: 'numeric' })
  const e = new Date(end + 'T00:00:00').toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
  return start === end ? e : `${s} – ${e}`
}

function TimeOffRequestsPage({ employeeProfile }: Props) {
  const empId = employeeProfile?.id ?? null
  const queryClient = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)

  const { data: requests = [], isLoading } = useQuery<TimeOffRequest[]>({
    queryKey: ['employee-tor', empId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('time_off_requests')
        .select('*')
        .eq('employee_id', empId!)
        .order('created_at', { ascending: false })
      if (error) throw new Error(error.message)
      return (data ?? []) as TimeOffRequest[]
    },
    enabled: Boolean(empId),
  })

  const cancelRequest = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('time_off_requests')
        .delete()
        .eq('id', id)
      if (error) throw new Error(error.message)
    },
    onSuccess: () => {
      setCancelError(null)
      queryClient.invalidateQueries({ queryKey: ['employee-tor', empId] })
      queryClient.invalidateQueries({ queryKey: ['employee-pending-tor', empId] })
    },
    onError: (error) => {
      setCancelError(error instanceof Error ? error.message : 'Failed to withdraw request. It may have already been reviewed.')
    },
  })

  const handleSaved = () => {
    setShowForm(false)
    queryClient.invalidateQueries({ queryKey: ['employee-tor', empId] })
    queryClient.invalidateQueries({ queryKey: ['employee-pending-tor', empId] })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Requests</p>
          <h1 className="mt-1 text-2xl font-semibold text-white">Time Off</h1>
        </div>
        {!showForm && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-500"
          >
            + New request
          </button>
        )}
      </div>

      {showForm && employeeProfile && (
        <TimeOffRequestForm
          employeeProfile={employeeProfile}
          onSaved={handleSaved}
          onCancel={() => setShowForm(false)}
        />
      )}

      {isLoading ? (
        <div className="py-16 text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent mx-auto" />
        </div>
      ) : requests.length === 0 ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 px-5 py-12 text-center text-sm text-slate-400">
          No time off requests yet.
        </div>
      ) : (
        <div className="divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-900/50">
          {requests.map((req) => (
            <div key={req.id} className="px-5 py-4 space-y-1.5">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-white">
                  {formatDateRange(req.start_date, req.end_date)}
                </p>
                <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusColors[req.status]}`}>
                  {statusLabels[req.status]}
                </span>
              </div>

              {req.reason && (
                <p className="text-xs text-slate-400">{req.reason}</p>
              )}

              {req.manager_note && (
                <p className="text-xs text-slate-300 italic">Manager: "{req.manager_note}"</p>
              )}

              {req.status === 'pending' && (
                <div className="space-y-1">
                  <button
                    type="button"
                    onClick={() => { setCancelError(null); cancelRequest.mutate(req.id) }}
                    disabled={cancelRequest.isPending}
                    className="text-xs font-semibold text-red-400 hover:text-red-300 transition disabled:opacity-50"
                  >
                    Withdraw request
                  </button>
                  {cancelError && (
                    <p className="text-[11px] text-red-400">{cancelError}</p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default TimeOffRequestsPage
