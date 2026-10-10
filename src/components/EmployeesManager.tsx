import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient'
import { useOrganizationStore } from '../lib/useOrganizationStore'
import type { LocationRecord } from './LocationsManager'
import AddEditEmployeeDialog from './AddEditEmployeeDialog'

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
  user_id?: string | null
}

type Props = {
  organizationId: string
  userEmail?: string | null
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  CAD: '$',
  USD: '$',
  EUR: '€',
  GBP: '£',
  AUD: '$',
}

function EmployeesManager({ organizationId, userEmail = null }: Props) {
  const queryClient = useQueryClient()
  const [editingEmployee, setEditingEmployee] = useState<EmployeeRecord | null>(null)
  const [showEmployeeDialog, setShowEmployeeDialog] = useState(false)
  const [employeeDialogTab, setEmployeeDialogTab] = useState<'details' | 'availability'>('details')
  const [locationFilter, setLocationFilter] = useState<string>('')
  const [roleFilter, setRoleFilter] = useState<string>('')
  const [showInactive, setShowInactive] = useState(false)

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
          'id, name, email, phone, hourly_rate, home_location_id, is_floating, is_active, created_at, user_id, employee_roles(role:roles ( id, name, color ))',
        )
        .order('created_at', { ascending: false })

      if (error) throw new Error(error.message)

      return (data || []).map((row) => {
        const role_ids = (row.employee_roles || [])
          .flatMap((item) => {
            const roleValue = (item as { role?: RoleRecord | RoleRecord[] | null }).role
            if (Array.isArray(roleValue)) return roleValue.map((role) => role.id)
            return roleValue?.id ? [roleValue.id] : []
          })

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
          user_id: row.user_id ?? null,
          role_ids,
        } as EmployeeRecord
      })
    },
    enabled: Boolean(organizationId),
  })

  const deleteEmployee = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('employees').delete().eq('id', id)
      if (error) throw new Error(error.message)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['employees', organizationId] })
      setEditingEmployee(null)
    },
  })

  const openAddEmployeeDialog = () => {
    setEditingEmployee(null)
    setEmployeeDialogTab('details')
    setShowEmployeeDialog(true)
  }

  const openEditEmployeeDialog = (employee: EmployeeRecord) => {
    setEditingEmployee(employee)
    setEmployeeDialogTab('details')
    setShowEmployeeDialog(true)
  }

  const openEditEmployeeAvailability = (employee: EmployeeRecord) => {
    setEditingEmployee(employee)
    setEmployeeDialogTab('availability')
    setShowEmployeeDialog(true)
  }

  const handleEmployeeSaved = () => {
    queryClient.invalidateQueries({ queryKey: ['employees', organizationId] })
    setShowEmployeeDialog(false)
    setEditingEmployee(null)
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

  return (
    <div className="min-w-0 space-y-6">
      <div className="min-w-0 w-full rounded-xl border border-transparent bg-slate-900/70 px-4 py-5 text-slate-50 shadow-xs shadow-slate-950/30 sm:px-6 sm:py-6 md:border md:border-slate-800 md:px-7 md:py-7">
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
            onClick={openAddEmployeeDialog}
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
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-hidden ring-2 ring-transparent transition focus:border-slate-500 focus:ring-slate-600"
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
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-hidden ring-2 ring-transparent transition focus:border-slate-500 focus:ring-slate-600"
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
              className="h-4 w-4 rounded-sm border-slate-600 bg-slate-900 text-emerald-400"
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
              <div key={employee.id} className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-sm text-slate-100 shadow-xs shadow-slate-950/40">
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
                      onClick={() => openEditEmployeeDialog(employee)}
                      className="rounded-lg border border-slate-700 px-3 py-2 font-semibold text-slate-100 transition hover:border-slate-500"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => openEditEmployeeAvailability(employee)}
                      className="rounded-lg border border-emerald-500/60 px-3 py-2 font-semibold text-emerald-100 transition hover:border-emerald-400"
                    >
                      Availability
                    </button>
                    <button
                      onClick={() => deleteEmployee.mutate(employee.id)}
                      className="rounded-lg border border-red-500/60 px-3 py-2 font-semibold text-red-100 transition hover:border-red-400"
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
              <thead className="border-b border-slate-800 text-xs font-semibold uppercase tracking-widest">
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
                            onClick={() => openEditEmployeeDialog(employee)}
                            className="rounded-lg border border-slate-700 px-3 py-1 font-semibold text-slate-100 transition hover:border-slate-500"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => openEditEmployeeAvailability(employee)}
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

      <AddEditEmployeeDialog
        isOpen={showEmployeeDialog}
        onClose={() => setShowEmployeeDialog(false)}
        employee={editingEmployee}
        organizationId={organizationId}
        locations={locations || []}
        roles={roles || []}
        currency={currency}
        onSaved={handleEmployeeSaved}
        initialTab={employeeDialogTab}
        userEmail={userEmail}
      />
    </div>
  )
}

export default EmployeesManager
