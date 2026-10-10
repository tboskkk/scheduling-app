import { useEffect, useState } from 'react'
import RolesManager from '../components/RolesManager'
import QuickShiftsManager from '../components/QuickShiftsManager'
import { useOrganizationStore } from '../lib/useOrganizationStore'
import type { OrganizationSettings } from '../types'

function SettingsPage() {
  const { organization, fetchOrganization, updateSettings, isLoading, error } = useOrganizationStore()
  const [localSettings, setLocalSettings] = useState<OrganizationSettings | null>(organization?.settings ?? null)
  const [syncedOrganization, setSyncedOrganization] = useState(organization)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    fetchOrganization()
  }, [fetchOrganization])

  // Reset the local edits whenever the stored organization changes (adjusting state during render)
  if (organization !== syncedOrganization) {
    setSyncedOrganization(organization)
    if (organization) {
      setLocalSettings(organization.settings)
    }
  }

  const handleChange = <K extends keyof OrganizationSettings>(key: K, value: OrganizationSettings[K]) => {
    if (!localSettings) return
    setLocalSettings({ ...localSettings, [key]: value })
  }

  const handleSave = async () => {
    if (!localSettings) return
    setIsSaving(true)
    await updateSettings(localSettings)
    setIsSaving(false)
  }

  if (isLoading && !organization) {
    return <div className="text-slate-400">Loading settings...</div>
  }

  if (error) {
    return <div className="text-red-400">Error: {error}</div>
  }

  return (
    <div className="space-y-8" style={{ transform: 'translateZ(0)' }}>
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-6" style={{ transform: 'translateZ(0)' }}>
        <div className="flex justify-between items-start mb-6">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Settings</p>
            <h2 className="text-2xl font-semibold text-white">Organization settings</h2>
            <p className="text-sm text-slate-300 mt-1">
              Configure compliance thresholds and overtime rules.
            </p>
          </div>
          <button
            onClick={handleSave}
            disabled={isSaving || !localSettings}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-md text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isSaving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>

        {localSettings && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="col-span-1 md:col-span-2 mb-2 p-4 bg-slate-800 rounded-lg border border-slate-700">
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Quick Setup: Region / Province
              </label>
              <select
                onChange={(e) => {
                  const val = e.target.value
                  let s = { ...localSettings, currency: 'CAD', enable_california_rules: false }
                  
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
                  
                  if (val !== '') setLocalSettings(s)
                }}
                className="w-full bg-slate-900 border border-slate-600 rounded-md px-3 py-2 text-white focus:outline-hidden focus:ring-2 focus:ring-blue-500"
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

            <div className="space-y-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <label className="block text-sm font-medium text-slate-300">
                    Weekly Overtime Threshold (Hours)
                  </label>
                  <div className="group relative">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-500 hover:text-slate-300 cursor-help"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-2 bg-slate-800 border border-slate-700 rounded-sm shadow-xl text-xs text-slate-300 hidden group-hover:block z-50 pointer-events-none">
                      Total hours an employee can work in a week before overtime rates apply.
                    </div>
                  </div>
                </div>
                <input
                  type="number"
                  value={localSettings.weekly_overtime_threshold}
                  onChange={(e) => handleChange('weekly_overtime_threshold', Math.min(168, Math.max(0, Number(e.target.value))))}
                  onBlur={(e) => (e.target.value = Number(e.target.value).toString())}
                  disabled={localSettings.enable_california_rules}
                  className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-white focus:outline-hidden focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                />
                <p className="text-xs text-slate-500 mt-1">
                  Shifts that push the weekly total over this amount will be flagged.
                </p>
              </div>

              <div>
                <div className="flex items-center gap-2 mb-1">
                  <label className="block text-sm font-medium text-slate-300">
                    Daily Overtime Threshold (Hours)
                  </label>
                  <div className="group relative">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-500 hover:text-slate-300 cursor-help"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-2 bg-slate-800 border border-slate-700 rounded-sm shadow-xl text-xs text-slate-300 hidden group-hover:block z-50 pointer-events-none">
                      Hours an employee can work in a single day before overtime rates apply.
                    </div>
                  </div>
                </div>
                <input
                  type="number"
                  value={localSettings.daily_overtime_threshold}
                  onChange={(e) => handleChange('daily_overtime_threshold', Math.min(24, Math.max(0, Number(e.target.value))))}
                  onBlur={(e) => (e.target.value = Number(e.target.value).toString())}
                  disabled={localSettings.enable_california_rules}
                  className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-white focus:outline-hidden focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                />
                <p className="text-xs text-slate-500 mt-1">
                  Shifts longer than this duration will be flagged.
                </p>
              </div>

              <div>
                <div className="flex items-center gap-2 mb-1">
                  <label className="block text-sm font-medium text-slate-300">
                    Minimum Rest Period (Hours)
                  </label>
                  <div className="group relative">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-500 hover:text-slate-300 cursor-help"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-2 bg-slate-800 border border-slate-700 rounded-sm shadow-xl text-xs text-slate-300 hidden group-hover:block z-50 pointer-events-none">
                      Minimum required hours of rest between the end of one shift and the start of the next.
                    </div>
                  </div>
                </div>
                <input
                  type="number"
                  value={localSettings.min_rest_period_hours}
                  onChange={(e) => handleChange('min_rest_period_hours', Math.min(168, Math.max(0, Number(e.target.value))))}
                  onBlur={(e) => (e.target.value = Number(e.target.value).toString())}
                  className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-white focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-slate-500 mt-1">
                  Minimum hours required between the end of one shift and the start of the next.
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">
                  Week Start Day
                </label>
                <select
                  value={localSettings.week_start_day}
                  onChange={(e) => handleChange('week_start_day', Number(e.target.value))}
                  className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-white focus:outline-hidden focus:ring-2 focus:ring-blue-500"
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
                <label className="block text-sm font-medium text-slate-300 mb-1">
                  Time Display Format
                </label>
                <select
                  value={localSettings.time_format}
                  onChange={(e) => handleChange('time_format', e.target.value as OrganizationSettings['time_format'])}
                  className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-white focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                >
                  <option value="12h">12-hour (5:00 PM)</option>
                  <option value="24h">24-hour (17:00)</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">
                  Currency
                </label>
                <select
                  value={localSettings.currency || 'CAD'}
                  onChange={(e) => handleChange('currency', e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-white focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                >
                  <option value="CAD">CAD ($)</option>
                  <option value="USD">USD ($)</option>
                  <option value="EUR">EUR (€)</option>
                  <option value="GBP">GBP (£)</option>
                  <option value="AUD">AUD ($)</option>
                </select>
              </div>

              <div className="pt-6">
                <div className="flex items-center">
                  <label className="flex items-center space-x-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={localSettings.enable_california_rules}
                      onChange={(e) => {
                        const enabled = e.target.checked
                        handleChange('enable_california_rules', enabled)
                        if (enabled) {
                          handleChange('weekly_overtime_threshold', 40)
                          handleChange('daily_overtime_threshold', 8)
                        }
                      }}
                      className="w-5 h-5 rounded-sm border-slate-700 bg-slate-800 text-blue-600 focus:ring-blue-500 focus:ring-offset-slate-900"
                    />
                    <div>
                      <span className="block text-sm font-medium text-white">Enable California Overtime Rules</span>
                      <span className="block text-xs text-slate-400">
                        Enforces 8h daily and 40h weekly overtime limits simultaneously.
                      </span>
                    </div>
                  </label>
                  <div className="group relative ml-2">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-500 hover:text-slate-300 cursor-help">
                      <circle cx="12" cy="12" r="10"></circle>
                      <line x1="12" y1="16" x2="12" y2="12"></line>
                      <line x1="12" y1="8" x2="12.01" y2="8"></line>
                    </svg>
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-3 bg-slate-800 border border-slate-700 rounded-lg shadow-xl text-xs text-slate-300 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50 pointer-events-none">
                      Enables specific overtime and break rules for California labor laws, including daily overtime after 8 hours, double time after 12 hours, and 7th consecutive day overtime rules.
                      <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-slate-800 border-b border-r border-slate-700 rotate-45 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200"></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
        <QuickShiftsManager 
          quickShifts={localSettings?.quick_shifts || []}
          onChange={async (quickShifts) => {
            if (!localSettings) return
            const updated = { ...localSettings, quick_shifts: quickShifts }
            setLocalSettings(updated)
            await updateSettings(updated)
          }}
        />
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
        <h2 className="text-xl font-semibold text-white mb-4">Roles Management</h2>
        <p className="text-sm text-slate-300 mb-6">
          Create and manage roles that can be assigned to employees and shifts.
        </p>
        <RolesManager />
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
        <h2 className="text-xl font-semibold text-white mb-4">Data Privacy & Compliance</h2>
        <p className="text-sm text-slate-300 mb-6">
          Manage your data and account settings.
        </p>
        
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-slate-800 rounded-lg border border-slate-700">
            <div>
              <h3 className="text-sm font-medium text-white">Download Your Data</h3>
              <p className="text-xs text-slate-400 mt-1">
                Download a copy of all your organization's data in JSON format.
              </p>
            </div>
            <button
              onClick={() => {
                // Mock download
                const data = JSON.stringify(localSettings, null, 2);
                const blob = new Blob([data], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'organization-data.json';
                a.click();
                URL.revokeObjectURL(url);
              }}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-md text-sm font-medium transition-colors"
            >
              Download Data
            </button>
          </div>

          <div className="flex items-center justify-between p-4 bg-red-900/10 rounded-lg border border-red-900/30">
            <div>
              <h3 className="text-sm font-medium text-red-200">Delete Account</h3>
              <p className="text-xs text-red-300/70 mt-1">
                Permanently delete your account and all associated data. This action cannot be undone.
              </p>
            </div>
            <button
              onClick={() => {
                if (window.confirm('Are you sure you want to delete your account? This action cannot be undone.')) {
                  // Mock delete
                  alert('Account deletion request received. Please contact support to complete this process.');
                }
              }}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-md text-sm font-medium transition-colors"
            >
              Delete Account
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default SettingsPage
