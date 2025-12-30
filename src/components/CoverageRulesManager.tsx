import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import type { CoverageRequirement } from '../types'

type Location = {
  id: string
  name: string
}

type Role = {
  id: string
  name: string
  color: string
}

export default function CoverageRulesManager() {
  const [locations, setLocations] = useState<Location[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [selectedLocationId, setSelectedLocationId] = useState<string>('')
  const [rules, setRules] = useState<CoverageRequirement[]>([])
  const [loading, setLoading] = useState(true)

  // Form state
  const [selectedRole, setSelectedRole] = useState('')
  const [selectedDays, setSelectedDays] = useState<number[]>([1, 2, 3, 4, 5]) // Default to Mon-Fri
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('17:00')
  const [minEmployees, setMinEmployees] = useState(1)

  useEffect(() => {
    fetchLocationsAndRoles()
  }, [])

  useEffect(() => {
    if (selectedLocationId) {
      fetchRules(selectedLocationId)
    } else {
      setRules([])
    }
  }, [selectedLocationId])

  async function fetchLocationsAndRoles() {
    const [locsRes, rolesRes] = await Promise.all([
      supabase.from('locations').select('id, name').order('name'),
      supabase.from('roles').select('id, name, color').order('name')
    ])

    if (locsRes.data) {
      setLocations(locsRes.data)
      if (locsRes.data.length > 0) {
        setSelectedLocationId(locsRes.data[0].id)
      }
    }
    if (rolesRes.data) setRoles(rolesRes.data)
    setLoading(false)
  }

  async function fetchRules(locationId: string) {
    const { data } = await supabase
      .from('coverage_requirements')
      .select('*')
      .eq('location_id', locationId)
      .order('day_of_week')
      .order('start_time')

    if (data) setRules(data)
  }

  async function handleAddRule(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedLocationId || !selectedRole || selectedDays.length === 0) return

    const newRules = selectedDays.map(day => ({
      location_id: selectedLocationId,
      role_id: selectedRole,
      day_of_week: day,
      start_time: startTime,
      end_time: endTime,
      min_employees: minEmployees
    }))

    const { error } = await supabase.from('coverage_requirements').insert(newRules)

    if (!error) {
      fetchRules(selectedLocationId)
    }
  }

  async function handleDeleteRule(id: string) {
    const { error } = await supabase
      .from('coverage_requirements')
      .delete()
      .eq('id', id)

    if (!error) {
      setRules(rules.filter(r => r.id !== id))
    }
  }

  const toggleDay = (dayIndex: number) => {
    if (selectedDays.includes(dayIndex)) {
      setSelectedDays(selectedDays.filter(d => d !== dayIndex))
    } else {
      setSelectedDays([...selectedDays, dayIndex].sort())
    }
  }

  const selectWeekdays = () => setSelectedDays([1, 2, 3, 4, 5])
  const selectAllDays = () => setSelectedDays([0, 1, 2, 3, 4, 5, 6])
  const clearDays = () => setSelectedDays([])

  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

  if (loading) return <div>Loading...</div>

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 bg-slate-800/50 p-4 rounded-lg border border-slate-700">
        <label className="text-sm font-medium text-slate-300">Select Location:</label>
        <select
          value={selectedLocationId}
          onChange={(e) => setSelectedLocationId(e.target.value)}
          className="rounded bg-slate-900 border-slate-600 text-white px-3 py-1.5 min-w-[200px]"
        >
          {locations.map(loc => (
            <option key={loc.id} value={loc.id}>{loc.name}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Add Rule Form */}
        <div className="lg:col-span-4 bg-slate-900/50 p-5 rounded-lg border border-slate-800 h-fit sticky top-4">
          <h3 className="text-lg font-medium text-white mb-4 flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-400"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
            Add Coverage Rule
          </h3>
          <p className="text-xs text-slate-400 mb-4">
            Define staffing requirements to ensure you have enough employees scheduled for each role.
          </p>
          <form onSubmit={handleAddRule} className="space-y-5">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">Role</label>
              <select
                value={selectedRole}
                onChange={e => setSelectedRole(e.target.value)}
                className="w-full rounded bg-slate-800 border-slate-700 text-white px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                required
              >
                <option value="">Select Role...</option>
                {roles.map(role => (
                  <option key={role.id} value={role.id}>{role.name}</option>
                ))}
              </select>
            </div>

            <div>
              <div className="flex justify-between items-end mb-2">
                <label className="block text-xs font-medium text-slate-400 uppercase tracking-wider">Days</label>
                <div className="flex gap-2 text-[10px]">
                  <button type="button" onClick={selectWeekdays} className="text-blue-400 hover:text-blue-300">Weekdays</button>
                  <span className="text-slate-600">|</span>
                  <button type="button" onClick={selectAllDays} className="text-blue-400 hover:text-blue-300">All</button>
                  <span className="text-slate-600">|</span>
                  <button type="button" onClick={clearDays} className="text-slate-500 hover:text-slate-400">None</button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {days.map((day, i) => (
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
              {selectedDays.length === 0 && (
                <p className="text-xs text-red-400 mt-1">Please select at least one day</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">Start Time</label>
                <input
                  type="time"
                  value={startTime}
                  onChange={e => setStartTime(e.target.value)}
                  className="w-full rounded bg-slate-800 border-slate-700 text-white px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">End Time</label>
                <input
                  type="time"
                  value={endTime}
                  onChange={e => setEndTime(e.target.value)}
                  className="w-full rounded bg-slate-800 border-slate-700 text-white px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">Min Employees</label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min="1"
                  max="10"
                  value={minEmployees}
                  onChange={e => setMinEmployees(parseInt(e.target.value))}
                  className="flex-1 h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer"
                />
                <input
                  type="number"
                  min="1"
                  value={minEmployees}
                  onChange={e => setMinEmployees(parseInt(e.target.value))}
                  onBlur={(e) => (e.target.value = Number(e.target.value).toString())}
                  className="w-16 rounded bg-slate-800 border-slate-700 text-white px-2 py-1 text-sm text-center focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={!selectedRole || selectedDays.length === 0}
              className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed text-white py-2.5 rounded-md text-sm font-medium transition-all shadow-lg shadow-blue-900/20"
            >
              Add Coverage Rule
            </button>
          </form>
        </div>

        {/* Rules List */}
        <div className="lg:col-span-8 space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-medium text-white">Existing Rules</h3>
            <span className="text-xs text-slate-400 bg-slate-800 px-2 py-1 rounded-full">{rules.length} rules defined</span>
          </div>
          
          {rules.length === 0 ? (
            <div className="text-center py-12 bg-slate-900/30 rounded-lg border border-slate-800 border-dashed">
              <p className="text-slate-500 text-sm">No coverage rules defined for this location.</p>
              <p className="text-slate-600 text-xs mt-1">Use the form to add staffing requirements.</p>
            </div>
          ) : (
            <div className="space-y-6">
              {roles.map(role => {
                const roleRules = rules.filter(r => r.role_id === role.id)
                if (roleRules.length === 0) return null
                
                return (
                  <div key={role.id} className="bg-slate-900/30 rounded-lg border border-slate-800 overflow-hidden">
                    <div className="bg-slate-800/50 px-4 py-3 border-b border-slate-700/50 flex items-center gap-3">
                      <div className="w-3 h-3 rounded-full shadow-sm" style={{ backgroundColor: role.color }} />
                      <h4 className="font-medium text-white">{role.name}</h4>
                      <span className="text-xs text-slate-400 ml-auto">{roleRules.length} shifts</span>
                    </div>
                    
                    <div className="p-2 grid grid-cols-1 md:grid-cols-2 gap-2">
                      {roleRules.map(rule => (
                        <div key={rule.id} className="flex items-center justify-between bg-slate-800/30 hover:bg-slate-800/50 p-3 rounded border border-slate-700/50 transition-colors group">
                          <div className="flex items-center gap-3">
                            <div className="flex flex-col items-center justify-center w-10 h-10 bg-slate-800 rounded text-slate-300 font-bold text-xs border border-slate-700">
                              <span>{days[rule.day_of_week].slice(0, 3)}</span>
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
                            onClick={() => handleDeleteRule(rule.id)}
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
        </div>
      </div>
    </div>
  )
}
