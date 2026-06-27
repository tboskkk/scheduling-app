import { useEffect, useState, useMemo, type FormEvent } from 'react'
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

type RoleInfo = {
  id: string
  name: string
  color: string
}

type CoverageRule = {
  roleId: string
  days: number[]
  startTime: string
  endTime: string
  minEmployees: number
}

type QuickAddLocationDialogProps = {
  isOpen: boolean
  onClose: () => void
  organizationId: string
  onCreated: (location: any) => void
}

function QuickAddLocationDialog({ isOpen, onClose, organizationId, onCreated }: QuickAddLocationDialogProps) {
  const [step, setStep] = useState<'location' | 'coverage'>('location')
  
  // Location form state
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [timezone, setTimezone] = useState('')
  const [timezoneQuery, setTimezoneQuery] = useState('')
  const [showAllZones, setShowAllZones] = useState(false)
  
  // Coverage form state
  const [roles, setRoles] = useState<RoleInfo[]>([])
  const [coverageRules, setCoverageRules] = useState<CoverageRule[]>([])
  const [selectedRole, setSelectedRole] = useState('')
  const [selectedDays, setSelectedDays] = useState<number[]>([1, 2, 3, 4, 5])
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('17:00')
  const [minEmployees, setMinEmployees] = useState(1)
  
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [createdLocationId, setCreatedLocationId] = useState<string | null>(null)

  const browserTimezone = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone
    } catch (error) {
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

  useEffect(() => {
    if (!isOpen) return
    setError(null)
    setStep('location')
    setName('')
    setAddress('')
    setCoverageRules([])
    setCreatedLocationId(null)
    setTimezoneQuery('')
    setShowAllZones(false)
    
    // Auto-detect timezone
    const detected = browserTimezone || 'America/New_York'
    setTimezone(detected)
    
    // Fetch roles for coverage step
    fetchRoles()
  }, [isOpen, browserTimezone])

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

  const addCoverageRule = () => {
    if (!selectedRole || selectedDays.length === 0) return
    
    const newRule: CoverageRule = {
      roleId: selectedRole,
      days: [...selectedDays],
      startTime,
      endTime,
      minEmployees
    }
    
    setCoverageRules(prev => [...prev, newRule])
    
    // Reset form
    setSelectedDays([1, 2, 3, 4, 5])
    setStartTime('09:00')
    setEndTime('17:00')
    setMinEmployees(1)
  }

  const removeCoverageRule = (index: number) => {
    setCoverageRules(prev => prev.filter((_, i) => i !== index))
  }

  const handleLocationSubmit = async (event: FormEvent) => {
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
      const { data, error: insertError } = await supabase
        .from('locations')
        .insert({
          organization_id: organizationId,
          name: name.trim(),
          address: address.trim() || null,
          timezone: timezone,
        })
        .select()
        .single()

      if (insertError || !data) throw new Error(insertError?.message || 'Unable to create location')
      
      setCreatedLocationId(data.id)
      setStep('coverage')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create location')
    } finally {
      setIsSaving(false)
    }
  }

  const handleFinish = async () => {
    if (!createdLocationId) return
    
    try {
      setIsSaving(true)
      
      // Save coverage rules if any
      if (coverageRules.length > 0) {
        const coverageData = coverageRules.flatMap(rule => 
          rule.days.map(day => ({
            organization_id: organizationId,
            location_id: createdLocationId,
            role_id: rule.roleId,
            day_of_week: day,
            start_time: rule.startTime,
            end_time: rule.endTime,
            min_employees: rule.minEmployees
          }))
        )
        
        const { error: coverageError } = await supabase
          .from('coverage_requirements')
          .insert(coverageData)
        
        if (coverageError) throw new Error(coverageError.message)
      }
      
      // Get the created location data to pass back
      const { data: locationData } = await supabase
        .from('locations')
        .select()
        .eq('id', createdLocationId)
        .single()
      
      if (locationData) {
        onCreated(locationData)
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save coverage requirements')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-4 sm:py-8">
      <div className="w-full max-w-2xl rounded-2xl border border-slate-700 bg-slate-950 p-5 shadow-2xl shadow-black/50 max-h-[90dvh] overflow-y-auto">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-slate-500">
              {step === 'location' ? 'Step 1 of 2' : 'Step 2 of 2'}
            </p>
            <h3 className="text-lg font-semibold text-white">
              {step === 'location' ? 'New Location' : 'Coverage Requirements'}
            </h3>
            <p className="text-sm text-slate-300">
              {step === 'location' 
                ? 'Add a workplace for your team.' 
                : 'Set staffing requirements (optional).'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-slate-500"
          >
            Close
          </button>
        </div>

        {step === 'location' && (
          <form onSubmit={handleLocationSubmit} className="mt-4 space-y-3 text-sm text-slate-100">
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
                  <p className="text-xs text-slate-400">Auto-detected from browser. Search to filter options.</p>
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
                className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-70"
              >
                {isSaving ? 'Creating…' : 'Next: Coverage'}
              </button>
            </div>
          </form>
        )}

        {step === 'coverage' && (
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
                {coverageRules.map((rule, index) => {
                  const role = roles.find(r => r.id === rule.roleId)
                  return (
                    <div key={index} className="flex items-center justify-between bg-slate-800/50 p-3 rounded-lg border border-slate-700">
                      <div className="flex items-center gap-3">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: role?.color || '#64748b' }} />
                        <div>
                          <div className="text-sm text-white">{role?.name}</div>
                          <div className="text-xs text-slate-400">
                            {rule.days.map(d => DAYS[d].slice(0, 3)).join(', ')} • {rule.startTime}-{rule.endTime} • {rule.minEmployees} staff
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => removeCoverageRule(index)}
                        className="text-slate-500 hover:text-red-400 p-1"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                      </button>
                    </div>
                  )
                })}
              </div>
            )}

            {error && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[13px] text-red-200">
                {error}
              </div>
            )}

            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={() => setStep('location')}
                className="rounded-lg border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-100 transition hover:border-slate-500"
              >
                Back
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
                  type="button"
                  onClick={handleFinish}
                  disabled={isSaving}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-70"
                >
                  {isSaving ? 'Creating…' : 'Create Location'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default QuickAddLocationDialog