import { useCallback, useEffect, useState, useMemo, type FormEvent } from 'react'
import { supabase } from '../../lib/supabaseClient'

// Comprehensive IANA timezone list with fallback
const FALLBACK_TIMEZONES = [
  'Pacific/Midway',
  'America/Anchorage',
  'America/Los_Angeles',
  'America/Denver',
  'America/Chicago',
  'America/Winnipeg',
  'Canada/Saskatchewan',
  'America/New_York',
  'America/Toronto',
  'America/Halifax',
  'America/Sao_Paulo',
  'UTC',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Moscow',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Bangkok',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Pacific/Auckland',
]

const TIMEZONES = (() => {
  if (typeof Intl !== 'undefined' && typeof Intl.supportedValuesOf === 'function') {
    try {
      const values = Intl.supportedValuesOf('timeZone')
      return [...values].sort()
    } catch {
      return FALLBACK_TIMEZONES
    }
  }
  return FALLBACK_TIMEZONES
})()

function dedupeTimezones(zones: string[]) {
  const seen = new Set<string>()
  return zones.filter((z) => {
    if (!z) return false
    if (seen.has(z)) return false
    seen.add(z)
    return TIMEZONES.includes(z)
  })
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const PRESETS = [
  { label: 'Business Hours', start: '09:00', end: '17:00', days: [1, 2, 3, 4, 5] },
  { label: 'Morning Shift', start: '06:00', end: '14:00', days: [1, 2, 3, 4, 5] },
  { label: 'Evening Shift', start: '14:00', end: '22:00', days: [1, 2, 3, 4, 5] },
  { label: 'Weekend Coverage', start: '10:00', end: '18:00', days: [0, 6] },
]

type LocationRecord = {
  id: string
  name: string
  address: string | null
  timezone: string
  created_at: string
}

type RoleInfo = {
  id: string
  name: string
  color: string
}

type CoverageRequirement = {
  id: string
  role_id: string
  day_of_week: number
  start_time: string
  end_time: string
  min_employees: number
}

type EditLocationDialogProps = {
  isOpen: boolean
  onClose: () => void
  location: LocationRecord | null
  onUpdated: (location: LocationRecord) => void
  onDeleted: (locationId: string) => void
}

function EditLocationDialog({ isOpen, onClose, location, onUpdated, onDeleted }: EditLocationDialogProps) {
  const [tab, setTab] = useState<'details' | 'coverage'>('details')
  
  // Location form state
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [timezone, setTimezone] = useState('')
  const [timezoneQuery, setTimezoneQuery] = useState('')
  const [showAllZones, setShowAllZones] = useState(false)
  
  // Coverage state
  const [roles, setRoles] = useState<RoleInfo[]>([])
  const [coverageRules, setCoverageRules] = useState<CoverageRequirement[]>([])
  const [selectedRole, setSelectedRole] = useState('')
  const [selectedDays, setSelectedDays] = useState<number[]>([1, 2, 3, 4, 5])
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('17:00')
  const [minEmployees, setMinEmployees] = useState(1)
  
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  const browserTimezone = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone
    } catch {
      return null
    }
  }, [])

  const suggestedTimezones = useMemo(() => {
    return dedupeTimezones([
      browserTimezone ?? '',
      'Canada/Saskatchewan',
      'America/Regina',
      'America/Chicago',
      'America/New_York',
      'America/Los_Angeles',
      'UTC',
    ])
  }, [browserTimezone])

  const filteredTimezones = useMemo(() => {
    const needle = timezoneQuery.trim().toLowerCase()
    if (!needle) return TIMEZONES
    return TIMEZONES.filter((zone) => zone.toLowerCase().includes(needle))
  }, [timezoneQuery])

  const fetchRoles = async () => {
    try {
      const { data, error } = await supabase
        .from('roles')
        .select('id, name, color')
        .order('name')
      
      if (error) throw error
      setRoles(data || [])
      setSelectedRole(data?.[0]?.id || '')
    } catch (err) {
      console.error('Failed to fetch roles:', err)
    }
  }

  const fetchCoverageRules = useCallback(async () => {
    if (!location) return
    
    try {
      const { data, error } = await supabase
        .from('coverage_requirements')
        .select('*')
        .eq('location_id', location.id)
        .order('day_of_week')
        .order('start_time')
      
      if (error) throw error
      setCoverageRules(data || [])
    } catch (err) {
      console.error('Failed to fetch coverage rules:', err)
    }
  }, [location])

  useEffect(() => {
    if (!isOpen || !location) return
    setError(null)
    setTab('details')
    setName(location.name)
    setAddress(location.address || '')
    setTimezone(location.timezone)
    setTimezoneQuery('')
    setShowAllZones(false)
    
    fetchRoles()
    fetchCoverageRules()
  }, [isOpen, location, fetchCoverageRules])

  if (!isOpen || !location) return null

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

  const addCoverageRule = async () => {
    if (!selectedRole || selectedDays.length === 0 || !location) return
    
    try {
      const newRules = selectedDays.map(day => ({
        location_id: location.id,
        role_id: selectedRole,
        day_of_week: day,
        start_time: startTime,
        end_time: endTime,
        min_employees: minEmployees
      }))
      
      const { error } = await supabase
        .from('coverage_requirements')
        .insert(newRules)
      
      if (error) throw error
      
      // Refresh the rules
      await fetchCoverageRules()
      
      // Reset form
      setSelectedDays([1, 2, 3, 4, 5])
      setStartTime('09:00')
      setEndTime('17:00')
      setMinEmployees(1)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to add coverage rule')
    }
  }

  const deleteCoverageRule = async (ruleId: string) => {
    try {
      const { error } = await supabase
        .from('coverage_requirements')
        .delete()
        .eq('id', ruleId)
      
      if (error) throw error
      setCoverageRules(prev => prev.filter(r => r.id !== ruleId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete coverage rule')
    }
  }

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this location? This action cannot be undone.')) return
    
    try {
      setIsDeleting(true)
      
      // Check for future shifts first
      const { count, error: countError } = await supabase
        .from('shifts')
        .select('id', { count: 'exact', head: true })
        .eq('location_id', location.id)
        .gte('start_datetime', new Date().toISOString())

      if (countError) throw new Error(countError.message)
      
      if (count && count > 0) {
        setError(`Cannot delete location. There are ${count} future shifts scheduled at this location.`)
        return
      }

      const { error: deleteError } = await supabase
        .from('locations')
        .delete()
        .eq('id', location.id)

      if (deleteError) throw new Error(deleteError.message)
      onDeleted(location.id)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete location')
    } finally {
      setIsDeleting(false)
    }
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    
    if (!name.trim()) {
      setError('Location name is required.')
      return
    }

    if (!timezone) {
      setError('Please select a timezone.')
      return
    }

    try {
      setIsSaving(true)
      const { data, error: updateError } = await supabase
        .from('locations')
        .update({
          name: name.trim(),
          address: address.trim() || null,
          timezone: timezone,
        })
        .eq('id', location.id)
        .select()
        .single()

      if (updateError || !data) throw new Error(updateError?.message || 'Unable to update location')
      onUpdated(data as LocationRecord)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update location')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-4 sm:py-8">
      <div className="w-full max-w-2xl rounded-2xl border border-slate-700 bg-slate-950 p-5 shadow-2xl shadow-black/50 max-h-[90dvh] overflow-y-auto">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Edit Location</p>
            <h3 className="text-lg font-semibold text-white">{location.name}</h3>
            <p className="text-sm text-slate-300">Update location details and coverage requirements.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-slate-500"
          >
            Close
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-800 mt-4">
          <button
            onClick={() => setTab('details')}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              tab === 'details'
                ? 'text-blue-400 border-b-2 border-blue-400'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Location Details
          </button>
          <button
            onClick={() => setTab('coverage')}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              tab === 'coverage'
                ? 'text-blue-400 border-b-2 border-blue-400'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Coverage Requirements ({coverageRules.length})
          </button>
        </div>

        {tab === 'details' && (
          <form onSubmit={handleSubmit} className="mt-4 space-y-3 text-sm text-slate-100">
            <label className="space-y-1 block">
              <span className="text-xs uppercase tracking-[0.12em] text-slate-500">Name</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Downtown Flagship"
                required
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none ring-2 ring-transparent transition focus:border-blue-500 focus:ring-blue-500"
              />
            </label>

            <label className="space-y-1 block">
              <span className="text-xs uppercase tracking-[0.12em] text-slate-500">Address (Optional)</span>
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="123 Market Street, San Francisco, CA"
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none ring-2 ring-transparent transition focus:border-blue-500 focus:ring-blue-500"
              />
            </label>

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-1">
                  <span className="text-xs uppercase tracking-[0.12em] text-slate-500">Timezone</span>
                  <p className="text-xs text-slate-400">Search to filter the full list of timezones.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAllZones((prev) => !prev)}
                  className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-100 transition hover:border-slate-500"
                >
                  {showAllZones ? 'Hide full list' : 'Show all timezones'}
                </button>
              </div>

              <input
                type="text"
                value={timezoneQuery}
                onChange={(e) => setTimezoneQuery(e.target.value)}
                placeholder="Search (e.g., Regina, London, Tokyo)"
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none ring-2 ring-transparent transition focus:border-blue-500 focus:ring-blue-500"
              />

              <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                required
                size={Math.min(12, Math.max(6, (showAllZones ? filteredTimezones : suggestedTimezones).length + 2))}
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none ring-2 ring-transparent transition focus:border-blue-500 focus:ring-blue-500"
              >
                <optgroup label="Suggested (region-aware)">
                  {suggestedTimezones.map((zone) => (
                    <option key={zone} value={zone} className="bg-slate-900 text-slate-100">
                      {zone}
                    </option>
                  ))}
                </optgroup>
                <optgroup label={showAllZones ? 'All timezones' : 'Matching timezones (top 40)'}>
                  {(showAllZones ? filteredTimezones : filteredTimezones.slice(0, 40)).map((zone) => (
                    <option key={zone} value={zone} className="bg-slate-900 text-slate-100">
                      {zone}
                    </option>
                  ))}
                </optgroup>
              </select>
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
                {isDeleting ? 'Deleting…' : 'Delete location'}
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
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-70"
                >
                  {isSaving ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </div>
          </form>
        )}

        {tab === 'coverage' && (
          <div className="mt-4 space-y-4">
            <div className="bg-slate-900/50 p-4 rounded-lg border border-slate-800">
              <h4 className="text-sm font-medium text-white mb-3">Add Coverage Rule</h4>
              
              <div className="grid grid-cols-2 gap-3 mb-3">
                <label className="space-y-1">
                  <span className="text-xs uppercase tracking-[0.12em] text-slate-500">Role</span>
                  <select
                    value={selectedRole}
                    onChange={(e) => setSelectedRole(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none ring-2 ring-transparent transition focus:border-blue-500 focus:ring-blue-500"
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
                  <span className="text-xs uppercase tracking-[0.12em] text-slate-500">Min Staff</span>
                  <input
                    type="number"
                    min="1"
                    value={minEmployees}
                    onChange={(e) => setMinEmployees(parseInt(e.target.value))}
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none ring-2 ring-transparent transition focus:border-blue-500 focus:ring-blue-500"
                  />
                </label>
              </div>

              <div className="space-y-2 mb-3">
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
                      className={`px-2.5 py-1.5 rounded text-xs font-medium transition-all ${
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

              <div className="grid grid-cols-2 gap-3 mb-3">
                <label className="space-y-1">
                  <span className="text-xs uppercase tracking-[0.12em] text-slate-500">Start</span>
                  <input
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none ring-2 ring-transparent transition focus:border-blue-500 focus:ring-blue-500"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-xs uppercase tracking-[0.12em] text-slate-500">End</span>
                  <input
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none ring-2 ring-transparent transition focus:border-blue-500 focus:ring-blue-500"
                  />
                </label>
              </div>

              <div className="flex flex-wrap gap-2 text-xs mb-3">
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

              <button
                type="button"
                onClick={addCoverageRule}
                disabled={!selectedRole || selectedDays.length === 0}
                className="w-full rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-blue-500 disabled:opacity-50"
              >
                Add Rule
              </button>
            </div>

            {coverageRules.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-white">Coverage Rules ({coverageRules.length})</h4>
                {roles.map(role => {
                  const roleRules = coverageRules.filter(r => r.role_id === role.id)
                  if (roleRules.length === 0) return null
                  
                  return (
                    <div key={role.id} className="bg-slate-900/30 rounded-lg border border-slate-800 overflow-hidden">
                      <div className="bg-slate-800/50 px-4 py-3 border-b border-slate-700/50 flex items-center gap-3">
                        <div className="w-3 h-3 rounded-full shadow-sm" style={{ backgroundColor: role.color }} />
                        <h5 className="font-medium text-white">{role.name}</h5>
                        <span className="text-xs text-slate-400 ml-auto">{roleRules.length} rules</span>
                      </div>
                      
                      <div className="p-2 space-y-2">
                        {roleRules.map(rule => (
                          <div key={rule.id} className="flex items-center justify-between bg-slate-800/30 hover:bg-slate-800/50 p-3 rounded border border-slate-700/50 transition-colors group">
                            <div className="flex items-center gap-3">
                              <div className="flex flex-col items-center justify-center w-10 h-10 bg-slate-800 rounded text-slate-300 font-bold text-xs border border-slate-700">
                                <span>{DAYS[rule.day_of_week].slice(0, 3)}</span>
                              </div>
                              <div>
                                <div className="text-sm font-medium text-slate-200">
                                  {rule.start_time.slice(0, 5)} - {rule.end_time.slice(0, 5)}
                                </div>
                                <div className="text-xs text-slate-400 flex items-center gap-1">
                                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                                  {rule.min_employees} required
                                </div>
                              </div>
                            </div>
                            <button
                              onClick={() => deleteCoverageRule(rule.id)}
                              className="text-slate-600 hover:text-red-400 transition-colors p-2 opacity-0 group-hover:opacity-100"
                              title="Delete Rule"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {coverageRules.length === 0 && (
              <div className="text-center py-8 bg-slate-900/30 rounded-lg border border-slate-800 border-dashed">
                <p className="text-slate-500 text-sm">No coverage rules defined for this location.</p>
                <p className="text-slate-600 text-xs mt-1">Use the form above to add staffing requirements.</p>
              </div>
            )}

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
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default EditLocationDialog