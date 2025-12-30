import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { DEFAULT_ORGANIZATION_SETTINGS, type OrganizationSettings } from '../types'

interface OnboardingWizardProps {
  onComplete: (orgId: string) => void
}

type WizardStep = 'org' | 'roles' | 'locations' | 'coverage' | 'review'

interface RoleDraft {
  id: string // temp id
  name: string
  color: string
}

interface LocationDraft {
  id: string // temp id
  name: string
  timezone: string
}

interface CoverageDraft {
  roleId: string
  locationId: string
  minEmployees: number
  startTime: string
  endTime: string
  days: number[] // 0-6
}

const DEFAULT_ROLES: RoleDraft[] = [
  { id: '1', name: 'Manager', color: '#ef4444' },
]

const DEFAULT_LOCATION: LocationDraft = {
  id: '1',
  name: 'Main Location',
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
}

export default function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const [step, setStep] = useState<WizardStep>('org')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Step 1: Org
  const [orgName, setOrgName] = useState('')
  const [settings, setSettings] = useState<OrganizationSettings>(DEFAULT_ORGANIZATION_SETTINGS)

  // Step 2: Roles
  const [roles, setRoles] = useState<RoleDraft[]>(DEFAULT_ROLES)
  const [newRoleName, setNewRoleName] = useState('')

  // Step 3: Locations
  const [locations, setLocations] = useState<LocationDraft[]>([DEFAULT_LOCATION])
  const [newLocationName, setNewLocationName] = useState('')

  // Step 4: Coverage
  const [coverages, setCoverages] = useState<CoverageDraft[]>([])
  
  // Coverage Form State
  const [covRole, setCovRole] = useState('')
  const [covLocation, setCovLocation] = useState('')
  const [covDays, setCovDays] = useState<number[]>([1, 2, 3, 4, 5])
  const [covStart, setCovStart] = useState('09:00')
  const [covEnd, setCovEnd] = useState('17:00')
  const [covMin, setCovMin] = useState(1)

  const handleNext = () => {
    if (step === 'org') {
      if (!orgName.trim()) {
        setError('Organization name is required')
        return
      }
      setStep('roles')
    } else if (step === 'roles') {
      if (roles.length === 0) {
        setError('At least one role is recommended')
        return
      }
      setStep('locations')
    } else if (step === 'locations') {
      if (locations.length === 0) {
        setError('At least one location is required')
        return
      }
      // Initialize coverage form defaults
      if (roles.length > 0) setCovRole(roles[0].id)
      if (locations.length > 0) setCovLocation(locations[0].id)
      setStep('coverage')
    } else if (step === 'coverage') {
      setStep('review')
    }
    setError(null)
  }

  const handleBack = () => {
    if (step === 'roles') setStep('org')
    else if (step === 'locations') setStep('roles')
    else if (step === 'coverage') setStep('locations')
    else if (step === 'review') setStep('coverage')
    setError(null)
  }

  const handleSubmit = async () => {
    setIsSubmitting(true)
    setError(null)

    try {
      // 1. Create Org & Manager
      const { data: orgId, error: orgError } = await supabase.rpc('create_org_and_manager', {
        org_name: orgName.trim(),
      })

      if (orgError || !orgId) throw new Error(orgError?.message || 'Failed to create organization')

      // 2. Update Settings
      const { error: settingsError } = await supabase
        .from('organizations')
        .update({ settings })
        .eq('id', orgId)

      if (settingsError) console.error('Error updating settings:', settingsError)

      // 3. Insert Roles
      const roleMap = new Map<string, string>() // tempId -> realId
      for (const role of roles) {
        const { data: newRole, error: roleError } = await supabase
          .from('roles')
          .insert({
            organization_id: orgId,
            name: role.name,
            color: role.color,
          })
          .select()
          .single()
        
        if (roleError) console.error('Error creating role:', roleError)
        if (newRole) roleMap.set(role.id, newRole.id)
      }

      // 4. Insert Locations
      const locMap = new Map<string, string>() // tempId -> realId
      for (const loc of locations) {
        const { data: newLoc, error: locError } = await supabase
          .from('locations')
          .insert({
            organization_id: orgId,
            name: loc.name,
            timezone: loc.timezone,
          })
          .select()
          .single()

        if (locError) console.error('Error creating location:', locError)
        if (newLoc) locMap.set(loc.id, newLoc.id)
      }

      // 5. Insert Coverage
      for (const cov of coverages) {
        const realRoleId = roleMap.get(cov.roleId)
        const realLocId = locMap.get(cov.locationId)
        
        if (realRoleId && realLocId) {
          const inserts = cov.days.map(day => ({
            organization_id: orgId, 
            location_id: realLocId,
            role_id: realRoleId,
            day_of_week: day,
            start_time: cov.startTime,
            end_time: cov.endTime,
            min_employees: cov.minEmployees
          }))
          
          const { error: covError } = await supabase
            .from('coverage_requirements')
            .insert(inserts)
          
          if (covError) console.error('Error creating coverage:', covError)
        }
      }

      onComplete(orgId as string)

    } catch (err: any) {
      setError(err.message)
      setIsSubmitting(false)
    }
  }

  // Helper to add role
  const addRole = () => {
    if (!newRoleName.trim()) return
    setRoles([...roles, { id: Math.random().toString(), name: newRoleName, color: '#64748b' }])
    setNewRoleName('')
  }

  // Helper to add location
  const addLocation = () => {
    if (!newLocationName.trim()) return
    setLocations([...locations, { 
      id: Math.random().toString(), 
      name: newLocationName, 
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone 
    }])
    setNewLocationName('')
  }

  // Helper to add coverage
  const addCoverage = () => {
    if (!covRole || !covLocation || covDays.length === 0) return
    
    setCoverages([...coverages, {
      roleId: covRole,
      locationId: covLocation,
      minEmployees: covMin,
      startTime: covStart,
      endTime: covEnd,
      days: [...covDays].sort()
    }])
  }

  const toggleDay = (dayIndex: number) => {
    if (covDays.includes(dayIndex)) {
      setCovDays(covDays.filter(d => d !== dayIndex))
    } else {
      setCovDays([...covDays, dayIndex].sort())
    }
  }

  const selectWeekdays = () => setCovDays([1, 2, 3, 4, 5])
  const selectAllDays = () => setCovDays([0, 1, 2, 3, 4, 5, 6])
  const clearDays = () => setCovDays([])
  
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

  return (
    <div className="w-full max-w-2xl mx-auto bg-slate-900/80 border border-slate-800 rounded-2xl p-8 shadow-2xl">
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-semibold text-white">Setup Organization</h2>
          <div className="text-sm text-slate-400">Step {
            step === 'org' ? 1 : step === 'roles' ? 2 : step === 'locations' ? 3 : step === 'coverage' ? 4 : 5
          } of 5</div>
        </div>
        <div className="h-1 w-full bg-slate-800 rounded-full overflow-hidden">
          <div 
            className="h-full bg-blue-500 transition-all duration-300"
            style={{ width: step === 'org' ? '20%' : step === 'roles' ? '40%' : step === 'locations' ? '60%' : step === 'coverage' ? '80%' : '100%' }}
          />
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-200 text-sm">
          {error}
        </div>
      )}

      {step === 'org' && (
        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Organization Name</label>
            <input
              type="text"
              value={orgName}
              onChange={e => setOrgName(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-blue-500 outline-none"
              placeholder="e.g. Downtown Cafe"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Week Start Day</label>
              <select
                value={settings.week_start_day}
                onChange={e => setSettings({ ...settings, week_start_day: parseInt(e.target.value) })}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-blue-500 outline-none"
              >
                <option value={0}>Sunday</option>
                <option value={1}>Monday</option>
                <option value={2}>Tuesday</option>
                <option value={3}>Wednesday</option>
                <option value={4}>Thursday</option>
                <option value={5}>Friday</option>
                <option value={6}>Saturday</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Time Format</label>
              <select
                value={settings.time_format}
                onChange={e => setSettings({ ...settings, time_format: e.target.value as '12h' | '24h' })}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-blue-500 outline-none"
              >
                <option value="12h">12-hour (AM/PM)</option>
                <option value="24h">24-hour</option>
              </select>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-800">
            <h3 className="text-sm font-medium text-slate-400 mb-4">Regional Settings</h3>
            
            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-300 mb-2">Region / Province (If not listed, you can leave it default and apply your own rules.)</label>
              <select
                onChange={e => {
                  const val = e.target.value
                  let s = { ...settings, currency: 'CAD', enable_california_rules: false }
                  
                  switch (val) {
                    case 'AB': s = { ...s, weekly_overtime_threshold: 44, daily_overtime_threshold: 8 }; break;
                    case 'BC': s = { ...s, weekly_overtime_threshold: 40, daily_overtime_threshold: 8 }; break;
                    case 'MB': s = { ...s, weekly_overtime_threshold: 40, daily_overtime_threshold: 8 }; break;
                    case 'NB': s = { ...s, weekly_overtime_threshold: 44, daily_overtime_threshold: 24 }; break;
                    case 'NL': s = { ...s, weekly_overtime_threshold: 40, daily_overtime_threshold: 24 }; break;
                    case 'NT': s = { ...s, weekly_overtime_threshold: 40, daily_overtime_threshold: 8 }; break;
                    case 'NS': s = { ...s, weekly_overtime_threshold: 48, daily_overtime_threshold: 24 }; break;
                    case 'NU': s = { ...s, weekly_overtime_threshold: 40, daily_overtime_threshold: 8 }; break;
                    case 'ON': s = { ...s, weekly_overtime_threshold: 44, daily_overtime_threshold: 24 }; break;
                    case 'PE': s = { ...s, weekly_overtime_threshold: 48, daily_overtime_threshold: 24 }; break;
                    case 'QC': s = { ...s, weekly_overtime_threshold: 40, daily_overtime_threshold: 24 }; break;
                    case 'SK': s = { ...s, weekly_overtime_threshold: 40, daily_overtime_threshold: 8 }; break;
                    case 'YT': s = { ...s, weekly_overtime_threshold: 40, daily_overtime_threshold: 8 }; break;
                    case 'FED': s = { ...s, weekly_overtime_threshold: 40, daily_overtime_threshold: 8 }; break;
                    case 'CA': s = { ...s, weekly_overtime_threshold: 40, daily_overtime_threshold: 8, enable_california_rules: true, currency: 'USD' }; break;
                  }
                  
                  if (val !== '') setSettings(s)
                }}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                defaultValue=""
              >
                <option value="">-- Select Region --</option>
                <option value="AB">Alberta (Canada)</option>
                <option value="BC">British Columbia (Canada)</option>
                <option value="MB">Manitoba (Canada)</option>
                <option value="NB">New Brunswick (Canada)</option>
                <option value="NL">Newfoundland and Labrador (Canada)</option>
                <option value="NT">Northwest Territories (Canada)</option>
                <option value="NS">Nova Scotia (Canada)</option>
                <option value="NU">Nunavut (Canada)</option>
                <option value="ON">Ontario (Canada)</option>
                <option value="PE">Prince Edward Island (Canada)</option>
                <option value="QC">Quebec (Canada)</option>
                <option value="SK">Saskatchewan (Canada)</option>
                <option value="YT">Yukon (Canada)</option>
                <option value="FED">Federal (Canada)</option>
                <option value="CA">California (USA)</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <label className="block text-xs text-slate-400">Weekly Overtime</label>
                  <div className="group relative">
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-500 hover:text-slate-300 cursor-help"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-2 bg-slate-800 border border-slate-700 rounded shadow-xl text-xs text-slate-300 hidden group-hover:block z-50 pointer-events-none">
                      Total hours an employee can work in a week before overtime rates apply.
                    </div>
                  </div>
                </div>
                <input
                  type="number"
                  value={settings.weekly_overtime_threshold}
                  onChange={e => setSettings({ ...settings, weekly_overtime_threshold: Math.min(168, Math.max(0, parseInt(e.target.value) || 0)) })}
                  onBlur={(e) => (e.target.value = Number(e.target.value).toString())}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <label className="block text-xs text-slate-400">Daily Overtime</label>
                  <div className="group relative">
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-500 hover:text-slate-300 cursor-help"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-2 bg-slate-800 border border-slate-700 rounded shadow-xl text-xs text-slate-300 hidden group-hover:block z-50 pointer-events-none">
                      Hours an employee can work in a single day before overtime rates apply.
                    </div>
                  </div>
                </div>
                <input
                  type="number"
                  value={settings.daily_overtime_threshold}
                  onChange={e => setSettings({ ...settings, daily_overtime_threshold: Math.min(24, Math.max(0, parseInt(e.target.value) || 0)) })}
                  onBlur={(e) => (e.target.value = Number(e.target.value).toString())}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <label className="block text-xs text-slate-400">Min Rest Between Shifts</label>
                  <div className="group relative">
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-500 hover:text-slate-300 cursor-help"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-2 bg-slate-800 border border-slate-700 rounded shadow-xl text-xs text-slate-300 hidden group-hover:block z-50 pointer-events-none">
                      Minimum required hours of rest between the end of one shift and the start of the next.
                    </div>
                  </div>
                </div>
                <input
                  type="number"
                  value={settings.min_rest_period_hours}
                  onChange={e => setSettings({ ...settings, min_rest_period_hours: Math.min(168, Math.max(0, parseInt(e.target.value) || 0)) })}
                  onBlur={(e) => (e.target.value = Number(e.target.value).toString())}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm outline-none focus:border-blue-500"
                />
              </div>
              <div className="flex items-center pt-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.enable_california_rules}
                    onChange={e => setSettings({ ...settings, enable_california_rules: e.target.checked })}
                    className="rounded bg-slate-950 border-slate-700"
                  />
                  <span className="text-sm text-slate-300">Enable California Rules</span>
                </label>
                <div className="group relative ml-2 flex items-center">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-500 hover:text-slate-300 cursor-help">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="16" x2="12" y2="12"></line>
                    <line x1="12" y1="8" x2="12.01" y2="8"></line>
                  </svg>
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-3 bg-slate-800 border border-slate-700 rounded-lg shadow-xl text-xs text-slate-300 hidden group-hover:block z-50 pointer-events-none">
                    Enables specific overtime and break rules for California labor laws, including daily overtime after 8 hours, double time after 12 hours, and 7th consecutive day overtime rules.
                    <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-slate-800 border-b border-r border-slate-700 rotate-45"></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {step === 'roles' && (
        <div className="space-y-6">
          <p className="text-slate-300 text-sm">Define the roles for your employees. We've added a Manager role to start.</p>
          
          <div className="flex gap-2">
            <input
              type="text"
              value={newRoleName}
              onChange={e => setNewRoleName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addRole()}
              className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-blue-500 outline-none"
              placeholder="Add a role (e.g. Dishwasher)"
              autoFocus
            />
            <button
              onClick={addRole}
              className="px-6 py-3 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-medium transition-colors"
            >
              Add
            </button>
          </div>

          <div className="flex flex-wrap gap-3">
            {roles.map(role => (
              <div key={role.id} className="flex items-center gap-2 bg-slate-800/50 border border-slate-700 rounded-lg pl-3 pr-2 py-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: role.color }} />
                <span className="text-white text-sm">{role.name}</span>
                <button
                  onClick={() => setRoles(roles.filter(r => r.id !== role.id))}
                  className="ml-2 text-slate-500 hover:text-red-400"
                >
                  &times;
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {step === 'locations' && (
        <div className="space-y-6">
          <p className="text-slate-300 text-sm">Where do your employees work? Add at least one location.</p>
          
          <div className="flex gap-2">
            <input
              type="text"
              value={newLocationName}
              onChange={e => setNewLocationName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addLocation()}
              className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-blue-500 outline-none"
              placeholder="Add a location (e.g. West Side Branch)"
              autoFocus
            />
            <button
              onClick={addLocation}
              className="px-6 py-3 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-medium transition-colors"
            >
              Add
            </button>
          </div>

          <div className="space-y-3">
            {locations.map(loc => (
              <div key={loc.id} className="flex items-center justify-between bg-slate-800/50 border border-slate-700 rounded-lg p-4">
                <div>
                  <div className="text-white font-medium">{loc.name}</div>
                  <div className="text-xs text-slate-400">{loc.timezone}</div>
                </div>
                <button
                  onClick={() => setLocations(locations.filter(l => l.id !== loc.id))}
                  className="text-slate-500 hover:text-red-400 p-2"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {step === 'coverage' && (
        <div className="space-y-6">
          <p className="text-slate-300 text-sm">
            (Optional) Set basic coverage requirements. You can fine-tune these later.
          </p>

          <div className="bg-slate-800/30 p-4 rounded-lg border border-slate-800">
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Role</label>
                <select 
                  value={covRole}
                  onChange={e => setCovRole(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
                >
                  {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Location</label>
                <select 
                  value={covLocation}
                  onChange={e => setCovLocation(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
                >
                  {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </div>
            </div>

            <div className="mb-4">
              <div className="flex justify-between items-end mb-2">
                <label className="block text-xs text-slate-400">Days</label>
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
                      covDays.includes(i)
                        ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/20'
                        : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
                    }`}
                  >
                    {day.slice(0, 3)}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 mb-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Start</label>
                <input
                  type="time"
                  value={covStart}
                  onChange={e => setCovStart(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">End</label>
                <input
                  type="time"
                  value={covEnd}
                  onChange={e => setCovEnd(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Min Staff</label>
                <input
                  type="number"
                  min="1"
                  value={covMin}
                  onChange={e => setCovMin(parseInt(e.target.value))}
                  onBlur={(e) => (e.target.value = Number(e.target.value).toString())}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
                />
              </div>
            </div>
            
            <button
              onClick={addCoverage}
              disabled={!covRole || !covLocation || covDays.length === 0}
              className="w-full py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 text-white rounded-lg text-sm font-medium transition-colors"
            >
              Add Rule
            </button>
          </div>

          <div className="space-y-2">
            {coverages.map((cov, idx) => {
              const r = roles.find(x => x.id === cov.roleId)
              const l = locations.find(x => x.id === cov.locationId)
              return (
                <div key={idx} className="flex items-center justify-between bg-slate-800/50 border border-slate-700 rounded p-3 text-sm">
                  <div>
                    <div className="text-white font-medium">{r?.name} at {l?.name}</div>
                    <div className="text-xs text-slate-400">
                      {cov.days.map(d => days[d].slice(0, 3)).join(', ')} • {cov.startTime}-{cov.endTime} • {cov.minEmployees} staff
                    </div>
                  </div>
                  <button onClick={() => setCoverages(coverages.filter((_, i) => i !== idx))} className="text-slate-500 hover:text-red-400">&times;</button>
                </div>
              )
            })}
            {coverages.length === 0 && (
              <div className="text-center text-slate-500 text-xs italic py-2">No rules added yet</div>
            )}
          </div>
        </div>
      )}

      {step === 'review' && (
        <div className="space-y-6">
          <h3 className="text-lg font-medium text-white">Review & Create</h3>
          
          <div className="space-y-4 text-sm">
            <div className="bg-slate-800/30 rounded-lg p-4 border border-slate-800">
              <div className="text-slate-400 text-xs uppercase tracking-wider mb-1">Organization</div>
              <div className="text-white font-medium text-lg">{orgName}</div>
              <div className="text-slate-400 mt-1">
                Week starts {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][settings.week_start_day]} • {settings.time_format} format
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-800/30 rounded-lg p-4 border border-slate-800">
                <div className="text-slate-400 text-xs uppercase tracking-wider mb-2">Roles ({roles.length})</div>
                <div className="flex flex-wrap gap-2">
                  {roles.map(r => (
                    <span key={r.id} className="bg-slate-700 text-slate-200 px-2 py-1 rounded text-xs">{r.name}</span>
                  ))}
                </div>
              </div>

              <div className="bg-slate-800/30 rounded-lg p-4 border border-slate-800">
                <div className="text-slate-400 text-xs uppercase tracking-wider mb-2">Locations ({locations.length})</div>
                <div className="space-y-1">
                  {locations.map(l => (
                    <div key={l.id} className="text-slate-200 text-xs">{l.name}</div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-between mt-8 pt-6 border-t border-slate-800">
        {step !== 'org' ? (
          <button
            onClick={handleBack}
            className="px-6 py-2 text-slate-400 hover:text-white font-medium transition-colors"
          >
            Back
          </button>
        ) : (
          <div />
        )}
        
        {step === 'review' ? (
          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="px-8 py-3 bg-emerald-500 hover:bg-emerald-400 text-white rounded-xl font-bold shadow-lg shadow-emerald-500/20 transition-all hover:translate-y-[-1px] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? 'Creating Organization...' : 'Launch Dashboard'}
          </button>
        ) : (
          <button
            onClick={handleNext}
            className="px-8 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold shadow-lg shadow-blue-600/20 transition-all hover:translate-y-[-1px]"
          >
            Next Step
          </button>
        )}
      </div>
    </div>
  )
}
