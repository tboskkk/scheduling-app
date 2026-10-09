import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { getDemoConfig, isDemoUser, type DemoConfig } from '../lib/demo'

type DemoBannerProps = {
  email: string | null
  role: 'manager' | 'employee'
  config?: DemoConfig
}

const DEMO_UNAVAILABLE_MESSAGE = 'Demo is unavailable right now, try again later.'

export default function DemoBanner({ email, role, config }: DemoBannerProps) {
  const [isSwitching, setIsSwitching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const resolved = config ?? getDemoConfig()

  if (!isDemoUser(email, resolved)) return null

  const targetRole = role === 'manager' ? 'employee' : 'manager'
  const targetEmail = role === 'manager' ? resolved.demoEmployeeEmail : resolved.demoManagerEmail

  const switchAccount = async () => {
    if (isSwitching) return
    setIsSwitching(true)
    setError(null)
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: targetEmail,
        password: resolved.demoPassword,
      })
      if (signInError) setError(DEMO_UNAVAILABLE_MESSAGE)
    } catch {
      setError(DEMO_UNAVAILABLE_MESSAGE)
    } finally {
      setIsSwitching(false)
    }
  }

  return (
    <div className="flex items-center justify-center gap-3 bg-amber-400 px-3 py-1 text-xs font-medium text-amber-950">
      <span className="min-w-0 text-center">{error ?? "You're exploring the demo. Changes reset nightly."}</span>
      <button
        type="button"
        disabled={isSwitching}
        onClick={() => void switchAccount()}
        className="shrink-0 rounded-md bg-amber-950/10 px-2 py-0.5 font-semibold transition hover:bg-amber-950/20 disabled:cursor-not-allowed disabled:opacity-70"
      >
        Switch to {targetRole}
      </button>
    </div>
  )
}
