import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient'
import CoverageRulesManager from './CoverageRulesManager'

export type LocationRecord = {
  id: string
  name: string
  address: string | null
  timezone: string
  created_at: string
}

type FormState = {
  name: string
  address: string
  timezone: string
}

type DeleteBlock = {
  location: LocationRecord
  futureShiftCount: number
}

type Props = {
  organizationId: string
}

// Prefer the full IANA list from the runtime; fall back to a curated set including Saskatchewan.
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
    const values = Intl.supportedValuesOf('timeZone')
    return [...values].sort()
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

function emptyForm(): FormState {
  return { name: '', address: '', timezone: 'America/New_York' }
}

export function LocationsManager({ organizationId }: Props) {
  const queryClient = useQueryClient()
  const [formState, setFormState] = useState<FormState>(emptyForm())
  const [editing, setEditing] = useState<LocationRecord | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<LocationRecord | null>(null)
  const [deleteBlock, setDeleteBlock] = useState<DeleteBlock | null>(null)
  const [deleteCheckError, setDeleteCheckError] = useState<string | null>(null)
  const [isCheckingDelete, setIsCheckingDelete] = useState(false)
  const [timezoneQuery, setTimezoneQuery] = useState('')
  const [showAllZones, setShowAllZones] = useState(false)

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

  const { data: locations, isLoading, error: fetchError } = useQuery({
    queryKey: ['locations', organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('locations')
        .select('id, name, address, timezone, created_at')
        .order('created_at', { ascending: false })

      if (error) throw new Error(error.message)
      return data as LocationRecord[]
    },
    enabled: Boolean(organizationId),
  })

  const createMutation = useMutation({
    mutationFn: async (payload: FormState) => {
      const insertPayload = {
        organization_id: organizationId,
        name: payload.name.trim(),
        address: payload.address.trim() || null,
        timezone: payload.timezone,
      }

      const { error } = await supabase.from('locations').insert(insertPayload)
      if (error) throw new Error(error.message)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['locations', organizationId] })
      setFormState(emptyForm())
    },
  })

  const updateMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: FormState }) => {
      const updatePayload = {
        name: payload.name.trim(),
        address: payload.address.trim() || null,
        timezone: payload.timezone,
      }

      const { error } = await supabase.from('locations').update(updatePayload).eq('id', id)
      if (error) throw new Error(error.message)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['locations', organizationId] })
      setEditing(null)
      setFormState(emptyForm())
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('locations').delete().eq('id', id)
      if (error) throw new Error(error.message)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['locations', organizationId] })
      setDeleteTarget(null)
    },
  })

  useEffect(() => {
    if (editing) {
      setFormState({
        name: editing.name,
        address: editing.address ?? '',
        timezone: editing.timezone,
      })
      setShowForm(true)
    } else {
      setFormState(emptyForm())
    }
  }, [editing])

  const isSaving = createMutation.isPending || updateMutation.isPending
  const canSubmit = formState.name.trim().length > 0 && formState.timezone.trim().length > 0

  const headerLabel = useMemo(() => {
    if (editing) return 'Edit location'
    return 'Add location'
  }, [editing])

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setFormError(null)
    try {
      if (editing) {
        await updateMutation.mutateAsync({ id: editing.id, payload: formState })
      } else {
        await createMutation.mutateAsync(formState)
      }
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Unable to save location')
    }
  }

  const handleDeleteCheck = async (location: LocationRecord) => {
    setIsCheckingDelete(true)
    setDeleteCheckError(null)
    setDeleteBlock(null)
    setDeleteTarget(null)
    try {
      const { count, error } = await supabase
        .from('shifts')
        .select('id', { count: 'exact', head: true })
        .eq('location_id', location.id)
        .gte('start_datetime', new Date().toISOString())

      if (error) throw new Error(error.message)
      if (count && count > 0) {
        setDeleteBlock({ location, futureShiftCount: count })
        return
      }

      setDeleteTarget(location)
    } catch (error) {
      setDeleteCheckError(error instanceof Error ? error.message : 'Unable to check shifts')
    } finally {
      setIsCheckingDelete(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    try {
      await deleteMutation.mutateAsync(deleteTarget.id)
    } catch (error) {
      setDeleteCheckError(error instanceof Error ? error.message : 'Unable to delete location')
    }
  }

  const cancelDeleteDialogs = () => {
    setDeleteTarget(null)
    setDeleteBlock(null)
    setDeleteCheckError(null)
  }

  return (
    <div className="min-w-0 space-y-6">
      <div className="min-w-0 w-full max-w-[600px] rounded-xl border border-transparent bg-slate-900/70 px-4 py-5 text-slate-50 shadow-sm shadow-slate-950/30 sm:max-w-[640px] sm:px-6 sm:py-6 md:max-w-none md:border md:border-slate-800 md:px-7 md:py-7 mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Locations</p>
            <h3 className="mt-1 text-xl font-semibold text-white">Manage locations</h3>
            <p className="text-sm text-slate-300">
              Add, edit, or delete locations. Deletion is blocked if future shifts exist.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setEditing(null)
              setFormState(emptyForm())
              setShowForm(true)
            }}
            className="rounded-lg border border-emerald-400/60 bg-emerald-500/10 px-4 py-2 text-xs font-semibold text-emerald-100 transition hover:border-emerald-300"
          >
            Add location
          </button>
        </div>

        <div className="mt-4 space-y-3 md:hidden">
          {isLoading && <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3 text-sm text-slate-300">Loading locations…</div>}
          {fetchError && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{(fetchError as Error).message}</div>
          )}
          {!isLoading && !locations?.length && !fetchError && (
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3 text-sm text-slate-400">No locations yet. Create your first one.</div>
          )}
          {locations?.map((location) => (
            <div key={location.id} className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-sm text-slate-100 shadow-sm shadow-slate-950/40">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-white">{location.name}</p>
                  <p className="text-xs text-slate-400">Created {new Date(location.created_at).toLocaleDateString()}</p>
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  <button
                    onClick={() => setEditing(location)}
                    className="rounded-lg border border-slate-700 px-3 py-1 font-semibold text-slate-100 transition hover:border-slate-500"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDeleteCheck(location)}
                    disabled={isCheckingDelete}
                    className="rounded-lg border border-red-500/60 px-3 py-1 font-semibold text-red-100 transition hover:border-red-400 disabled:opacity-60"
                  >
                    Delete
                  </button>
                </div>
              </div>
              <div className="mt-3 space-y-1 text-slate-200">
                <p className="text-xs uppercase tracking-[0.08em] text-slate-400">Address</p>
                <p className="text-sm">{location.address || '—'}</p>
                <p className="text-xs uppercase tracking-[0.08em] text-slate-400">Timezone</p>
                <p className="text-sm">{location.timezone}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 overflow-x-auto hidden md:block">
          <div className="min-w-[680px] rounded-lg border border-slate-800 bg-slate-950/60">
            <div className="grid grid-cols-[2fr_1fr_1fr_auto] gap-3 border-b border-slate-800 px-4 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-slate-400">
              <span>Name</span>
              <span>Address</span>
              <span>Timezone</span>
              <span className="text-right">Actions</span>
            </div>
            {isLoading && <div className="px-4 py-4 text-sm text-slate-300">Loading locations…</div>}
            {fetchError && (
              <div className="px-4 py-4 text-sm text-red-200">{(fetchError as Error).message}</div>
            )}
            {!isLoading && !locations?.length && !fetchError && (
              <div className="px-4 py-4 text-sm text-slate-400">No locations yet. Create your first one.</div>
            )}
            {locations?.map((location) => (
              <div
                key={location.id}
                className="grid grid-cols-[2fr_1fr_1fr_auto] items-center gap-3 border-t border-slate-800 px-4 py-3 text-sm text-slate-100"
              >
                <div>
                  <p className="font-semibold text-white">{location.name}</p>
                  <p className="text-xs text-slate-400">Created {new Date(location.created_at).toLocaleDateString()}</p>
                </div>
                <div className="text-slate-200">{location.address || '—'}</div>
                <div className="text-slate-200">{location.timezone}</div>
                <div className="flex justify-end gap-2 text-xs">
                  <button
                    onClick={() => setEditing(location)}
                    className="rounded-lg border border-slate-700 px-3 py-1 font-semibold text-slate-100 transition hover:border-slate-500"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDeleteCheck(location)}
                    disabled={isCheckingDelete}
                    className="rounded-lg border border-red-500/60 px-3 py-1 font-semibold text-red-100 transition hover:border-red-400 disabled:opacity-60"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {showForm && (
        <div className="min-w-0 rounded-xl border border-transparent bg-slate-900/70 p-6 text-slate-50 md:border md:border-slate-800">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Form</p>
              <h3 className="mt-1 text-xl font-semibold text-white">{headerLabel}</h3>
              <p className="text-sm text-slate-300">Name, address, and timezone are stored per organization.</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setEditing(null)
                setShowForm(false)
                setFormState(emptyForm())
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
                placeholder="Downtown Flagship"
                required
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-slate-100 outline-none ring-2 ring-transparent transition focus:border-slate-500 focus:ring-slate-600"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-100">Address</label>
              <input
                type="text"
                value={formState.address}
                onChange={(e) => setFormState((prev) => ({ ...prev, address: e.target.value }))}
                placeholder="123 Market Street, San Francisco, CA"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-slate-100 outline-none ring-2 ring-transparent transition focus:border-slate-500 focus:ring-slate-600"
              />
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-1">
                  <label className="text-sm font-semibold text-slate-100">Timezone</label>
                  <p className="text-xs text-slate-400">Suggested first; search to filter the full list.</p>
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
                placeholder="Search (e.g., Regina, London)"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-slate-100 outline-none ring-2 ring-transparent transition focus:border-slate-500 focus:ring-slate-600"
              />

              <select
                value={formState.timezone}
                onChange={(e) => setFormState((prev) => ({ ...prev, timezone: e.target.value }))}
                required
                size={Math.min(12, Math.max(6, (showAllZones ? filteredTimezones : suggestedTimezones).length + 2))}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-slate-100 outline-none ring-2 ring-transparent transition focus:border-slate-500 focus:ring-slate-600"
              >
                <optgroup label="Suggested (region-aware)">
                  {suggestedTimezones.map((zone) => (
                    <option key={zone} value={zone} className="bg-slate-900 text-slate-100">
                      {zone}
                    </option>
                  ))}
                </optgroup>
                <optgroup label={showAllZones ? 'All timezones' : 'Matching timezones (top)'}>
                  {(showAllZones ? filteredTimezones : filteredTimezones.slice(0, 40)).map((zone) => (
                    <option key={zone} value={zone} className="bg-slate-900 text-slate-100">
                      {zone}
                    </option>
                  ))}
                </optgroup>
              </select>
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
                {isSaving ? 'Saving…' : editing ? 'Save changes' : 'Create location'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditing(null)
                  setShowForm(false)
                  setFormState(emptyForm())
                }}
                className="rounded-lg border border-slate-700 px-4 py-3 text-sm font-semibold text-slate-100 transition hover:border-slate-500"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {(deleteTarget || deleteBlock) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
          <div className="w-full max-w-lg rounded-xl border border-slate-800 bg-slate-900 p-6 text-slate-50 shadow-2xl shadow-black/40">
            {deleteBlock ? (
              <>
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-400">Deletion blocked</p>
                <h4 className="mt-1 text-2xl font-semibold text-white">Future shifts exist</h4>
                <p className="mt-2 text-sm text-slate-300">
                  {deleteBlock.futureShiftCount} future shift(s) are scheduled for {deleteBlock.location.name}. Move or delete
                  those shifts before removing this location.
                </p>
                <div className="mt-4 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={cancelDeleteDialogs}
                    className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:border-slate-500"
                  >
                    Close
                  </button>
                </div>
              </>
            ) : deleteTarget ? (
              <>
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">Confirm deletion</p>
                <h4 className="mt-1 text-2xl font-semibold text-white">Delete {deleteTarget.name}?</h4>
                <p className="mt-2 text-sm text-slate-300">
                  This action removes the location and its history. This is irreversible.
                </p>
                {deleteCheckError && (
                  <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                    {deleteCheckError}
                  </div>
                )}
                <div className="mt-4 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={cancelDeleteDialogs}
                    className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:border-slate-500"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={confirmDelete}
                    disabled={deleteMutation.isPending}
                    className="rounded-lg border border-red-500/60 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-100 transition hover:border-red-400 disabled:opacity-60"
                  >
                    {deleteMutation.isPending ? 'Deleting…' : 'Delete location'}
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}

      {deleteCheckError && !deleteTarget && !deleteBlock && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {deleteCheckError}
        </div>
      )}

      <div className="min-w-0 w-full max-w-[600px] rounded-xl border border-transparent bg-slate-900/70 px-4 py-5 text-slate-50 shadow-sm shadow-slate-950/30 sm:max-w-[640px] sm:px-6 sm:py-6 md:max-w-none md:border md:border-slate-800 md:px-7 md:py-7 mx-auto">
        <div className="mb-6">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Coverage</p>
          <h3 className="mt-1 text-xl font-semibold text-white">Coverage Requirements</h3>
          <p className="text-sm text-slate-300">
            Define minimum staffing levels by role and time of day to ensure adequate coverage.
          </p>
        </div>
        <CoverageRulesManager />
      </div>
    </div>
  )
}

export default LocationsManager
