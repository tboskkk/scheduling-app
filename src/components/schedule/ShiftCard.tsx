import { CSS } from '@dnd-kit/utilities'
import { useDraggable } from '@dnd-kit/core'
import type { ShiftRecord } from '../../types'
import { formatDurationLabel, formatTimeRange, hoursBetween, isOvernightShift, type TimeDisplayFormat } from './time'
import { ConflictSeverity, type ValidationError } from '../../lib/rules-engine'

export type RoleInfo = {
  id: string
  name: string
  color: string | null
}

type ShiftCardProps = {
  shift: ShiftRecord
  role: RoleInfo | null
  timezone: string | null
  isSelected?: boolean
  isSelectionMode?: boolean
  timeFormat?: TimeDisplayFormat
  onClick?: (shift: ShiftRecord, e: React.MouseEvent) => void
  validationErrors?: ValidationError[]
}

function ShiftCard({ shift, role, timezone, isSelected, isSelectionMode, onClick, validationErrors = [], timeFormat = '12h' }: ShiftCardProps) {
  const rawDuration = hoursBetween(shift.start_datetime, shift.end_datetime)
  
  let breakHours = 0
  let breakLabel = null
  
  if (shift.break_start_datetime && shift.break_end_datetime) {
    const bStart = new Date(shift.break_start_datetime).getTime()
    const bEnd = new Date(shift.break_end_datetime).getTime()
    breakHours = Math.max(0, (bEnd - bStart) / (1000 * 60 * 60))
    
    const breakRange = formatTimeRange(shift.break_start_datetime, shift.break_end_datetime, timezone, timeFormat)
    breakLabel = `Break: ${breakRange}`
  }

  const durationHours = Math.max(0, rawDuration - breakHours)
  const isOvernight = isOvernightShift(shift.start_datetime, shift.end_datetime)

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `shift-${shift.id}`,
    data: { type: 'shift', shift },
    disabled: isSelectionMode,
  })

  const hasHardBlock = validationErrors.some((e) => e.severity === ConflictSeverity.HARD_BLOCK)
  const hasSoftWarning = validationErrors.some((e) => e.severity === ConflictSeverity.SOFT_WARNING)

  const style = transform ? { transform: CSS.Translate.toString(transform) } : undefined
  
  let borderClass = 'border-slate-700/80'
  if (hasHardBlock) {
    borderClass = 'border-red-500 ring-1 ring-red-500'
  } else if (hasSoftWarning) {
    borderClass = 'border-amber-500 ring-1 ring-amber-500'
  }

  const cardActiveClass = isDragging
    ? 'ring-2 ring-blue-500/60 shadow-lg shadow-blue-900/40 z-20'
    : isSelected
      ? 'ring-2 ring-emerald-400 shadow-lg shadow-emerald-900/20 z-10'
      : ''

  const tooltipText = validationErrors.length > 0 
    ? validationErrors.map(e => `${e.severity === ConflictSeverity.HARD_BLOCK ? '⛔' : '⚠️'} ${e.message}`).join('\n')
    : undefined

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={(e) => onClick?.(shift, e)}
      title={tooltipText}
      className={`group relative w-full cursor-grab rounded-lg border bg-slate-900/85 px-3 py-2 text-[12px] text-slate-100 shadow-sm shadow-black/30 transition ${borderClass} ${cardActiveClass} ${isSelectionMode ? 'cursor-pointer' : ''}`}
    >
      {(hasHardBlock || hasSoftWarning) && (
        <div className="absolute -right-1.5 -top-1.5 z-30 flex h-4 w-4 items-center justify-center rounded-full bg-slate-900 shadow-sm ring-1 ring-slate-950">
          <span className="text-[10px] leading-none">{hasHardBlock ? '🔴' : '⚠️'}</span>
        </div>
      )}
      <div className="flex items-center justify-between text-[11px] font-semibold text-slate-200">
        <span className="inline-flex items-center gap-2">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full border border-slate-600"
            style={{ backgroundColor: role?.color || '#38bdf8', borderColor: role?.color || '#0ea5e9' }}
            aria-hidden
          />
          <span className="text-white">{role?.name && role.name.length > 0 ? role.name : 'Shift'}</span>
        </span>
        <span className="rounded-full bg-slate-800 px-2 py-[2px] text-[10px] font-semibold text-slate-200">
          {formatDurationLabel(durationHours)}
        </span>
      </div>

      <div className="mt-1 flex items-center justify-between">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-white">
          <span>{formatTimeRange(shift.start_datetime, shift.end_datetime, timezone, timeFormat)}</span>
          {isOvernight && <span className="text-[12px]" title="Crosses midnight">🌙</span>}
        </div>
      </div>

      {breakLabel && (
        <div className="mt-1 text-[10px] text-slate-400">
          {breakLabel}
        </div>
      )}

      <p className="mt-1 text-[11px] text-slate-400">{timezone || 'Local time'}</p>
    </div>
  )
}

export default ShiftCard
