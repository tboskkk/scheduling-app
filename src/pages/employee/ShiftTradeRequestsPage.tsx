import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import type { EmployeeProfile, ShiftTradeRequest } from '../../types'
import ShiftTradeRequestForm from '../../components/employee/ShiftTradeRequestForm'

interface Props {
  employeeProfile: EmployeeProfile | null
}

type Tab = 'outgoing' | 'incoming'

const statusColors: Record<ShiftTradeRequest['status'], string> = {
  pending:  'border-amber-500/40 bg-amber-500/10 text-amber-300',
  accepted: 'border-blue-500/40 bg-blue-500/10 text-blue-300',
  declined: 'border-red-500/40 bg-red-500/10 text-red-300',
  approved: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  denied:   'border-red-500/40 bg-red-500/10 text-red-300',
}

const statusLabels: Record<ShiftTradeRequest['status'], string> = {
  pending:  'Awaiting response',
  accepted: 'Awaiting manager',
  declined: 'Declined',
  approved: 'Approved',
  denied:   'Denied',
}

type RequestWithNames = ShiftTradeRequest & {
  requesting_employee: { name: string } | null
  target_employee: { name: string } | null
  requesting_shift: { start_datetime: string; end_datetime: string } | null
  target_shift: { start_datetime: string; end_datetime: string } | null
}

