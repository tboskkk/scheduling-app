import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient'
import type { ManagerProfile, TimeOffRequest, ShiftTradeRequest } from '../types'

interface Props {
  managerProfile: ManagerProfile | null
}

type TorTab = 'pending' | 'history'
type StrTab = 'pending' | 'history'
type MainTab = 'time-off' | 'shift-trades'

type TorWithEmployee = TimeOffRequest & {
  employee: { name: string } | null
}

type StrWithDetails = ShiftTradeRequest & {
  requesting_employee: { name: string } | null
  target_employee: { name: string } | null
  requesting_shift: { start_datetime: string; end_datetime: string } | null
  target_shift: { start_datetime: string; end_datetime: string } | null
}

function formatDateRange(start: string, end: string) {
  const s = new Date(start + 'T00:00:00').toLocaleDateString([], { month: 'short', day: 'numeric' })
  const e = new Date(end + 'T00:00:00').toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
  return start === end ? e : `${s} – ${e}`
}

function formatShiftTime(s: { start_datetime: string; end_datetime: string } | null) {
  if (!s) return 'Shift removed'
  const d = new Date(s.start_datetime).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
  const t = new Date(s.start_datetime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const te = new Date(s.end_datetime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return `${d} · ${t}–${te}`
}

const TOR_STATUS_COLORS: Record<TimeOffRequest['status'], string> = {
  pending:  'border-amber-500/40 bg-amber-500/10 text-amber-300',
  approved: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  denied:   'border-red-500/40 bg-red-500/10 text-red-300',
}

const STR_STATUS_COLORS: Record<ShiftTradeRequest['status'], string> = {
  pending:  'border-amber-500/40 bg-amber-500/10 text-amber-300',
  accepted: 'border-blue-500/40 bg-blue-500/10 text-blue-300',
  declined: 'border-red-500/40 bg-red-500/10 text-red-300',
  approved: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  denied:   'border-red-500/40 bg-red-500/10 text-red-300',
}

function RequestsPage({ managerProfile }: Props) {
  const orgId = managerProfile?.organization_id ?? null
  const queryClient = useQueryClient()
  const [mainTab, setMainTab] = useState<MainTab>('time-off')
  const [torTab, setTorTab] = useState<TorTab>('pending')
  const [strTab, setStrTab] = useState<StrTab>('pending')
  const [noteInput, setNoteInput] = useState<Record<string, string>>({})

  // ─── Time Off Requests ───────────────────────────────────────────────────
  const { data: torRequests = [], isLoading: torLoading } = useQuery<TorWithEmployee[]>({
    queryKey: ['manager-tor', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('time_off_requests')
        .select('*, employee:employees(name)')
        .eq('organization_id', orgId!)
        .order('created_at', { ascending: false })
      if (error) throw new Error(error.message)
      return (data ?? []) as TorWithEmployee[]
    },
    enabled: Boolean(orgId),
  })

  const pendingTor = torRequests.filter(r => r.status === 'pending')
  const historyTor = torRequests.filter(r => r.status !== 'pending')
  const displayedTor = torTab === 'pending' ? pendingTor : historyTor

  const torMutation = useMutation({
    mutationFn: async ({ id, decision }: { id: string; decision: 'approved' | 'denied' }) => {
      const { error } = await supabase.rpc('approve_reject_time_off', {
        p_request_id: id,
        p_decision: decision,
        p_note: noteInput[id] ?? null,
      })
      if (error) throw new Error(error.message)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manager-tor', orgId] })
      queryClient.invalidateQueries({ queryKey: ['manager-pending-counts', orgId] })
    },
  })

  // ─── Shift Trade Requests ────────────────────────────────────────────────
  const { data: strRequests = [], isLoading: strLoading } = useQuery<StrWithDetails[]>({
    queryKey: ['manager-str', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('shift_trade_requests')
        .select(`
          *,
          requesting_employee:employees!shift_trade_requests_requesting_employee_id_fkey(name),
          target_employee:employees!shift_trade_requests_target_employee_id_fkey(name),
          requesting_shift:shifts!shift_trade_requests_requesting_shift_id_fkey(start_datetime, end_datetime),
          target_shift:shifts!shift_trade_requests_target_shift_id_fkey(start_datetime, end_datetime)
        `)
        .eq('organization_id', orgId!)
        .order('created_at', { ascending: false })
      if (error) throw new Error(error.message)
      return (data ?? []) as StrWithDetails[]
    },
    enabled: Boolean(orgId),
  })

  // Manager sees accepted (awaiting approval) as "pending"
  const pendingStr = strRequests.filter(r => r.status === 'accepted')
  const historyStr = strRequests.filter(r => r.status !== 'accepted')
  const displayedStr = strTab === 'pending' ? pendingStr : historyStr

  const strMutation = useMutation({
    mutationFn: async ({ id, decision }: { id: string; decision: 'approved' | 'denied' }) => {
      const { error } = await supabase.rpc('approve_reject_shift_trade', {
        p_request_id: id,
        p_decision: decision,
        p_note: noteInput[id] ?? null,
      })
      if (error) throw new Error(error.message)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manager-str', orgId] })
      queryClient.invalidateQueries({ queryKey: ['manager-pending-counts', orgId] })
    },
  })

  if (!orgId) {
    return (
      <div className="p-6 text-slate-400 text-sm">
        Set up your organization to manage requests.
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-4xl mx-auto">
      <div>
        <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Manager</p>
        <h1 className="mt-1 text-2xl font-semibold text-white">Employee Requests</h1>
      </div>

      {/* Main tabs */}
      <div className="flex gap-1 rounded-lg border border-slate-800 bg-slate-900/50 p-1 w-fit">
        <button
          type="button"
          onClick={() => setMainTab('time-off')}
          className={`rounded-md px-4 py-2 text-sm font-semibold transition ${mainTab === 'time-off' ? 'bg-blue-600 text-white' : 'text-slate-300 hover:text-white'}`}
        >
          Time Off {pendingTor.length > 0 && <span className="ml-1.5 rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] text-white">{pendingTor.length}</span>}
        </button>
        <button
          type="button"
          onClick={() => setMainTab('shift-trades')}
          className={`rounded-md px-4 py-2 text-sm font-semibold transition ${mainTab === 'shift-trades' ? 'bg-blue-600 text-white' : 'text-slate-300 hover:text-white'}`}
        >
          Shift Trades {pendingStr.length > 0 && <span className="ml-1.5 rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] text-white">{pendingStr.length}</span>}
        </button>
      </div>

      {/* ─── Time Off ─────────────────────────────────────────────────────── */}
      {mainTab === 'time-off' && (
        <div className="space-y-4">
          <div className="flex gap-1 w-fit">
            {(['pending', 'history'] as const).map(t => (
              <button
                key={t}
                type="button"
                onClick={() => setTorTab(t)}
                className={`rounded-md px-3 py-2 text-xs font-semibold transition ${torTab === t ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'}`}
              >
                {t === 'pending' ? `Pending (${pendingTor.length})` : `History (${historyTor.length})`}
              </button>
            ))}
          </div>

          {torLoading ? (
            <div className="py-12 text-center">
              <div className="h-7 w-7 animate-spin rounded-full border-2 border-blue-500 border-t-transparent mx-auto" />
            </div>
          ) : displayedTor.length === 0 ? (
            <div className="rounded-xl border border-slate-800 bg-slate-900/50 px-5 py-12 text-center text-sm text-slate-400">
              {torTab === 'pending' ? 'No pending time off requests.' : 'No history yet.'}
            </div>
          ) : (
            <div className="divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-900/50">
              {displayedTor.map(req => (
                <div key={req.id} className="px-5 py-4 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-white">{req.employee?.name ?? 'Unknown'}</p>
                      <p className="text-xs text-slate-400">{formatDateRange(req.start_date, req.end_date)}</p>
                      {req.reason && <p className="text-xs text-slate-400 mt-0.5">{req.reason}</p>}
                    </div>
                    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${TOR_STATUS_COLORS[req.status]}`}>
                      {req.status.charAt(0).toUpperCase() + req.status.slice(1)}
                    </span>
                  </div>
                  {req.manager_note && (
                    <p className="text-xs text-slate-300 italic">Note: "{req.manager_note}"</p>
                  )}
                  {req.status === 'pending' && (
                    <div className="space-y-2 pt-1">
                      <input
                        type="text"
                        placeholder="Optional note to employee"
                        value={noteInput[req.id] ?? ''}
                        onChange={(e) => setNoteInput(prev => ({ ...prev, [req.id]: e.target.value }))}
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 outline-none focus:border-blue-500"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => torMutation.mutate({ id: req.id, decision: 'approved' })}
                          disabled={torMutation.isPending}
                          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 transition disabled:opacity-50"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          onClick={() => torMutation.mutate({ id: req.id, decision: 'denied' })}
                          disabled={torMutation.isPending}
                          className="rounded-lg border border-red-500/50 px-3 py-1.5 text-xs font-semibold text-red-300 hover:bg-red-500/10 transition disabled:opacity-50"
                        >
                          Deny
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─── Shift Trades ──────────────────────────────────────────────────── */}
      {mainTab === 'shift-trades' && (
        <div className="space-y-4">
          <div className="flex gap-1 w-fit">
            {(['pending', 'history'] as const).map(t => (
              <button
                key={t}
                type="button"
                onClick={() => setStrTab(t)}
                className={`rounded-md px-3 py-2 text-xs font-semibold transition ${strTab === t ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'}`}
              >
                {t === 'pending' ? `Awaiting Approval (${pendingStr.length})` : `History (${historyStr.length})`}
              </button>
            ))}
          </div>

          {strLoading ? (
            <div className="py-12 text-center">
              <div className="h-7 w-7 animate-spin rounded-full border-2 border-blue-500 border-t-transparent mx-auto" />
            </div>
          ) : displayedStr.length === 0 ? (
            <div className="rounded-xl border border-slate-800 bg-slate-900/50 px-5 py-12 text-center text-sm text-slate-400">
              {strTab === 'pending' ? 'No trades awaiting approval.' : 'No history yet.'}
            </div>
          ) : (
            <div className="divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-900/50">
              {displayedStr.map(req => (
                <div key={req.id} className="px-5 py-4 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-white">
                        {req.requesting_employee?.name ?? '—'} → {req.target_employee?.name ?? '—'}
                      </p>
                      <p className="text-xs text-slate-400">
                        <span className="text-slate-500">Requester's shift: </span>
                        {formatShiftTime(req.requesting_shift)}
                      </p>
                      {req.target_shift_id ? (
                        <p className="text-xs text-slate-400">
                          <span className="text-slate-500">In exchange: </span>
                          {formatShiftTime(req.target_shift)}
                        </p>
                      ) : (
                        <p className="text-xs text-slate-500">Give-away (no exchange)</p>
                      )}
                    </div>
                    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${STR_STATUS_COLORS[req.status]}`}>
                      {req.status.charAt(0).toUpperCase() + req.status.slice(1)}
                    </span>
                  </div>
                  {req.requester_note && (
                    <p className="text-xs text-slate-300 italic">"{req.requester_note}"</p>
                  )}
                  {req.manager_note && (
                    <p className="text-xs text-slate-300 italic">Your note: "{req.manager_note}"</p>
                  )}
                  {req.status === 'accepted' && (
                    <div className="space-y-2 pt-1">
                      <input
                        type="text"
                        placeholder="Optional note to employees"
                        value={noteInput[req.id] ?? ''}
                        onChange={(e) => setNoteInput(prev => ({ ...prev, [req.id]: e.target.value }))}
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 outline-none focus:border-blue-500"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => strMutation.mutate({ id: req.id, decision: 'approved' })}
                          disabled={strMutation.isPending}
                          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 transition disabled:opacity-50"
                        >
                          Approve & swap shifts
                        </button>
                        <button
                          type="button"
                          onClick={() => strMutation.mutate({ id: req.id, decision: 'denied' })}
                          disabled={strMutation.isPending}
                          className="rounded-lg border border-red-500/50 px-3 py-1.5 text-xs font-semibold text-red-300 hover:bg-red-500/10 transition disabled:opacity-50"
                        >
                          Deny
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default RequestsPage
