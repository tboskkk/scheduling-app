import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient'
import { useOrganizationStore } from '../lib/useOrganizationStore'
import { formatTimeLabel } from './schedule/time'
import type { EmployeeRecord, RoleRecord } from './EmployeesManager'
import type { LocationRecord } from './LocationsManager'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

type EmployeeFormState = {
  name: string
  email: string
  phone: string
  hourlyRate: string
  homeLocationId: string
  roleIds: Set<string>
  isFloating: boolean
  isActive: boolean
}

type AvailabilityState = {
  selectedDays: number[]
  start: string
  end: string
}

type UnavailabilityState = {
  start: string
  end: string
}

type AvailabilityResult = {
  recurring: {
    id: string
    day_of_week: number
    start_time: string
    end_time: string
  }[]
  oneOff: {
    id: string
    start_datetime: string
    end_datetime: string
  }[]
}

const emptyEmployeeForm = (): EmployeeFormState => ({
  name: '',
  email: '',
  phone: '',
  hourlyRate: '',
  homeLocationId: '',
  roleIds: new Set(),
  isFloating: false,
  isActive: true,
})

const emptyAvailabilityForm = (): AvailabilityState => ({
  selectedDays: [1, 2, 3, 4, 5], // Default to weekdays
  start: '09:00',
  end: '17:00'
})

const emptyUnavailabilityForm = (): UnavailabilityState => {
  const now = new Date()
  const inOneHour = new Date(now.getTime() + 60 * 60 * 1000)
  const toInput = (date: Date) => date.toISOString().slice(0, 16)
  return { start: toInput(now), end: toInput(inOneHour) }
}

type AddEditEmployeeDialogProps = {
  isOpen: boolean
  onClose: () => void
  employee: EmployeeRecord | null
  organizationId: string
  locations: LocationRecord[]
  roles: RoleRecord[]
  currency: string
  onSaved: (employee: EmployeeRecord) => void
  initialTab?: 'details' | 'availability'
}

