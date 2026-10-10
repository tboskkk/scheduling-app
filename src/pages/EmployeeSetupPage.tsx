import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'

function EmployeeSetupPage() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  // Read the hash directly to determine token type for messaging
  const [tokenType] = useState<string | null>(() => new URLSearchParams(window.location.hash.replace('#', '')).get('type'))
  const [sessionReady, setSessionReady] = useState(false)

  useEffect(() => {
    // Only mark ready if the session came from an invite/recovery token in the URL hash.
    // Pre-authenticated users (e.g. a manager navigating here directly) should not be
    // able to use this page to change their password without a token.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        const hasToken = window.location.hash.includes('access_token')
        if (!hasToken) {
          // Authenticated but no invite/recovery token — redirect away
          navigate('/', { replace: true })
          return
        }
        setSessionReady(true)
      }
    })

    // Also listen for the invite/recovery token being exchanged from the URL hash.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') {
        setSessionReady(true)
      }
      if (!session) {
        setSessionReady(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [navigate])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)

    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setIsLoading(true)
    const { error: updateError } = await supabase.auth.updateUser({ password })
    setIsLoading(false)

    if (updateError) {
      setError(updateError.message)
      return
    }

    navigate('/employee/dashboard', { replace: true })
  }

  const isRecovery = tokenType === 'recovery'

  if (!sessionReady) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
        <div className="text-center space-y-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent mx-auto" />
          <p className="text-slate-400 text-sm">Verifying your invitation…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600 font-bold text-white text-xl mx-auto">
            S+
          </div>
          <h1 className="text-2xl font-semibold text-white">
            {isRecovery ? 'Reset your password' : 'Set up your account'}
          </h1>
          <p className="text-slate-400 text-sm">
            {isRecovery
              ? 'Enter a new password for your account.'
              : 'Choose a password to activate your Schedule+ account.'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-100">New password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              required
              minLength={8}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-slate-100 outline-hidden ring-2 ring-transparent transition focus:border-slate-500 focus:ring-slate-600"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-100">Confirm password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Repeat your password"
              required
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-slate-100 outline-hidden ring-2 ring-transparent transition focus:border-slate-500 focus:ring-slate-600"
            />
          </div>

          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:opacity-60"
          >
            {isLoading ? 'Saving…' : isRecovery ? 'Reset password' : 'Activate account'}
          </button>
        </form>
      </div>
    </div>
  )
}

export default EmployeeSetupPage
