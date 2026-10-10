import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient'
import QuickAddLocationDialog from './locations/QuickAddLocationDialog'
import EditLocationDialog from './locations/EditLocationDialog'

export type LocationRecord = {
  id: string
  name: string
  address: string | null
  timezone: string
  created_at: string
}

type DeleteBlock = {
  location: LocationRecord
  futureShiftCount: number
}

type Props = {
  organizationId: string
}

export function LocationsManager({ organizationId }: Props) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<LocationRecord | null>(null)
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [showEditDialog, setShowEditDialog] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<LocationRecord | null>(null)
  const [deleteBlock, setDeleteBlock] = useState<DeleteBlock | null>(null)
  const [deleteCheckError, setDeleteCheckError] = useState<string | null>(null)
  const [isCheckingDelete, setIsCheckingDelete] = useState(false)

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

  const handleLocationCreated = async () => {
    await queryClient.invalidateQueries({ queryKey: ['locations', organizationId] })
  }

  const handleLocationUpdated = async () => {
    await queryClient.invalidateQueries({ queryKey: ['locations', organizationId] })
  }

  const handleLocationDeleted = async () => {
    await queryClient.invalidateQueries({ queryKey: ['locations', organizationId] })
  }

  const handleEditClick = (location: LocationRecord) => {
    setEditing(location)
    setShowEditDialog(true)
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
      <div className="w-full rounded-xl border border-slate-800 bg-slate-900/70 px-4 py-5 text-slate-50 sm:px-6 sm:py-6 md:px-7 md:py-7">
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
            onClick={() => setShowAddDialog(true)}
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
            <div key={location.id} className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-sm text-slate-100 shadow-xs shadow-slate-950/40">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-white">{location.name}</p>
                  <p className="text-xs text-slate-400">Created {new Date(location.created_at).toLocaleDateString()}</p>
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  <button
                    onClick={() => handleEditClick(location)}
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
            <div className="grid grid-cols-[2fr_1fr_1fr_auto] gap-3 border-b border-slate-800 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-slate-400">
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
                    onClick={() => handleEditClick(location)}
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

      <QuickAddLocationDialog
        isOpen={showAddDialog}
        onClose={() => setShowAddDialog(false)}
        organizationId={organizationId}
        onCreated={handleLocationCreated}
      />

      <EditLocationDialog
        isOpen={showEditDialog}
        onClose={() => {
          setShowEditDialog(false)
          setEditing(null)
        }}
        location={editing}
        onUpdated={handleLocationUpdated}
        onDeleted={handleLocationDeleted}
      />
    </div>
  )
}

export default LocationsManager
