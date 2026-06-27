import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useOrganizationStore } from '../lib/useOrganizationStore'

type Role = {
  id: string
  name: string
  color: string
}

export default function RolesManager() {
  const { organization } = useOrganizationStore()
  const [roles, setRoles] = useState<Role[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Form state
  const [name, setName] = useState('')
  const [color, setColor] = useState('#3b82f6') // Default blue
  const [isAdding, setIsAdding] = useState(false)

  useEffect(() => {
    if (organization) {
      fetchRoles()
    }
  }, [organization])

  async function fetchRoles() {
    setLoading(true)
    const { data, error } = await supabase
      .from('roles')
      .select('id, name, color')
      .eq('organization_id', organization?.id)
      .order('name')

    if (error) {
      setError(error.message)
    } else {
      setRoles(data || [])
    }
    setLoading(false)
  }

  async function handleAddRole(e: React.FormEvent) {
    e.preventDefault()
    if (!organization) return

    setIsAdding(true)
    const { data, error } = await supabase
      .from('roles')
      .insert({
        organization_id: organization.id,
        name,
        color
      })
      .select()
      .single()

    if (error) {
      setError(error.message)
    } else if (data) {
      setRoles([...roles, data])
      setName('')
      setColor('#3b82f6')
    }
    setIsAdding(false)
  }

  async function handleDeleteRole(id: string) {
    if (!confirm('Are you sure? This will remove this role from all employees and shifts.')) return

    const { error } = await supabase
      .from('roles')
      .delete()
      .eq('id', id)

    if (error) {
      setError(error.message)
    } else {
      setRoles(roles.filter(r => r.id !== id))
    }
  }

  if (loading && roles.length === 0) return <div className="text-slate-400">Loading roles...</div>

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-200 p-3 rounded text-sm">
          {error}
          <button onClick={() => setError(null)} className="float-right font-bold">&times;</button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Add Role Form */}
        <div className="lg:col-span-1 bg-slate-900/50 p-4 rounded-lg border border-slate-800 h-fit">
          <h3 className="text-lg font-medium text-white mb-4">Add New Role</h3>
          <form onSubmit={handleAddRole} className="space-y-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Role Name</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full rounded bg-slate-800 border-slate-700 text-white px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                placeholder="e.g. Cashier"
                required
              />
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">Color Tag</label>
              <div className="flex gap-2 items-center">
                <input
                  type="color"
                  value={color}
                  onChange={e => setColor(e.target.value)}
                  className="h-9 w-16 rounded bg-slate-800 border-slate-700 cursor-pointer"
                />
                <span className="text-xs text-slate-500 font-mono">{color}</span>
              </div>
            </div>

            <button
              type="submit"
              disabled={isAdding}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white py-2 rounded text-sm font-medium transition-colors disabled:opacity-50"
            >
              {isAdding ? 'Adding...' : 'Create Role'}
            </button>
          </form>
        </div>

        {/* Roles List */}
        <div className="lg:col-span-2 space-y-4">
          <h3 className="text-lg font-medium text-white">Existing Roles</h3>
          {roles.length === 0 ? (
            <p className="text-slate-500 text-sm italic">No roles defined yet.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {roles.map(role => (
                <div key={role.id} className="flex items-center justify-between bg-slate-800/50 p-3 rounded border border-slate-700">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-4 h-4 rounded-full shadow-sm"
                      style={{ backgroundColor: role.color }}
                    />
                    <span className="text-sm font-medium text-white">{role.name}</span>
                  </div>
                  <button
                    onClick={() => handleDeleteRole(role.id)}
                    className="text-slate-500 hover:text-red-400 transition-colors p-2"
                    title="Delete Role"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
