import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import type { EmployeeProfile } from '../../types'

interface Props {
  employeeProfile: EmployeeProfile | null
}

function EmployeeDashboardPage({ employeeProfile }: Props) {
  const empId = employeeProfile?.id ?? null

  // Upcoming shifts (next 7 days, live shifts table)
  const { data: upcomingShifts = [] } = useQuery({
    queryKey: ['employee-upcoming-shifts', empId],
    queryFn: async () => {
      const now = new Date()
      const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
      const { data, error } = await supabase
        .from('shifts')
        .select('id, start_datetime, end_datetime, location_id, role_id, locations(name), roles(name, color)')
        .eq('employee_id', empId!)
        .gte('start_datetime', now.toISOString())
        .lte('start_datetime', in7Days.toISOString())
        .order('start_datetime', { ascending: true })
      if (error) throw new Error(error.message)
      return data ?? []
    },
    enabled: Boolean(empId),
  })

  // Pending time off request count
  const { data: pendingTor = 0 } = useQuery({
    queryKey: ['employee-pending-tor', empId],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('time_off_requests')
        .select('*', { count: 'exact', head: true })
        .eq('employee_id', empId!)
        .eq('status', 'pending')
      if (error) throw new Error(error.message)
      return count ?? 0
    },
    enabled: Boolean(empId),
  })

  // Pending outgoing shift trade count
  const { data: pendingOutStr = 0 } = useQuery({
    queryKey: ['employee-pending-out-str', empId],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('shift_trade_requests')
        .select('*', { count: 'exact', head: true })
        .eq('requesting_employee_id', empId!)
        .eq('status', 'pending')
      if (error) throw new Error(error.message)
      return count ?? 0
    },
    enabled: Boolean(empId),
  })

  // Pending incoming shift trade count (employee is the target)
  const { data: pendingInStr = 0 } = useQuery({
    queryKey: ['employee-pending-in-str', empId],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('shift_trade_requests')
        .select('*', { count: 'exact', head: true })
        .eq('target_employee_id', empId!)
        .eq('status', 'pending')
      if (error) throw new Error(error.message)
      return count ?? 0
    },
    enabled: Boolean(empId),
  })

  const totalPendingStr = (pendingOutStr as number) + (pendingInStr as number)

  const formatShiftTime = (dt: string) => {
    const d = new Date(dt)
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  }

  const formatShiftDate = (dt: string) => {
    const d = new Date(dt)
    return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
  }

  const statCards = useMemo(() => [
    {
      label: 'Upcoming shifts',
      value: (upcomingShifts as unknown[]).length,
      to: '/employee/schedule',
      color: 'blue',
    },
    {
      label: 'Pending time off',
      value: pendingTor as number,
      to: '/employee/time-off',
      color: 'amber',
    },
    {
      label: 'Shift trade activity',
      value: totalPendingStr,
      to: '/employee/trades',
      color: 'emerald',
    },
  ], [upcomingShifts, pendingTor, totalPendingStr])

  const colorMap: Record<string, string> = {
    blue: 'border-blue-500/30 bg-blue-500/10 text-blue-300',
    amber: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
    emerald: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  }

  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Overview</p>
        <h1 className="mt-1 text-2xl font-semibold text-white">
          Hello, {employeeProfile?.name?.split(' ')[0] ?? 'there'} 👋
        </h1>
      </div>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        {statCards.map((card) => (
          <Link
            key={card.label}
            to={card.to}
            className={`rounded-xl border p-5 transition hover:opacity-80 ${colorMap[card.color]}`}
          >
            <p className="text-3xl font-bold">{card.value}</p>
            <p className="mt-1 text-sm font-semibold">{card.label}</p>
          </Link>
        ))}
      </div>

      {/* Upcoming shifts list */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
            Next 7 days
          </h2>
          <Link to="/employee/schedule" className="text-xs font-semibold text-blue-400 hover:text-blue-300">
            View full schedule →
          </Link>
        </div>

        {(upcomingShifts as unknown[]).length === 0 ? (
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 px-5 py-8 text-center text-sm text-slate-400">
            No shifts scheduled in the next 7 days.
          </div>
        ) : (
          <div className="divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-900/50">
            {(upcomingShifts as unknown as Array<{
              id: string
              start_datetime: string
              end_datetime: string
              locations: { name: string } | null
              roles: { name: string; color: string | null } | null
            }>).map((shift) => (
              <div key={shift.id} className="flex items-center justify-between px-5 py-4">
                <div>
                  <p className="text-sm font-semibold text-white">
                    {formatShiftDate(shift.start_datetime)}
                  </p>
                  <p className="text-xs text-slate-400">
                    {formatShiftTime(shift.start_datetime)} – {formatShiftTime(shift.end_datetime)}
                    {shift.locations ? ` · ${shift.locations.name}` : ''}
                  </p>
                </div>
                {shift.roles && (
                  <span
                    className="rounded-full border px-2 py-0.5 text-xs font-semibold"
                    style={{
                      color: shift.roles.color ?? '#cbd5e1',
                      borderColor: shift.roles.color ?? '#334155',
                    }}
                  >
                    {shift.roles.name}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default EmployeeDashboardPage
