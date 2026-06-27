import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabaseClient'
import type { EmployeeProfile } from '../../types'

interface Props {
  employeeProfile: EmployeeProfile | null
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function startOfWeekMonday(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay() // 0=Sun
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
}

function formatDate(d: Date) {
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
}

function formatTime(dt: string) {
  return new Date(dt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function formatDuration(start: string, end: string) {
  const mins = (new Date(end).getTime() - new Date(start).getTime()) / 60000
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function EmployeeSchedulePage({ employeeProfile }: Props) {
  const empId = employeeProfile?.id ?? null
  const [weekStart, setWeekStart] = useState(() => startOfWeekMonday(new Date()))

  const weekEndDisplay = addDays(weekStart, 6)
  // Exclusive upper bound at the start of the following week — avoids mixing
  // local setHours() with UTC ISO comparisons in the query.
  const weekEnd = addDays(weekStart, 7)

  const { data: shifts = [], isLoading } = useQuery({
    queryKey: ['employee-schedule', empId, weekStart.toISOString()],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('shifts')
        .select(`
          id,
          start_datetime,
          end_datetime,
          break_start_datetime,
          break_end_datetime,
          locations(name),
          roles(name, color),
          schedules!inner(status)
        `)
        .eq('employee_id', empId!)
        .eq('schedules.status', 'published')
        .gte('start_datetime', weekStart.toISOString())
        .lt('start_datetime', weekEnd.toISOString())
        .order('start_datetime', { ascending: true })
      if (error) throw new Error(error.message)
      return data ?? []
    },
    enabled: Boolean(empId),
  })

  const shiftsByDay = DAYS.map((_, i) => {
    const day = addDays(weekStart, i)
    const dayStr = day.toDateString()
    return (shifts as unknown as Array<{
      id: string
      start_datetime: string
      end_datetime: string
      break_start_datetime: string | null
      break_end_datetime: string | null
      locations: { name: string } | null
      roles: { name: string; color: string | null } | null
    }>).filter(s => new Date(s.start_datetime).toDateString() === dayStr)
  })

  const weekLabel = `${formatDate(weekStart)} – ${formatDate(weekEndDisplay)}`

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Published Schedule</p>
          <h1 className="mt-1 text-2xl font-semibold text-white">My Schedule</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setWeekStart(w => addDays(w, -7))}
            className="rounded-md border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-slate-500"
            aria-label="Previous week"
          >
            ◀
          </button>
          <span className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-semibold text-white whitespace-nowrap">
            {weekLabel}
          </span>
          <button
            type="button"
            onClick={() => setWeekStart(w => addDays(w, 7))}
            className="rounded-md border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-slate-500"
            aria-label="Next week"
          >
            ▶
          </button>
          <button
            type="button"
            onClick={() => setWeekStart(startOfWeekMonday(new Date()))}
            className="rounded-md border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-blue-400 hover:text-white"
          >
            Today
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="py-16 text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent mx-auto" />
        </div>
      ) : (
        <div className="space-y-2">
          {DAYS.map((dayLabel, i) => {
            const day = addDays(weekStart, i)
            const dayShifts = shiftsByDay[i]
            const isToday = day.toDateString() === new Date().toDateString()

            return (
              <div
                key={dayLabel}
                className={`rounded-xl border ${isToday ? 'border-blue-500/40 bg-blue-950/20' : 'border-slate-800 bg-slate-900/40'}`}
              >
                <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800/60">
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-semibold ${isToday ? 'text-blue-300' : 'text-slate-200'}`}>
                      {dayLabel}
                    </span>
                    <span className="text-xs text-slate-500">
                      {day.toLocaleDateString([], { month: 'short', day: 'numeric' })}
                    </span>
                    {isToday && (
                      <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-semibold text-white">
                        Today
                      </span>
                    )}
                  </div>
                  {dayShifts.length === 0 && (
                    <span className="text-xs text-slate-600">Off</span>
                  )}
                </div>

                {dayShifts.length > 0 && (
                  <div className="divide-y divide-slate-800/60">
                    {dayShifts.map(shift => (
                      <div key={shift.id} className="flex items-center justify-between px-5 py-3">
                        <div className="space-y-0.5">
                          <p className="text-sm font-semibold text-white">
                            {formatTime(shift.start_datetime)} – {formatTime(shift.end_datetime)}
                            <span className="ml-2 text-xs font-normal text-slate-400">
                              ({formatDuration(shift.start_datetime, shift.end_datetime)})
                            </span>
                          </p>
                          <p className="text-xs text-slate-400">
                            {shift.locations?.name ?? 'Unknown location'}
                            {shift.break_start_datetime && shift.break_end_datetime && (
                              <span className="ml-2 text-slate-500">
                                · Break {formatTime(shift.break_start_datetime)}–{formatTime(shift.break_end_datetime)}
                              </span>
                            )}
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
            )
          })}
        </div>
      )}
    </div>
  )
}

export default EmployeeSchedulePage
