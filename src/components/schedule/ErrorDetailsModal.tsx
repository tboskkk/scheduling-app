import type { ValidationError } from '../../lib/rules-engine'
import { ConflictSeverity } from '../../lib/rules-engine'

interface ErrorDetailsModalProps {
  isOpen: boolean
  onClose: () => void
  errors: ValidationError[]
  title?: string
}

export function ErrorDetailsModal({ isOpen, onClose, errors, title = "Schedule Issues" }: ErrorDetailsModalProps) {
  if (!isOpen) return null

  const hardBlocks = errors.filter(e => e.severity === ConflictSeverity.HARD_BLOCK)
  const softWarnings = errors.filter(e => e.severity === ConflictSeverity.SOFT_WARNING)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
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
        
        <div className="max-h-96 overflow-y-auto p-6">
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
                    {hardBlocks.map((error) => (
                      <div key={error.id} className="rounded-md border border-red-500/20 bg-red-500/5 p-3">
                        <p className="text-sm text-red-200">{error.message}</p>
                        <p className="mt-1 text-xs text-red-400/70">Rule: {error.ruleType}</p>
                        {error.shiftId && (
                          <p className="mt-1 text-xs text-red-400/70">Shift ID: {error.shiftId}</p>
                        )}
                      </div>
                    ))}
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
                    {softWarnings.map((error) => (
                      <div key={error.id} className="rounded-md border border-amber-500/20 bg-amber-500/5 p-3">
                        <p className="text-sm text-amber-200">{error.message}</p>
                        <p className="mt-1 text-xs text-amber-400/70">Rule: {error.ruleType}</p>
                        {error.shiftId && (
                          <p className="mt-1 text-xs text-amber-400/70">Shift ID: {error.shiftId}</p>
                        )}
                      </div>
                    ))}
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