function AddEditEmployeeDialog({ 
  isOpen, 
  onClose, 
  employee, 
  organizationId, 
  locations, 
  roles, 
  currency,
  onSaved,
  initialTab = 'details'
}: AddEditEmployeeDialogProps) {
  const queryClient = useQueryClient()
  const { organization } = useOrganizationStore()
  const [activeTab, setActiveTab] = useState<'details' | 'availability'>(initialTab)
  const [formState, setFormState] = useState<EmployeeFormState>(emptyEmployeeForm())
  const [availabilityForm, setAvailabilityForm] = useState<AvailabilityState>(emptyAvailabilityForm())
  const [unavailabilityForm, setUnavailabilityForm] = useState<UnavailabilityState>(emptyUnavailabilityForm())
  const [error, setError] = useState<string | null>(null)
  const [availabilityError, setAvailabilityError] = useState<string | null>(null)

  const timeFormat = organization?.settings?.time_format || '12h'
  const [isSaving, setIsSaving] = useState(false)
  const [inviteStatus, setInviteStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [inviteError, setInviteError] = useState<string | null>(null)

  const isEditing = Boolean(employee)

  // Query for availability data when editing an employee
  const { data: availabilityData, isLoading: isAvailabilityLoading, error: availabilityFetchError } = useQuery<AvailabilityResult | null>({
    queryKey: ['availability', employee?.id],
    queryFn: async () => {
      if (!employee) return null
      const [recurringRes, oneOffRes] = await Promise.all([
        supabase
          .from('employee_availability')
          .select('id, day_of_week, start_time, end_time')
          .eq('employee_id', employee.id)
          .order('day_of_week', { ascending: true }),
        supabase
          .from('employee_unavailability')
          .select('id, start_datetime, end_datetime')
          .eq('employee_id', employee.id)
          .order('start_datetime', { ascending: true }),
      ])

      if (recurringRes.error) throw new Error(recurringRes.error.message)
      if (oneOffRes.error) throw new Error(oneOffRes.error.message)

      return {
        recurring: recurringRes.data || [],
        oneOff: oneOffRes.data || [],
      }
    },
    enabled: Boolean(employee?.id),
  })

  // Availability mutations
  const addAvailability = useMutation({
    mutationFn: async () => {
      if (!employee || availabilityForm.selectedDays.length === 0) return
      
      const newAvailabilityEntries = availabilityForm.selectedDays.map(day => ({
        organization_id: organizationId,
        employee_id: employee.id,
        day_of_week: day,
        start_time: availabilityForm.start,
        end_time: availabilityForm.end,
      }))

      const { error } = await supabase.from('employee_availability').insert(newAvailabilityEntries)
      if (error) throw new Error(error.message)
    },
    onSuccess: async () => {
      setAvailabilityForm(emptyAvailabilityForm())
      await queryClient.invalidateQueries({ queryKey: ['availability', employee?.id] })
    },
  })

  const deleteAvailabilityEntry = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('employee_availability').delete().eq('id', id)
      if (error) throw new Error(error.message)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['availability', employee?.id] })
    },
  })

  const addUnavailability = useMutation({
    mutationFn: async () => {
      if (!employee) return
      const { error } = await supabase.from('employee_unavailability').insert({
        organization_id: organizationId,
        employee_id: employee.id,
        start_datetime: new Date(unavailabilityForm.start).toISOString(),
        end_datetime: new Date(unavailabilityForm.end).toISOString(),
      })
      if (error) throw new Error(error.message)
    },
    onSuccess: async () => {
      setUnavailabilityForm(emptyUnavailabilityForm())
      await queryClient.invalidateQueries({ queryKey: ['availability', employee?.id] })
    },
  })

  const deleteUnavailabilityEntry = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('employee_unavailability').delete().eq('id', id)
      if (error) throw new Error(error.message)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['availability', employee?.id] })
    },
  })

  useEffect(() => {
    if (!isOpen) return
    
    setError(null)
    setAvailabilityError(null)
    setInviteStatus('idle')
    setInviteError(null)
    setActiveTab(initialTab)
    
    if (employee) {
      // Populate form with existing employee data
      setFormState({
        name: employee.name || '',
        email: employee.email || '',
        phone: employee.phone || '',
        hourlyRate: employee.hourly_rate?.toString() || '',
        homeLocationId: employee.home_location_id || '',
        roleIds: new Set(employee.role_ids || []),
        isFloating: employee.is_floating || false,
        isActive: employee.is_active !== false,
      })
    } else {
      // Reset form for new employee
      setFormState(emptyEmployeeForm())
    }
    
    // Reset availability forms
    setAvailabilityForm(emptyAvailabilityForm())
    setUnavailabilityForm(emptyUnavailabilityForm())
  }, [isOpen, employee, initialTab])

  if (!isOpen) return null

  const toggleRole = (roleId: string) => {
    setFormState((prev) => {
      const newRoleIds = new Set(prev.roleIds)
      if (newRoleIds.has(roleId)) {
        newRoleIds.delete(roleId)
      } else {
        newRoleIds.add(roleId)
      }
      return { ...prev, roleIds: newRoleIds }
    })
  }

  const canSubmit = formState.name.trim().length > 0 && !isSaving

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!canSubmit) return

    setError(null)
    setIsSaving(true)

    try {
      const employeeData = {
        name: formState.name.trim(),
        email: formState.email.trim() || null,
        phone: formState.phone.trim() || null,
        hourly_rate: formState.hourlyRate ? parseFloat(formState.hourlyRate) : null,
        home_location_id: formState.homeLocationId || null,
        is_floating: formState.isFloating,
        is_active: formState.isActive,
        organization_id: organizationId,
      }

      let savedEmployeeId: string
      let result
      if (isEditing && employee) {
        const { data, error } = await supabase
          .from('employees')
          .update(employeeData)
          .eq('id', employee.id)
          .select()
          .single()
        result = { data, error }
        savedEmployeeId = employee.id
      } else {
        const { data, error } = await supabase
          .from('employees')
          .insert(employeeData)
          .select()
          .single()
        result = { data, error }
        savedEmployeeId = result.data?.id
      }

      if (result.error) throw new Error(result.error.message)
      if (!result.data) throw new Error('No data returned')

      // Sync role assignments via employee_roles join table
      const newRoleIds = Array.from(formState.roleIds)
      const { error: deleteRolesError } = await supabase
        .from('employee_roles')
        .delete()
        .eq('employee_id', savedEmployeeId)
      if (deleteRolesError) throw new Error(deleteRolesError.message)

      if (newRoleIds.length > 0) {
        const { error: insertRolesError } = await supabase
          .from('employee_roles')
          .insert(newRoleIds.map((roleId) => ({
            employee_id: savedEmployeeId,
            role_id: roleId,
          })))
        if (insertRolesError) throw new Error(insertRolesError.message)
      }

      onSaved({ ...result.data, role_ids: newRoleIds } as EmployeeRecord)
      onClose()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to save employee')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-4xl max-h-[90vh] overflow-hidden rounded-xl border border-slate-800 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between p-6 border-b border-slate-800">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
              {isEditing ? 'Edit Employee' : 'Add Employee'}
            </p>
            <h3 className="mt-1 text-xl font-semibold text-white">
              {isEditing ? employee?.name : 'New Employee'}
            </h3>
            <p className="text-sm text-slate-300">
              {isEditing 
                ? 'Employee details and availability settings.' 
                : 'Employee details. Availability can be set after creation.'
              }
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-100 transition hover:border-slate-500"
          >
            Close
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-800">
          <button
            type="button"
            onClick={() => setActiveTab('details')}
            className={`px-6 py-3 text-sm font-semibold transition ${
              activeTab === 'details'
                ? 'border-b-2 border-emerald-400 text-emerald-100 bg-slate-800/50'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Employee Details
          </button>
          {isEditing && (
            <button
              type="button"
              onClick={() => setActiveTab('availability')}
              className={`px-6 py-3 text-sm font-semibold transition ${
                activeTab === 'availability'
                  ? 'border-b-2 border-emerald-400 text-emerald-100 bg-slate-800/50'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Availability
            </button>
          )}
        </div>

        <div className="overflow-y-auto max-h-[calc(90vh-140px)]">
          {activeTab === 'details' ? (
            <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-semibold text-slate-100">Name</label>
                <input
                  type="text"
                  value={formState.name}
                  onChange={(e) => setFormState((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="Taylor Manager"
                  required
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-slate-100 outline-none ring-2 ring-transparent transition focus:border-slate-500 focus:ring-slate-600"
                />
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-sm font-semibold text-slate-100">Email</span>
                  <input
                    type="email"
                    value={formState.email}
                    onChange={(e) => setFormState((prev) => ({ ...prev, email: e.target.value }))}
                    placeholder="taylor@example.com"
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-slate-100 outline-none ring-2 ring-transparent transition focus:border-slate-500 focus:ring-slate-600"
                  />
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-semibold text-slate-100">Phone</span>
                  <input
                    type="tel"
                    value={formState.phone}
                    onChange={(e) => setFormState((prev) => ({ ...prev, phone: e.target.value }))}
                    placeholder="(555) 123-4567"
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-slate-100 outline-none ring-2 ring-transparent transition focus:border-slate-500 focus:ring-slate-600"
                  />
                </label>
              </div>

              {/* Portal invite — only shown when editing an existing employee */}
              {isEditing && employee && (
                <div className="rounded-lg border border-slate-700 bg-slate-950/60 px-4 py-3 space-y-2">
                  <p className="text-sm font-semibold text-slate-100">Employee Portal Access</p>
                  {employee.user_id ? (
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-300">
                        <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg>
                        Portal access active
                      </span>
                    </div>
                  ) : employee.email ? (
                    <div className="space-y-2">
                      <p className="text-xs text-slate-400">This employee has no portal account yet. Send an invite to {employee.email}.</p>
                      {inviteStatus === 'sent' ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-500/40 bg-blue-500/10 px-2.5 py-1 text-xs font-semibold text-blue-300">
                          Invite sent ✓
                        </span>
                      ) : (
                        <button
                          type="button"
                          disabled={inviteStatus === 'sending'}
                          onClick={async () => {
                            setInviteStatus('sending')
                            setInviteError(null)
                            const { error } = await supabase.functions.invoke('invite-employee', {
                              body: { employee_id: employee.id },
                            })
                            if (error) {
                              setInviteStatus('error')
                              // Try to extract the actual error message from the response body
                              let msg = error.message || 'Failed to send invite'
                              try {
                                // FunctionsHttpError has a context property with the raw Response
                                const ctx = (error as unknown as { context?: Response }).context
                                if (ctx) {
                                  const body = await ctx.json()
                                  if (body?.error) msg = body.error
                                }
                              } catch { /* ignore parse errors */ }
                              setInviteError(msg)
                            } else {
                              setInviteStatus('sent')
                            }
                          }}
                          className="rounded-lg border border-blue-500/50 px-3 py-1.5 text-xs font-semibold text-blue-300 hover:bg-blue-500/10 transition disabled:opacity-50"
                        >
                          {inviteStatus === 'sending' ? 'Sending…' : 'Send invite email'}
                        </button>
                      )}
                      {inviteStatus === 'error' && inviteError && (
                        <p className="text-xs text-red-400">{inviteError}</p>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500">Add an email address to enable portal invite.</p>
                  )}
                </div>
              )}

              <div className="grid gap-3 md:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-sm font-semibold text-slate-100">Hourly rate ({currency})</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={formState.hourlyRate}
                    onChange={(e) => setFormState((prev) => ({ ...prev, hourlyRate: e.target.value.replace(/^0+(?=\d)/, '') }))}
                    placeholder="18.50"
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-slate-100 outline-none ring-2 ring-transparent transition focus:border-slate-500 focus:ring-slate-600"
                  />
                </label>

                <label className="space-y-2">
                  <span className="text-sm font-semibold text-slate-100">Home location</span>
                  <select
                    value={formState.homeLocationId}
                    onChange={(e) => setFormState((prev) => ({ ...prev, homeLocationId: e.target.value }))}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-slate-100 outline-none ring-2 ring-transparent transition focus:border-slate-500 focus:ring-slate-600"
                  >
                    <option value="">Unassigned</option>
                    {locations?.map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="space-y-3">
                <p className="text-sm font-semibold text-slate-100">Roles</p>
                <div className="flex flex-wrap gap-3">
                  {roles?.map((role) => (
                    <label key={role.id} className="flex items-center gap-2 text-sm font-semibold text-slate-200">
                      <input
                        type="checkbox"
                        checked={formState.roleIds.has(role.id)}
                        onChange={() => toggleRole(role.id)}
                        className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-emerald-400"
                      />
                      <span 
                        className="rounded-full border border-slate-700 px-2 py-[2px] text-[12px] font-semibold" 
                        style={{ color: role.color || '#cbd5e1', borderColor: role.color || '#334155' }}
                      >
                        {role.name}
                      </span>
                    </label>
                  ))}
                  {!roles?.length && <p className="text-xs text-slate-400">Create roles first to assign them.</p>}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-4 text-sm font-semibold text-slate-100">
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formState.isFloating}
                    onChange={(e) => setFormState((prev) => ({ ...prev, isFloating: e.target.checked }))}
                    className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-emerald-400"
                  />
                  Floating employee (can work any location)
                </label>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formState.isActive}
                    onChange={(e) => setFormState((prev) => ({ ...prev, isActive: e.target.checked }))}
                    className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-emerald-400"
                  />
                  Active
                </label>
              </div>

              {error && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                  {error}
                </div>
              )}

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="submit"
                  disabled={!canSubmit}
                  className="rounded-lg bg-emerald-400 px-4 py-3 text-sm font-semibold text-emerald-950 transition hover:translate-y-[-1px] hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {isSaving ? 'Saving…' : isEditing ? 'Save changes' : 'Create employee'}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg border border-slate-700 px-4 py-3 text-sm font-semibold text-slate-100 transition hover:border-slate-500"
                >
                  Cancel
                </button>
              </div>

              {!isEditing && (
                <div className="mt-6 rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-3 text-sm text-blue-200">
                  <p className="font-semibold">💡 Availability Settings</p>
                  <p className="mt-1">You can set up availability schedules after creating the employee. Click "Availability" from the employee list to manage their schedule.</p>
                </div>
              )}
            </form>
          ) : (
            <div className="p-4 sm:p-6 space-y-6">
              {(availabilityError || availabilityFetchError) && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                  {availabilityError || availabilityFetchError?.message}
                </div>
              )}

              <div className="grid gap-6 lg:grid-cols-2">
                {/* Recurring Availability */}
                <div className="space-y-4 rounded-lg border border-slate-800 bg-slate-950/60 p-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-slate-100">Recurring weekly</h4>
                    <button
                      type="button"
                      disabled={availabilityForm.selectedDays.length === 0}
                      onClick={async () => {
                        setAvailabilityError(null)
                        try {
                          await addAvailability.mutateAsync()
                        } catch (error) {
                          setAvailabilityError(error instanceof Error ? error.message : 'Unable to add availability')
                        }
                      }}
                      className="rounded-lg border border-emerald-500/60 px-3 py-2 text-xs font-semibold text-emerald-100 transition hover:border-emerald-300 disabled:border-slate-600 disabled:text-slate-500 disabled:cursor-not-allowed"
                    >
                      Add availability
                    </button>
                  </div>

                  <div className="space-y-4">
                    {/* Day Selection */}
                    <div>
                      <div className="flex justify-between items-end mb-2">
                        <label className="block text-xs font-medium text-slate-400 uppercase tracking-wider">Days</label>
                        <div className="flex gap-2 text-[10px]">
                          <button 
                            type="button" 
                            onClick={() => setAvailabilityForm(prev => ({ ...prev, selectedDays: [1, 2, 3, 4, 5] }))} 
                            className="text-emerald-400 hover:text-emerald-300"
                          >
                            Weekdays
                          </button>
                          <span className="text-slate-600">|</span>
                          <button 
                            type="button" 
                            onClick={() => setAvailabilityForm(prev => ({ ...prev, selectedDays: [0, 1, 2, 3, 4, 5, 6] }))} 
                            className="text-emerald-400 hover:text-emerald-300"
                          >
                            All
                          </button>
                          <span className="text-slate-600">|</span>
                          <button 
                            type="button" 
                            onClick={() => setAvailabilityForm(prev => ({ ...prev, selectedDays: [] }))} 
                            className="text-slate-500 hover:text-slate-400"
                          >
                            None
                          </button>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {DAYS.map((day, i) => (
                          <button
                            key={i}
                            type="button"
                            onClick={() => {
                              const newDays = availabilityForm.selectedDays.includes(i)
                                ? availabilityForm.selectedDays.filter(d => d !== i)
                                : [...availabilityForm.selectedDays, i].sort()
                              setAvailabilityForm(prev => ({ ...prev, selectedDays: newDays }))
                            }}
                            className={`px-2.5 py-1.5 rounded text-xs font-medium transition-all ${
                              availabilityForm.selectedDays.includes(i)
                                ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-900/20'
                                : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
                            }`}
                          >
                            {day}
                          </button>
                        ))}
                      </div>
                      {availabilityForm.selectedDays.length === 0 && (
                        <p className="text-xs text-red-400 mt-1">Please select at least one day</p>
                      )}
                    </div>

                    {/* Time Range */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">Start Time</label>
                        <input
                          type="time"
                          value={availabilityForm.start}
                          onChange={(e) => setAvailabilityForm((prev) => ({ ...prev, start: e.target.value }))}
                          className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none ring-2 ring-transparent transition focus:border-slate-500 focus:ring-slate-600"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">End Time</label>
                        <input
                          type="time"
                          value={availabilityForm.end}
                          onChange={(e) => setAvailabilityForm((prev) => ({ ...prev, end: e.target.value }))}
                          className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none ring-2 ring-transparent transition focus:border-slate-500 focus:ring-slate-600"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2 text-sm">
                    {isAvailabilityLoading && (
                      <p className="text-xs text-slate-400">Loading availability…</p>
                    )}
                    {!isAvailabilityLoading &&
                      (availabilityData?.recurring || []).map((window) => (
                        <div
                          key={window.id}
                          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2"
                        >
                          <div className="text-slate-100">
                            <span className="font-semibold">{DAYS[window.day_of_week]}</span>
                            <span className="ml-2 text-slate-300">
                              {window.start_time} – {window.end_time}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => deleteAvailabilityEntry.mutate(window.id)}
                            className="rounded-lg border border-red-500/60 px-3 py-2 text-xs font-semibold text-red-100 transition hover:border-red-400"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    {!isAvailabilityLoading && !availabilityData?.recurring?.length && (
                      <p className="text-xs text-slate-400">No recurring availability yet.</p>
                    )}
                  </div>
                </div>

                {/* Date-specific Unavailability */}
                <div className="space-y-4 rounded-lg border border-slate-800 bg-slate-950/60 p-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-slate-100">Date-specific unavailability</h4>
                    <button
                      type="button"
                      onClick={async () => {
                        setAvailabilityError(null)
                        try {
                          await addUnavailability.mutateAsync()
                        } catch (error) {
                          setAvailabilityError(error instanceof Error ? error.message : 'Unable to add unavailability')
                        }
                      }}
                      className="rounded-lg border border-amber-500/60 px-3 py-2 text-xs font-semibold text-amber-100 transition hover:border-amber-300"
                    >
                      Add block
                    </button>
                  </div>

                  <div className="grid grid-cols-1 gap-2 text-sm">
                    <input
                      type="datetime-local"
                      value={unavailabilityForm.start}
                      onChange={(e) => setUnavailabilityForm((prev) => ({ ...prev, start: e.target.value }))}
                      className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none ring-2 ring-transparent transition focus:border-slate-500 focus:ring-slate-600"
                    />
                    <input
                      type="datetime-local"
                      value={unavailabilityForm.end}
                      onChange={(e) => setUnavailabilityForm((prev) => ({ ...prev, end: e.target.value }))}
                      className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none ring-2 ring-transparent transition focus:border-slate-500 focus:ring-slate-600"
                    />
                  </div>

                  <div className="space-y-2 text-sm">
                    {isAvailabilityLoading && (
                      <p className="text-xs text-slate-400">Loading unavailability…</p>
                    )}
                    {!isAvailabilityLoading &&
                      (availabilityData?.oneOff || []).map((item) => (
                        <div
                          key={item.id}
                          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2"
                        >
                          <div className="text-slate-100">
                            <span className="font-semibold">{formatTimeLabel(item.start_datetime, null, timeFormat)}</span>
                            <span className="ml-2 text-slate-300">→ {formatTimeLabel(item.end_datetime, null, timeFormat)}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => deleteUnavailabilityEntry.mutate(item.id)}
                            className="rounded-lg border border-red-500/60 px-3 py-2 text-xs font-semibold text-red-100 transition hover:border-red-400"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    {!isAvailabilityLoading && !availabilityData?.oneOff?.length && (
                      <p className="text-xs text-slate-400">No date-specific unavailability yet.</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default AddEditEmployeeDialog