function formatShiftTime(s: { start_datetime: string; end_datetime: string } | null) {
  if (!s) return 'Shift removed'
  const d = new Date(s.start_datetime).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
  const t = new Date(s.start_datetime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return `${d} · ${t}`
}

function ShiftTradeRequestsPage({ employeeProfile }: Props) {
  const empId = employeeProfile?.id ?? null
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<Tab>('outgoing')
  const [showForm, setShowForm] = useState(false)
  const [respondError, setRespondError] = useState<string | null>(null)
  const [cancelError, setCancelError] = useState<string | null>(null)
  const [cancelledIds, setCancelledIds] = useState<Set<string>>(new Set())

  const { data: allRequests = [], isLoading } = useQuery<RequestWithNames[]>({
    queryKey: ['employee-str', empId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('shift_trade_requests')
        .select(`
          *,
          requesting_shift:shifts!shift_trade_requests_requesting_shift_id_fkey(start_datetime, end_datetime),
          target_shift:shifts!shift_trade_requests_target_shift_id_fkey(start_datetime, end_datetime)
        `)
        .or(`requesting_employee_id.eq.${empId},target_employee_id.eq.${empId}`)
        .order('created_at', { ascending: false })
      if (error) throw new Error(error.message)
      const rows = (data ?? []) as Omit<RequestWithNames, 'requesting_employee' | 'target_employee'>[]
      if (rows.length === 0) return []

      // Colleague names come from the public view: employees can only read
      // their own row of the employees table.
      const ids = [...new Set(rows.flatMap(r => [r.requesting_employee_id, r.target_employee_id]))]
      const { data: people, error: peopleError } = await supabase
        .from('employee_public_profiles')
        .select('id, name')
        .in('id', ids)
      if (peopleError) throw new Error(peopleError.message)
      const nameById = new Map((people ?? []).map((p: { id: string; name: string }) => [p.id, p.name]))
      const person = (id: string) => (nameById.has(id) ? { name: nameById.get(id)! } : null)
      return rows.map(r => ({
        ...r,
        requesting_employee: person(r.requesting_employee_id),
        target_employee: person(r.target_employee_id),
      }))
    },
    enabled: Boolean(empId),
  })

  const outgoing = allRequests.filter(r => r.requesting_employee_id === empId)
  const incoming = allRequests.filter(r => r.target_employee_id === empId)
  const pendingIncoming = incoming.filter(r => r.status === 'pending').length

  const respondMutation = useMutation({
    mutationFn: async ({ id, response }: { id: string; response: 'accepted' | 'declined' }) => {
      const { error } = await supabase.rpc('respond_to_shift_trade', {
        p_request_id: id,
        p_response: response,
      })
      if (error) throw new Error(error.message)
    },
    onSuccess: () => {
      setRespondError(null)
      queryClient.invalidateQueries({ queryKey: ['employee-str', empId] })
      queryClient.invalidateQueries({ queryKey: ['employee-pending-in-str', empId] })
    },
    onError: (error) => {
      setRespondError(error instanceof Error ? error.message : 'Failed to respond to trade request.')
    },
  })

  const cancelMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('shift_trade_requests')
        .delete()
        .eq('id', id)
      if (error) throw new Error(error.message)
    },
    onSuccess: (_, id) => {
      setCancelError(null)
      setCancelledIds(prev => new Set([...prev, id]))
      queryClient.invalidateQueries({ queryKey: ['employee-str', empId] })
      queryClient.invalidateQueries({ queryKey: ['employee-pending-out-str', empId] })
    },
    onError: (error) => {
      setCancelError(error instanceof Error ? error.message : 'Failed to withdraw trade request.')
    },
  })

  const handleSaved = () => {
    setShowForm(false)
    queryClient.invalidateQueries({ queryKey: ['employee-str', empId] })
    queryClient.invalidateQueries({ queryKey: ['employee-pending-out-str', empId] })
  }

  const displayed = tab === 'outgoing' ? outgoing : incoming

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Requests</p>
          <h1 className="mt-1 text-2xl font-semibold text-white">Shift Trades</h1>
        </div>
        {!showForm && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-500"
          >
            + Propose trade
          </button>
        )}
      </div>

      {showForm && employeeProfile && (
        <ShiftTradeRequestForm
          employeeProfile={employeeProfile}
          onSaved={handleSaved}
          onCancel={() => setShowForm(false)}
        />
      )}

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg border border-slate-800 bg-slate-900/50 p-1 w-fit">
        <button
          type="button"
          onClick={() => setTab('outgoing')}
          className={`rounded-md px-4 py-1.5 text-sm font-semibold transition ${tab === 'outgoing' ? 'bg-blue-600 text-white' : 'text-slate-300 hover:text-white'}`}
        >
          My requests ({outgoing.length})
        </button>
        <button
          type="button"
          onClick={() => setTab('incoming')}
          className={`relative rounded-md px-4 py-1.5 text-sm font-semibold transition ${tab === 'incoming' ? 'bg-blue-600 text-white' : 'text-slate-300 hover:text-white'}`}
        >
          Incoming ({incoming.length})
          {pendingIncoming > 0 && (
            <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-[10px] font-bold text-white">
              {pendingIncoming}
            </span>
          )}
        </button>
      </div>

      {isLoading ? (
        <div className="py-16 text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent mx-auto" />
        </div>
      ) : displayed.length === 0 ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 px-5 py-12 text-center text-sm text-slate-400">
          {tab === 'outgoing' ? 'No outgoing trade requests yet.' : 'No incoming trade requests.'}
        </div>
      ) : (
        <div className="divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-900/50">
          {displayed.map((req) => (
            <div key={req.id} className="px-5 py-4 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  {tab === 'outgoing' ? (
                    <p className="text-sm font-semibold text-white">
                      To: {req.target_employee?.name ?? 'Unknown'}
                    </p>
                  ) : (
                    <p className="text-sm font-semibold text-white">
                      From: {req.requesting_employee?.name ?? 'Unknown'}
                    </p>
                  )}
                </div>
                <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusColors[req.status]}`}>
                  {statusLabels[req.status]}
                </span>
              </div>

              <div className="text-xs text-slate-400 space-y-0.5">
                <p>
                  <span className="text-slate-500">Their shift: </span>
                  {formatShiftTime(req.requesting_shift)}
                  <span className="text-slate-500 ml-1">
                    ({req.requesting_employee?.name ?? '—'})
                  </span>
                </p>
                {req.target_shift_id ? (
                  <p>
                    <span className="text-slate-500">In exchange for: </span>
                    {formatShiftTime(req.target_shift)}
                    <span className="text-slate-500 ml-1">
                      ({req.target_employee?.name ?? '—'})
                    </span>
                  </p>
                ) : (
                  <p className="text-slate-500">Give-away — no exchange shift</p>
                )}
              </div>

              {req.requester_note && (
                <p className="text-xs text-slate-300 italic">"{req.requester_note}"</p>
              )}
              {req.manager_note && (
                <p className="text-xs text-slate-300 italic">Manager: "{req.manager_note}"</p>
              )}

              {/* Incoming: pending — allow accept/decline */}
              {tab === 'incoming' && req.status === 'pending' && (
                <div className="space-y-1 pt-1">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => { setRespondError(null); respondMutation.mutate({ id: req.id, response: 'accepted' }) }}
                      disabled={respondMutation.isPending}
                      className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 transition disabled:opacity-50"
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      onClick={() => { setRespondError(null); respondMutation.mutate({ id: req.id, response: 'declined' }) }}
                      disabled={respondMutation.isPending}
                      className="rounded-lg border border-red-500/50 px-3 py-1.5 text-xs font-semibold text-red-300 hover:bg-red-500/10 transition disabled:opacity-50"
                    >
                      Decline
                    </button>
                  </div>
                  {respondError && (
                    <p className="text-[11px] text-red-400">{respondError}</p>
                  )}
                </div>
              )}

              {/* Outgoing: pending — allow withdrawal */}
              {tab === 'outgoing' && req.status === 'pending' && (
                <div className="space-y-1">
                  <button
                    type="button"
                    onClick={() => { setCancelError(null); cancelMutation.mutate(req.id) }}
                    disabled={cancelMutation.isPending || cancelledIds.has(req.id)}
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

export default ShiftTradeRequestsPage
