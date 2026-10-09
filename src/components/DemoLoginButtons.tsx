import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { getDemoConfig, type DemoConfig } from '../lib/demo'

type DemoLoginButtonsProps = {
  config?: DemoConfig
  onError?: (message: string) => void
}

const DEMO_UNAVAILABLE_MESSAGE = 'Demo is unavailable right now, try again later.'

const buttonClass =
  'w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-sm font-semibold text-slate-100 transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-70'

export default function DemoLoginButtons({ config, onError }: DemoLoginButtonsProps) {
  const [isSigningIn, setIsSigningIn] = useState(false)
  const resolved = config ?? getDemoConfig()

  if (!resolved.demoMode) return null

  const signInAs = async (email: string) => {
    if (isSigningIn) return
    setIsSigningIn(true)
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password: resolved.demoPassword,
      })
      if (error) onError?.(DEMO_UNAVAILABLE_MESSAGE)
    } catch {
      onError?.(DEMO_UNAVAILABLE_MESSAGE)
    } finally {
      setIsSigningIn(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 text-xs uppercase tracking-[0.18em] text-slate-500">
        <span className="h-px flex-1 bg-slate-800" />
        <span>Try the demo</span>
        <span className="h-px flex-1 bg-slate-800" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          disabled={isSigningIn}
          onClick={() => void signInAs(resolved.demoManagerEmail)}
          className={buttonClass}
        >
          Try as manager
        </button>
        <button
          type="button"
          disabled={isSigningIn}
          onClick={() => void signInAs(resolved.demoEmployeeEmail)}
          className={buttonClass}
        >
          Try as employee
        </button>
      </div>
    </div>
  )
}
