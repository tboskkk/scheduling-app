import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabaseClient'

const PRESETS = [
  { label: 'Business Hours', start: '09:00', end: '17:00', days: [1, 2, 3, 4, 5] },
  { label: 'Morning Shift', start: '06:00', end: '14:00', days: [1, 2, 3, 4, 5] },
  { label: 'Evening Shift', start: '14:00', end: '22:00', days: [1, 2, 3, 4, 5] },
  { label: 'Weekend Coverage', start: '10:00', end: '18:00', days: [0, 6] },
]

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

type RoleInfo = {
  id: string
  name: string
}

type LocationInfo = {
  id: string
  name: string
}

type AddCoverageRuleDialogProps = {
  isOpen: boolean
  onClose: () => void
  organizationId: string
  roles: RoleInfo[]
  locations: LocationInfo[]
  onCreated: (rule: unknown) => void
}

function AddCoverageRuleDialog({ isOpen, onClose, organizationId, roles, locations, onCreated }: AddCoverageRuleDialogProps) {
  const [roleId, setRoleId] = useState('')
  const [locationId, setLocationId] = useState('')
  const [selectedDays, setSelectedDays] = useState<number[]>([])
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('17:00')
  const [minEmployees, setMinEmployees] = useState(1)
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    setError(null)
    setRoleId(roles[0]?.id ?? '')
    setLocationId(locations[0]?.id ?? '')
    setSelectedDays([1, 2, 3, 4, 5]) // Weekdays by default
    setStartTime('09:00')
    setEndTime('17:00')
    setMinEmployees(1)
  }, [isOpen, roles, locations])

  if (!isOpen) return null

  const toggleDay = (dayIndex: number) => {
    setSelectedDays(prev => 
      prev.includes(dayIndex) 
        ? prev.filter(d => d !== dayIndex)
        : [...prev, dayIndex].sort()
    )
  }

  const selectWeekdays = () => setSelectedDays([1, 2, 3, 4, 5])
  const selectWeekends = () => setSelectedDays([0, 6])
  const selectAllDays = () => setSelectedDays([0, 1, 2, 3, 4, 5, 6])
  const clearDays = () => setSelectedDays([])

  const handlePreset = (preset: typeof PRESETS[0]) => {
    setStartTime(preset.start)
    setEndTime(preset.end)
    setSelectedDays(preset.days)
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    
    if (!roleId) {
      setError('Please select a role.')
      return
    }

    if (!locationId) {
      setError('Please select a location.')
      return
    }

    if (selectedDays.length === 0) {
      setError('Please select at least one day.')
      return
    }

    if (!startTime || !endTime) {
      setError('Please set start and end times.')
      return
    }

    try {
      setIsSaving(true)
      const { data, error: insertError } = await supabase
        .from('coverage_rules')
        .insert({
          organization_id: organizationId,
          location_id: locationId,
          role_id: roleId,
          days_of_week: selectedDays,
          start_time: startTime,
          end_time: endTime,
          min_employees: minEmployees,
        })
        .select()
        .single()

      if (insertError || !data) throw new Error(insertError?.message || 'Unable to create coverage rule')
      onCreated(data)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create coverage rule')
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
            <h3 className="text-lg font-semibold text-white">Coverage Rule</h3>
            <p className="text-sm text-slate-300">Set minimum staffing requirements.</p>
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
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="text-xs uppercase tracking-[0.12em] text-slate-500">Role</span>
              <select
                value={roleId}
                onChange={(e) => setRoleId(e.target.value)}
                required
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-hidden ring-2 ring-transparent transition focus:border-blue-500 focus:ring-blue-500"
              >
                <option value="">Select role...</option>
                {roles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-xs uppercase tracking-[0.12em] text-slate-500">Location</span>
              <select
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
                required
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-hidden ring-2 ring-transparent transition focus:border-blue-500 focus:ring-blue-500"
              >
                <option value="">Select location...</option>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between items-end">
              <span className="text-xs uppercase tracking-[0.12em] text-slate-500">Days</span>
              <div className="flex gap-2 text-[10px]">
                <button type="button" onClick={selectWeekdays} className="text-blue-400 hover:text-blue-300">Weekdays</button>
                <span className="text-slate-600">|</span>
                <button type="button" onClick={selectWeekends} className="text-blue-400 hover:text-blue-300">Weekends</button>
                <span className="text-slate-600">|</span>
                <button type="button" onClick={selectAllDays} className="text-blue-400 hover:text-blue-300">All</button>
                <span className="text-slate-600">|</span>
                <button type="button" onClick={clearDays} className="text-slate-500 hover:text-slate-400">None</button>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {DAYS.map((day, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => toggleDay(i)}
                  className={`px-2.5 py-1.5 rounded-sm text-xs font-medium transition-all ${
                    selectedDays.includes(i)
                      ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/20'
                      : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
                  }`}
                >
                  {day.slice(0, 3)}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <label className="space-y-1">
              <span className="text-xs uppercase tracking-[0.12em] text-slate-500">Start</span>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                required
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-hidden ring-2 ring-transparent transition focus:border-blue-500 focus:ring-blue-500"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs uppercase tracking-[0.12em] text-slate-500">End</span>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                required
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-hidden ring-2 ring-transparent transition focus:border-blue-500 focus:ring-blue-500"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs uppercase tracking-[0.12em] text-slate-500">Min Staff</span>
              <input
                type="number"
                min="1"
                value={minEmployees}
                onChange={(e) => setMinEmployees(parseInt(e.target.value))}
                required
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-hidden ring-2 ring-transparent transition focus:border-blue-500 focus:ring-blue-500"
              />
            </label>
          </div>

          <div className="flex flex-wrap gap-2 text-xs">
            {PRESETS.map((preset) => (
              <button
                type="button"
                key={preset.label}
                onClick={() => handlePreset(preset)}
                className="rounded-full border border-slate-700 px-3 py-1 font-semibold text-slate-100 transition hover:border-blue-400 hover:text-white"
              >
                {preset.label}
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
              {isSaving ? 'Creating…' : 'Add rule'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default AddCoverageRuleDialog