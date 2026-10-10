import { useState } from 'react'
import type { QuickShift } from '../types'
import { useOrganizationStore } from '../lib/useOrganizationStore'

interface QuickShiftsManagerProps {
  quickShifts: QuickShift[]
  onChange: (quickShifts: QuickShift[]) => void
}

interface EditingShift {
  id: string
  label: string
  start: string
  end: string
}

export default function QuickShiftsManager({ quickShifts, onChange }: QuickShiftsManagerProps) {
  const { organization } = useOrganizationStore()
  const [editingShift, setEditingShift] = useState<EditingShift | null>(null)
  const [isAdding, setIsAdding] = useState(false)

  const timeFormat = organization?.settings?.time_format || '12h'

  // Helper function to format time strings (HH:MM) for display
  const formatTimeForDisplay = (timeString: string) => {
    const [h, m] = timeString.split(':').map(Number)
    if (timeFormat === '24h') {
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
    }
    const hour12 = h % 12 || 12
    const ampm = h < 12 ? 'AM' : 'PM'
    return `${hour12}:${String(m).padStart(2, '0')} ${ampm}`
  }

  const handleAdd = () => {
    setEditingShift({
      id: crypto.randomUUID(),
      label: '',
      start: '09:00',
      end: '17:00'
    })
    setIsAdding(true)
  }

  const handleEdit = (shift: QuickShift) => {
    setEditingShift({ ...shift })
    setIsAdding(false)
  }

  const handleSave = () => {
    if (!editingShift || !editingShift.label.trim()) return

    if (isAdding) {
      onChange([...quickShifts, editingShift])
    } else {
      onChange(quickShifts.map(shift => 
        shift.id === editingShift.id ? editingShift : shift
      ))
    }
    
    setEditingShift(null)
    setIsAdding(false)
  }

  const handleCancel = () => {
    setEditingShift(null)
    setIsAdding(false)
  }

  const handleDelete = (id: string) => {
    onChange(quickShifts.filter(shift => shift.id !== id))
  }

  const validateTime = (time: string) => {
    return /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(time)
  }

  const isValidShift = editingShift && 
    editingShift.label.trim() && 
    validateTime(editingShift.start) && 
    validateTime(editingShift.end)

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-lg font-medium text-white">Quick Shifts</h3>
          <p className="text-sm text-slate-400">
            Customize the preset shift times available when creating shifts
          </p>
        </div>
        <button
          onClick={handleAdd}
          disabled={editingShift !== null}
          className="flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg text-sm font-medium transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
            <path d="M5 12h14"/>
            <path d="M12 5v14"/>
          </svg>
          Add Quick Shift
        </button>
      </div>

      <div className="space-y-2">
        {quickShifts.map((shift) => (
          <div key={shift.id} className="flex items-center justify-between p-3 bg-slate-800 rounded-lg">
            {editingShift?.id === shift.id ? (
              <div className="flex items-center gap-3 flex-1">
                <input
                  type="text"
                  value={editingShift.label}
                  onChange={(e) => setEditingShift({ ...editingShift, label: e.target.value })}
                  placeholder="Shift name"
                  className="px-3 py-1 bg-slate-700 border border-slate-600 rounded-sm text-white text-sm focus:outline-hidden focus:border-blue-500"
                />
                <input
                  type="time"
                  value={editingShift.start}
                  onChange={(e) => setEditingShift({ ...editingShift, start: e.target.value })}
                  className="px-3 py-1 bg-slate-700 border border-slate-600 rounded-sm text-white text-sm focus:outline-hidden focus:border-blue-500"
                />
                <span className="text-slate-400">–</span>
                <input
                  type="time"
                  value={editingShift.end}
                  onChange={(e) => setEditingShift({ ...editingShift, end: e.target.value })}
                  className="px-3 py-1 bg-slate-700 border border-slate-600 rounded-sm text-white text-sm focus:outline-hidden focus:border-blue-500"
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleSave}
                    disabled={!isValidShift}
                    className="p-1 text-green-400 hover:text-green-300 disabled:text-slate-500"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                      <path d="M20 6 9 17l-5-5"/>
                    </svg>
                  </button>
                  <button
                    onClick={handleCancel}
                    className="p-1 text-slate-400 hover:text-slate-300"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                      <path d="M18 6 6 18"/>
                      <path d="m6 6 12 12"/>
                    </svg>
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-3">
                  <span className="font-medium text-white">{shift.label}</span>
                  <span className="text-slate-400">{formatTimeForDisplay(shift.start)} – {formatTimeForDisplay(shift.end)}</span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleEdit(shift)}
                    disabled={editingShift !== null}
                    className="p-1 text-slate-400 hover:text-white disabled:text-slate-600"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                      <path d="M7 7H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-1"/>
                      <path d="M20.385 6.585a2.1 2.1 0 0 0-2.97-2.97L9 12v3h3l8.385-8.415Z"/>
                      <path d="M16 5l3 3"/>
                    </svg>
                  </button>
                  <button
                    onClick={() => handleDelete(shift.id)}
                    disabled={editingShift !== null}
                    className="p-1 text-slate-400 hover:text-red-400 disabled:text-slate-600"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                      <path d="M3 6h18"/>
                      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
                      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
                    </svg>
                  </button>
                </div>
              </>
            )}
          </div>
        ))}

        {isAdding && editingShift && (
          <div className="flex items-center gap-3 p-3 bg-slate-800 rounded-lg border-2 border-blue-500/50">
            <input
              type="text"
              value={editingShift.label}
              onChange={(e) => setEditingShift({ ...editingShift, label: e.target.value })}
              placeholder="Shift name"
              className="px-3 py-1 bg-slate-700 border border-slate-600 rounded-sm text-white text-sm focus:outline-hidden focus:border-blue-500"
              autoFocus
            />
            <input
              type="time"
              value={editingShift.start}
              onChange={(e) => setEditingShift({ ...editingShift, start: e.target.value })}
              className="px-3 py-1 bg-slate-700 border border-slate-600 rounded-sm text-white text-sm focus:outline-hidden focus:border-blue-500"
            />
            <span className="text-slate-400">–</span>
            <input
              type="time"
              value={editingShift.end}
              onChange={(e) => setEditingShift({ ...editingShift, end: e.target.value })}
              className="px-3 py-1 bg-slate-700 border border-slate-600 rounded-sm text-white text-sm focus:outline-hidden focus:border-blue-500"
            />
            <div className="flex gap-2">
              <button
                onClick={handleSave}
                disabled={!isValidShift}
                className="p-1 text-green-400 hover:text-green-300 disabled:text-slate-500"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                  <path d="M20 6 9 17l-5-5"/>
                </svg>
              </button>
              <button
                onClick={handleCancel}
                className="p-1 text-slate-400 hover:text-slate-300"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                  <path d="M18 6 6 18"/>
                  <path d="m6 6 12 12"/>
                </svg>
              </button>
            </div>
          </div>
        )}
      </div>

      {quickShifts.length === 0 && !isAdding && (
        <div className="text-center py-8 text-slate-400">
          <p>No quick shifts configured</p>
          <p className="text-sm">Add your first quick shift to get started</p>
        </div>
      )}
    </div>
  )
}