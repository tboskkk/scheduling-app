import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient'
import { useOrganizationStore } from '../lib/useOrganizationStore'
import type { LocationRecord } from './LocationsManager'

export type RoleRecord = {
  id: string
  name: string
  color: string | null
}

export type EmployeeRecord = {
  id: string
  name: string
  email: string | null
  phone: string | null
  hourly_rate: number | null
  home_location_id: string | null
  is_floating: boolean
  is_active: boolean
  created_at: string
  role_ids: string[]
}

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
  dayOfWeek: string
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

type Props = {
  organizationId: string
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const CURRENCY_SYMBOLS: Record<string, string> = {
  CAD: '$',
  USD: '$',
  EUR: '€',
  GBP: '£',
  AUD: '$',
}

function emptyEmployeeForm(): EmployeeFormState {
  return {
    name: '',
    email: '',
    phone: '',
    hourlyRate: '',
    homeLocationId: '',
    roleIds: new Set<string>(),
    isFloating: false,
    isActive: true,
  }
}

function emptyAvailabilityForm(): AvailabilityState {
  return { dayOfWeek: '1', start: '09:00', end: '17:00' }
}

function emptyUnavailabilityForm(): UnavailabilityState {
  const now = new Date()
  const inOneHour = new Date(now.getTime() + 60 * 60 * 1000)
  const toInput = (date: Date) => date.toISOString().slice(0, 16)
  return { start: toInput(now), end: toInput(inOneHour) }
}

function EmployeesManager({ organizationId }: Props) {
  const queryClient = useQueryClient()
  const [formState, setFormState] = useState<EmployeeFormState>(emptyEmployeeForm())
  const [editingEmployee, setEditingEmployee] = useState<EmployeeRecord | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [locationFilter, setLocationFilter] = useState<string>('')
  const [roleFilter, setRoleFilter] = useState<string>('')
  const [showInactive, setShowInactive] = useState(false)
  const [availabilityForm, setAvailabilityForm] = useState<AvailabilityState>(emptyAvailabilityForm())
  const [unavailabilityForm, setUnavailabilityForm] = useState<UnavailabilityState>(emptyUnavailabilityForm())
  const [availabilityError, setAvailabilityError] = useState<string | null>(null)

  const { organization } = useOrganizationStore()
  const currency = organization?.settings.currency || 'CAD'
  const currencySymbol = CURRENCY_SYMBOLS[currency] || '$'

  const { data: locations } = useQuery<LocationRecord[]>({
    queryKey: ['locations', organizationId, 'for-employees'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('locations')
        .select('id, name, address, timezone, created_at')
        .order('created_at', { ascending: false })

      if (error) throw new Error(error.message)
      return (data ?? []) as LocationRecord[]
    },
    enabled: Boolean(organizationId),
  })

  const { data: roles } = useQuery<RoleRecord[]>({
    queryKey: ['roles', organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('roles')
        .select('id, name, color')
        .order('created_at', { ascending: true })

      if (error) throw new Error(error.message)
      return (data ?? []) as RoleRecord[]
    },
    enabled: Boolean(organizationId),
  })

  const { data: employees, isLoading: isEmployeesLoading, error: employeesError } = useQuery({
    queryKey: ['employees', organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('employees')
        .select(
          'id, name, email, phone, hourly_rate, home_location_id, is_floating, is_active, created_at, employee_roles(role:roles ( id, name, color ))',
        )
        .order('created_at', { ascending: false })

      if (error) throw new Error(error.message)

      return (data || []).map((row) => {
        const role_ids = (row.employee_roles || [])
          .map((item: { role: RoleRecord | null }) => item?.role?.id)
          .filter(Boolean) as string[]

        return {
          id: row.id,
          name: row.name,
          email: row.email ?? null,
          phone: row.phone ?? null,
          hourly_rate: row.hourly_rate ?? null,
          home_location_id: row.home_location_id ?? null,
          is_floating: row.is_floating,
          is_active: row.is_active,
          created_at: row.created_at,
          role_ids,
        } as EmployeeRecord
      })
    },
    enabled: Boolean(organizationId),
  })

  const {
    data: availabilityData,
    isLoading: isAvailabilityLoading,
    error: availabilityFetchError,
  } = useQuery<
    AvailabilityResult | null
  >({
    queryKey: ['availability', editingEmployee?.id],
    queryFn: async () => {
      if (!editingEmployee) return null
      const [recurringRes, oneOffRes] = await Promise.all([
        supabase
          .from('employee_availability')
          .select('id, day_of_week, start_time, end_time')
          .eq('employee_id', editingEmployee.id)
          .order('day_of_week', { ascending: true }),
        supabase
          .from('employee_unavailability')
          .select('id, start_datetime, end_datetime')
          .eq('employee_id', editingEmployee.id)
          .order('start_datetime', { ascending: true }),
      ])

      if (recurringRes.error) throw new Error(recurringRes.error.message)
      if (oneOffRes.error) throw new Error(oneOffRes.error.message)

      return {
        recurring: (recurringRes.data ?? []) as AvailabilityResult['recurring'],
        oneOff: (oneOffRes.data ?? []) as AvailabilityResult['oneOff'],
      }
    },
    enabled: Boolean(editingEmployee?.id),
  })

  const createEmployee = useMutation({
    mutationFn: async (payload: EmployeeFormState) => {
      const { data, error } = await supabase
        .from('employees')
        .insert({
          organization_id: organizationId,
          name: payload.name.trim(),
          email: payload.email.trim() || null,
          phone: payload.phone.trim() || null,
          hourly_rate: payload.hourlyRate ? Number(payload.hourlyRate) : null,
          home_location_id: payload.homeLocationId || null,
          is_floating: payload.isFloating,
          is_active: payload.isActive,
        })
        .select('id')
        .single()

      if (error || !data) throw new Error(error?.message || 'Unable to create employee')
      const employeeId = data.id as string

      if (payload.roleIds.size > 0) {
        const { error: rolesError } = await supabase.from('employee_roles').insert(
          [...payload.roleIds].map((roleId) => ({ employee_id: employeeId, role_id: roleId })),
        )
        if (rolesError) throw new Error(rolesError.message)
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['employees', organizationId] })
      setFormState(emptyEmployeeForm())
      setEditingEmployee(null)
    },
  })

  const updateEmployee = useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: EmployeeFormState }) => {
      const { error } = await supabase
        .from('employees')
        .update({
          name: payload.name.trim(),
          email: payload.email.trim() || null,
          phone: payload.phone.trim() || null,
          hourly_rate: payload.hourlyRate ? Number(payload.hourlyRate) : null,
          home_location_id: payload.homeLocationId || null,
          is_floating: payload.isFloating,
          is_active: payload.isActive,
        })
        .eq('id', id)

      if (error) throw new Error(error.message)

      await supabase.from('employee_roles').delete().eq('employee_id', id)
      if (payload.roleIds.size > 0) {
        const { error: rolesError } = await supabase.from('employee_roles').insert(
          [...payload.roleIds].map((roleId) => ({ employee_id: id, role_id: roleId })),
        )
        if (rolesError) throw new Error(rolesError.message)
      }
    },
    onSuccess: async (_, { id }) => {
      await queryClient.invalidateQueries({ queryKey: ['employees', organizationId] })
      await queryClient.invalidateQueries({ queryKey: ['availability', id] })
    },
  })

  const deleteEmployee = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('employees').delete().eq('id', id)
      if (error) throw new Error(error.message)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['employees', organizationId] })
      setEditingEmployee(null)
      setFormState(emptyEmployeeForm())
    },
  })

  const addAvailability = useMutation({
    mutationFn: async () => {
      if (!editingEmployee) return
      const { error } = await supabase.from('employee_availability').insert({
        organization_id: organizationId,
        employee_id: editingEmployee.id,
        day_of_week: Number(availabilityForm.dayOfWeek),
        start_time: availabilityForm.start,
        end_time: availabilityForm.end,
      })
      if (error) throw new Error(error.message)
    },
    onSuccess: async () => {
      setAvailabilityForm(emptyAvailabilityForm())
      await queryClient.invalidateQueries({ queryKey: ['availability', editingEmployee?.id] })
    },
  })

  const deleteAvailabilityEntry = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('employee_availability').delete().eq('id', id)
      if (error) throw new Error(error.message)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['availability', editingEmployee?.id] })
    },
  })

  const addUnavailability = useMutation({
    mutationFn: async () => {
      if (!editingEmployee) return
      const { error } = await supabase.from('employee_unavailability').insert({
        organization_id: organizationId,
        employee_id: editingEmployee.id,
        start_datetime: new Date(unavailabilityForm.start).toISOString(),
        end_datetime: new Date(unavailabilityForm.end).toISOString(),
      })
      if (error) throw new Error(error.message)
    },
    onSuccess: async () => {
      setUnavailabilityForm(emptyUnavailabilityForm())
      await queryClient.invalidateQueries({ queryKey: ['availability', editingEmployee?.id] })
    },
  })

  const deleteUnavailabilityEntry = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('employee_unavailability').delete().eq('id', id)
      if (error) throw new Error(error.message)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['availability', editingEmployee?.id] })
    },
  })

  useEffect(() => {
    if (!editingEmployee) return
    setFormState({
      name: editingEmployee.name,
      email: editingEmployee.email ?? '',
      phone: editingEmployee.phone ?? '',
      hourlyRate: editingEmployee.hourly_rate ? String(editingEmployee.hourly_rate) : '',
      homeLocationId: editingEmployee.home_location_id ?? '',
      roleIds: new Set(editingEmployee.role_ids),
      isFloating: editingEmployee.is_floating,
      isActive: editingEmployee.is_active,
    })
    setShowForm(true)
  }, [editingEmployee])

  const clearForm = () => {
    setEditingEmployee(null)
    setFormState(emptyEmployeeForm())
    setAvailabilityError(null)
    setShowForm(true)
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setFormError(null)
    try {
      if (editingEmployee) {
        await updateEmployee.mutateAsync({ id: editingEmployee.id, payload: formState })
      } else {
        await createEmployee.mutateAsync(formState)
      }
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Unable to save employee')
    }
  }

  const toggleRole = (roleId: string) => {
    setFormState((prev) => {
      const next = new Set(prev.roleIds)
      if (next.has(roleId)) {
        next.delete(roleId)
      } else {
        next.add(roleId)
      }
      return { ...prev, roleIds: next }
    })
  }

  const filteredEmployees = useMemo(() => {
    if (!employees) return []
    return employees.filter((employee) => {
      if (!showInactive && !employee.is_active) return false
      if (locationFilter) {
        const matchesLocation = employee.is_floating || employee.home_location_id === locationFilter
        if (!matchesLocation) return false
      }
      if (roleFilter && !employee.role_ids.includes(roleFilter)) return false
      return true
    })
  }, [employees, locationFilter, roleFilter, showInactive])

  const isSaving = createEmployee.isPending || updateEmployee.isPending
  const canSubmit = formState.name.trim().length > 1

  const activeLocationName = useMemo(() => {
    if (!editingEmployee || !locations) return null
    const match = locations.find((loc) => loc.id === editingEmployee.home_location_id)
    return match?.name ?? null
  }, [editingEmployee, locations])

  return (
    <div className="min-w-0 space-y-6">
      <div className="min-w-0 w-full rounded-xl border border-transparent bg-slate-900/70 px-4 py-5 text-slate-50 shadow-sm shadow-slate-950/30 sm:px-6 sm:py-6 md:border md:border-slate-800 md:px-7 md:py-7">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Employees</p>
            <h3 className="mt-1 text-xl font-semibold text-white">Roster and filters</h3>
            <p className="text-sm text-slate-300">
              Filter by home location or role. Floating employees always appear for all locations.
            </p>
          </div>
          <button
            type="button"
            onClick={clearForm}
            className="self-start rounded-lg border border-emerald-400/50 bg-emerald-500/10 px-4 py-2 text-xs font-semibold text-emerald-100 transition hover:border-emerald-300"
          >
            Add new employee
          </button>
        </div>

        <div className="mt-4 grid gap-3 rounded-lg border border-slate-800 bg-slate-950/60 p-4 text-sm text-slate-100 sm:grid-cols-2 md:grid-cols-4">
          <label className="space-y-1">
            <span className="text-xs uppercase tracking-[0.12em] text-slate-500">Location filter</span>
            <select
              value={locationFilter}
              onChange={(e) => setLocationFilter(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none ring-2 ring-transparent transition focus:border-slate-500 focus:ring-slate-600"
            >
              <option value="">All locations</option>
              {locations?.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1">
            <span className="text-xs uppercase tracking-[0.12em] text-slate-500">Role filter</span>
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none ring-2 ring-transparent transition focus:border-slate-500 focus:ring-slate-600"
            >
              <option value="">All roles</option>
              {roles?.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2 text-xs font-semibold text-slate-200 md:col-span-2">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-emerald-400"
            />
            Show inactive employees
          </label>
        </div>

        <div className="mt-4 space-y-3 md:hidden">
          {isEmployeesLoading && (
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3 text-sm text-slate-300">Loading employees…</div>
          )}
          {employeesError && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{(employeesError as Error).message}</div>
          )}
          {!isEmployeesLoading && !filteredEmployees.length && !employeesError && (
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3 text-sm text-slate-400">No employees yet. Add your first team member.</div>
          )}

          {filteredEmployees.map((employee) => {
            const homeLocation = locations?.find((loc) => loc.id === employee.home_location_id)
            return (
              <div key={employee.id} className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-sm text-slate-100 shadow-sm shadow-slate-950/40">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-white flex items-center gap-2">
                      {employee.name}
                      {!employee.is_active && (
                        <span className="rounded-full bg-slate-800 px-2 py-[2px] text-[11px] font-semibold text-slate-300">Inactive</span>
                      )}
                      {employee.is_floating && (
                        <span className="rounded-full bg-emerald-500/15 px-2 py-[2px] text-[11px] font-semibold text-emerald-100">
                          Floating
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-slate-400">Added {new Date(employee.created_at).toLocaleDateString()}</p>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs">
                    <button
                      onClick={() => setEditingEmployee(employee)}
                      className="rounded-lg border border-slate-700 px-3 py-1 font-semibold text-slate-100 transition hover:border-slate-500"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => setEditingEmployee(employee)}
                      className="rounded-lg border border-emerald-500/60 px-3 py-1 font-semibold text-emerald-100 transition hover:border-emerald-400"
                    >
                      Availability
                    </button>
                    <button
                      onClick={() => deleteEmployee.mutate(employee.id)}
                      className="rounded-lg border border-red-500/60 px-3 py-1 font-semibold text-red-100 transition hover:border-red-400"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <p className="text-xs uppercase tracking-[0.08em] text-slate-400">Contact</p>
                    {employee.email && <p className="text-sm">{employee.email}</p>}
                    {employee.phone && <p className="text-sm text-slate-300">{employee.phone}</p>}
                    {employee.hourly_rate !== null && (
                      <p className="text-[12px] text-emerald-200">{currencySymbol}{employee.hourly_rate.toFixed(2)}/hr</p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs uppercase tracking-[0.08em] text-slate-400">Home location</p>
                    <p className="text-sm text-slate-200">
                      {employee.is_floating ? 'Any location' : homeLocation?.name || 'Unassigned'}
                    </p>
                    <p className="text-xs uppercase tracking-[0.08em] text-slate-400">Roles</p>
                    <div className="flex flex-wrap gap-2">
                      {employee.role_ids.length === 0 && <span className="text-xs text-slate-400">No roles</span>}
                      {employee.role_ids.map((roleId) => {
                        const role = roles?.find((r) => r.id === roleId)
                        return (
                          <span
                            key={roleId}
                            className="rounded-full border border-slate-700 px-2 py-[2px] text-[11px] font-semibold"
                            style={{ color: role?.color || '#cbd5e1', borderColor: role?.color || '#334155' }}
                          >
                            {role?.name || 'Role'}
                          </span>
                        )
                      })}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        <div className="mt-4 overflow-x-auto hidden md:block">
          <div className="min-w-[860px] rounded-lg border border-slate-800 bg-slate-950/60">
            <table className="w-full text-left text-sm text-slate-400">
              <thead className="border-b border-slate-800 text-xs font-semibold uppercase tracking-[0.1em]">
                <tr>
                  <th className="px-4 py-3 font-semibold text-slate-400 w-[30%]">Name</th>
                  <th className="px-4 py-3 font-semibold text-slate-400 w-[20%]">Contact</th>
                  <th className="px-4 py-3 font-semibold text-slate-400 w-[15%]">Home location</th>
                  <th className="px-4 py-3 font-semibold text-slate-400 w-[15%]">Roles</th>
                  <th className="px-4 py-3 font-semibold text-slate-400 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 text-slate-100">
                {isEmployeesLoading && (
                  <tr>
                    <td colSpan={5} className="px-4 py-4 text-sm text-slate-300">
                      Loading employees…
                    </td>
                  </tr>
                )}
                {employeesError && (
                  <tr>
                    <td colSpan={5} className="px-4 py-4 text-sm text-red-200">
                      {(employeesError as Error).message}
                    </td>
                  </tr>
                )}
                {!isEmployeesLoading && !filteredEmployees.length && !employeesError && (
                  <tr>
                    <td colSpan={5} className="px-4 py-4 text-sm text-slate-400">
                      No employees yet. Add your first team member.
                    </td>
                  </tr>
                )}

                {filteredEmployees.map((employee) => {
                  const homeLocation = locations?.find((loc) => loc.id === employee.home_location_id)
                  return (
                    <tr key={employee.id} className="group hover:bg-slate-900/50 transition-colors">
                      <td className="px-4 py-3 align-top">
                        <p className="font-semibold text-white flex items-center gap-2">
                          {employee.name}
                          {!employee.is_active && (
                            <span className="rounded-full bg-slate-800 px-2 py-[2px] text-[11px] font-semibold text-slate-300">
                              Inactive
                            </span>
                          )}
                          {employee.is_floating && (
                            <span className="rounded-full bg-emerald-500/15 px-2 py-[2px] text-[11px] font-semibold text-emerald-100">
                              Floating
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-slate-400">
                          Added {new Date(employee.created_at).toLocaleDateString()}
                        </p>
                      </td>
                      <td className="px-4 py-3 align-top text-slate-200 space-y-1">
                        {employee.email && <p className="text-xs">{employee.email}</p>}
                        {employee.phone && <p className="text-xs text-slate-400">{employee.phone}</p>}
                        {employee.hourly_rate !== null && (
                          <p className="text-[11px] text-emerald-200">{currencySymbol}{employee.hourly_rate.toFixed(2)}/hr</p>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top text-slate-200">
                        {employee.is_floating ? 'Any location' : homeLocation?.name || 'Unassigned'}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="flex flex-wrap gap-2">
                          {employee.role_ids.length === 0 && <span className="text-xs text-slate-400">No roles</span>}
                          {employee.role_ids.map((roleId) => {
                            const role = roles?.find((r) => r.id === roleId)
                            return (
                              <span
                                key={roleId}
                                className="rounded-full border border-slate-700 px-2 py-[2px] text-[11px] font-semibold"
                                style={{
                                  color: role?.color || '#cbd5e1',
                                  borderColor: role?.color || '#334155',
                                }}
                              >
                                {role?.name || 'Role'}
                              </span>
                            )
                          })}
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top text-right">
                        <div className="flex justify-end gap-2 text-xs">
                          <button
                            onClick={() => setEditingEmployee(employee)}
                            className="rounded-lg border border-slate-700 px-3 py-1 font-semibold text-slate-100 transition hover:border-slate-500"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => setEditingEmployee(employee)}
                            className="rounded-lg border border-emerald-500/60 px-3 py-1 font-semibold text-emerald-100 transition hover:border-emerald-400"
                          >
                            Availability
                          </button>
                          <button
                            onClick={() => deleteEmployee.mutate(employee.id)}
                            className="rounded-lg border border-red-500/60 px-3 py-1 font-semibold text-red-100 transition hover:border-red-400"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="min-w-0 space-y-6">
        {showForm && (
          <div className="rounded-xl border border-transparent bg-slate-900/70 p-6 text-slate-50 md:border md:border-slate-800">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Form</p>
                <h3 className="mt-1 text-xl font-semibold text-white">
                  {editingEmployee ? `Edit ${editingEmployee.name}` : 'Add employee'}
                </h3>
                <p className="text-sm text-slate-300">
                  Name, contact, hourly rate, home location, roles, and floating status.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setEditingEmployee(null)
                  setShowForm(false)
                  setFormState(emptyEmployeeForm())
                }}
                className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-100 transition hover:border-slate-500"
              >
                Close
              </button>
            </div>

            <form onSubmit={handleSubmit} className="mt-4 space-y-4">
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
                      <span className="rounded-full border border-slate-700 px-2 py-[2px] text-[12px] font-semibold" style={{ color: role.color || '#cbd5e1', borderColor: role.color || '#334155' }}>
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

              {formError && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                  {formError}
                </div>
              )}

              <div className="flex items-center gap-3">
                <button
                  type="submit"
                  disabled={!canSubmit || isSaving}
                  className="rounded-lg bg-emerald-400 px-4 py-3 text-sm font-semibold text-emerald-950 transition hover:translate-y-[-1px] hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {isSaving ? 'Saving…' : editingEmployee ? 'Save changes' : 'Create employee'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditingEmployee(null)
                    setShowForm(false)
                    setFormState(emptyEmployeeForm())
                  }}
                  className="rounded-lg border border-slate-700 px-4 py-3 text-sm font-semibold text-slate-100 transition hover:border-slate-500"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {editingEmployee && (
          <div className="rounded-xl border border-transparent bg-slate-900/70 p-6 text-slate-50 md:border md:border-slate-800">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Availability</p>
                <h3 className="mt-1 text-xl font-semibold text-white">{editingEmployee.name}</h3>
                <p className="text-sm text-slate-300">
                  Recurring weekly availability and date-specific unavailability.
                </p>
                {activeLocationName && (
                  <p className="text-xs text-slate-400">Home location: {activeLocationName}</p>
                )}
              </div>
            </div>

            {(availabilityError || availabilityFetchError) && (
              <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {availabilityError || availabilityFetchError?.message}
              </div>
            )}

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="space-y-3 overflow-hidden rounded-lg border border-slate-800 bg-slate-950/60 p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-slate-100">Recurring weekly</p>
                  <button
                    type="button"
                    onClick={async () => {
                      setAvailabilityError(null)
                      try {
                        await addAvailability.mutateAsync()
                      } catch (error) {
                        setAvailabilityError(error instanceof Error ? error.message : 'Unable to add availability')
                      }
                    }}
                    className="rounded-lg border border-emerald-500/60 px-3 py-1 text-xs font-semibold text-emerald-100 transition hover:border-emerald-300"
                  >
                    Add window
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
                  <select
                    value={availabilityForm.dayOfWeek}
                    onChange={(e) => setAvailabilityForm((prev) => ({ ...prev, dayOfWeek: e.target.value }))}
                    className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none ring-2 ring-transparent transition focus:border-slate-500 focus:ring-slate-600"
                  >
                    {DAYS.map((day, idx) => (
                      <option key={day} value={idx}>
                        {day}
                      </option>
                    ))}
                  </select>
                  <input
                    type="time"
                    value={availabilityForm.start}
                    onChange={(e) => setAvailabilityForm((prev) => ({ ...prev, start: e.target.value }))}
                    className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none ring-2 ring-transparent transition focus:border-slate-500 focus:ring-slate-600"
                  />
                  <input
                    type="time"
                    value={availabilityForm.end}
                    onChange={(e) => setAvailabilityForm((prev) => ({ ...prev, end: e.target.value }))}
                    className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none ring-2 ring-transparent transition focus:border-slate-500 focus:ring-slate-600"
                  />
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
                          className="rounded-lg border border-red-500/60 px-2 py-1 text-[12px] font-semibold text-red-100 transition hover:border-red-400"
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

              <div className="space-y-3 overflow-hidden rounded-lg border border-slate-800 bg-slate-950/60 p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-slate-100">Date-specific unavailability</p>
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
                    className="rounded-lg border border-amber-500/60 px-3 py-1 text-xs font-semibold text-amber-100 transition hover:border-amber-300"
                  >
                    Add block
                  </button>
                </div>

                <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
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
                          <span className="font-semibold">{new Date(item.start_datetime).toLocaleString()}</span>
                          <span className="ml-2 text-slate-300">→ {new Date(item.end_datetime).toLocaleString()}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => deleteUnavailabilityEntry.mutate(item.id)}
                          className="rounded-lg border border-red-500/60 px-2 py-1 text-[12px] font-semibold text-red-100 transition hover:border-red-400"
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
  )
}

export default EmployeesManager
