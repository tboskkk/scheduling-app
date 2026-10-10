import type { ValidationError } from '../../lib/rules-engine'
import { ConflictSeverity } from '../../lib/rules-engine'
import type { AddShiftParams, FixSuggestion } from '../../lib/fix-suggestions'

interface ErrorDetailsModalProps {
  isOpen: boolean
  onClose: () => void
  errors: ValidationError[]
  title?: string
  onShiftClick?: (shiftId: string) => void
  suggestions?: Map<string, FixSuggestion[]>
  onAddShift?: (params: AddShiftParams) => void
}

function formatCoverageTime(iso: string | undefined): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function ErrorDetailsModal({ isOpen, onClose, errors, title = "Schedule Issues", onShiftClick, suggestions, onAddShift }: ErrorDetailsModalProps) {
  if (!isOpen) return null

  const hardBlocks = errors.filter(e => e.severity === ConflictSeverity.HARD_BLOCK)
  const softWarnings = errors.filter(e => e.severity === ConflictSeverity.SOFT_WARNING)

  function renderError(error: ValidationError, color: 'red' | 'amber') {
    const c = color === 'red'
      ? { border: 'border-red-500/20', bg: 'bg-red-500/5', hoverBorder: 'hover:border-red-400/50', hoverBg: 'hover:bg-red-500/10', text: 'text-red-200', sub: 'text-red-400/70', jump: 'text-red-400/60 hover:text-red-300', fix: 'text-red-300 hover:text-red-100 border-red-500/30 hover:border-red-400/60' }
      : { border: 'border-amber-500/20', bg: 'bg-amber-500/5', hoverBorder: 'hover:border-amber-400/50', hoverBg: 'hover:bg-amber-500/10', text: 'text-amber-200', sub: 'text-amber-400/70', jump: 'text-amber-400/60 hover:text-amber-300', fix: 'text-amber-300 hover:text-amber-100 border-amber-500/30 hover:border-amber-400/60' }

    const isClickable = Boolean(error.shiftId && onShiftClick)
    const coverageStart = error.ruleType === 'COVERAGE_GAP' ? formatCoverageTime(error.meta?.startTime) : null
    const errorSuggestions = error.ruleType === 'COVERAGE_GAP' && !error.shiftId
      ? (suggestions?.get(error.id) ?? [])
      : []

    return (
      <div key={error.id} className={`rounded-md border ${c.border} ${c.bg} p-3`}>
        <div
          onClick={() => error.shiftId && onShiftClick?.(error.shiftId)}
          className={isClickable ? `cursor-pointer ${c.hoverBorder} ${c.hoverBg} -m-3 p-3 rounded-md` : ''}
        >
          <div className="flex items-start justify-between gap-2">
            <p className={`text-sm ${c.text}`}>{error.message}</p>
            {isClickable && (
              <span className={`shrink-0 text-xs ${c.jump}`}>Jump →</span>
            )}
          </div>
          {coverageStart && (
            <p className={`mt-0.5 text-xs ${c.sub}`}>{coverageStart}</p>
          )}
          <p className={`mt-1 text-xs ${c.sub}`}>Rule: {error.ruleType}</p>
        </div>

        {errorSuggestions.length > 0 && onAddShift && (
          <div className="mt-2 border-t border-slate-700/50 pt-2">
            <p className={`mb-1.5 text-xs font-medium ${c.sub}`}>Available to schedule:</p>
            <div className="flex flex-wrap gap-1.5">
              {errorSuggestions.map(s => (
                <button
                  key={s.employeeId}
                  onClick={() => onAddShift({
                    startTime: error.meta?.startTime ?? '',
                    endTime: error.meta?.endTime,
                    employeeId: s.employeeId,
                    employeeName: s.employeeName,
                    requirementId: error.meta?.requirementId,
                  })}
                  className={`rounded-sm border px-2 py-0.5 text-xs ${c.fix} transition-colors`}
                >
                  + {s.employeeName}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs">
      <div className="mx-4 w-full max-w-2xl rounded-lg border border-slate-700 bg-slate-900 shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-700 px-6 py-4">
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="max-h-112 overflow-y-auto p-6">
          {errors.length === 0 ? (
            <p className="text-center text-slate-400">No issues found</p>
          ) : (
            <div className="space-y-4">
              {hardBlocks.length > 0 && (
                <div>
                  <h3 className="mb-2 flex items-center gap-2 text-sm font-medium text-red-400">
                    <span>🔴</span>
                    Errors ({hardBlocks.length})
                  </h3>
                  <div className="space-y-2">
                    {hardBlocks.map((error) => renderError(error, 'red'))}
                  </div>
                </div>
              )}

              {softWarnings.length > 0 && (
                <div>
                  <h3 className="mb-2 flex items-center gap-2 text-sm font-medium text-amber-400">
                    <span>⚠️</span>
                    Warnings ({softWarnings.length})
                  </h3>
                  <div className="space-y-2">
                    {softWarnings.map((error) => renderError(error, 'amber'))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="border-t border-slate-700 px-6 py-4">
          <button
            onClick={onClose}
            className="rounded-md bg-slate-700 px-4 py-2 text-sm font-medium text-white hover:bg-slate-600"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
