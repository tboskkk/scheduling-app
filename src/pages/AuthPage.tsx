import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabaseClient'
import { isEmailAllowed } from '../lib/auth-utils'
import { checkRateLimit } from '../lib/security'

type UserRole = 'manager' | 'employee' | null

interface AuthPageProps {
  mode?: 'login' | 'register'
  session: Session | null
  userRole?: UserRole
}

function AuthPage({ mode = 'login', session, userRole }: AuthPageProps) {
  const navigate = useNavigate()
  const [authView, setAuthView] = useState<'login' | 'register'>(mode)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState<string | null>(null)
  const [infoMessage, setInfoMessage] = useState<string | null>(null)
  const [isAuthLoading, setIsAuthLoading] = useState(false)
  const [linkError, setLinkError] = useState<string | null>(null)

  useEffect(() => {
    const hashParams = new URLSearchParams(window.location.hash.replace('#', ''))
    const hashErrorDescription = hashParams.get('error_description')
    const hashError = hashParams.get('error')
    if (hashErrorDescription || hashError) {
      setLinkError(hashErrorDescription || hashError)
      window.history.replaceState({}, '', window.location.pathname + window.location.search)
    }
  }, [])

  useEffect(() => {
    setAuthView(mode)
  }, [mode])

  useEffect(() => {
    if (session) {
      const dest = userRole === 'employee' ? '/employee/dashboard' : '/dashboard'
      navigate(dest, { replace: true })
    }
  }, [session, userRole, navigate])

  const headline = useMemo(() => {
    if (authView === 'register') return 'Create your manager account'
    return 'Welcome back'
  }, [authView])

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setAuthError(null)
    setInfoMessage(null)
    setIsAuthLoading(true)

    if (!checkRateLimit('auth_attempt', 5, 60000)) {
      setAuthError('Too many attempts. Please try again later.')
      setIsAuthLoading(false)
      return
    }

    if (authView === 'login') {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setAuthError(error.message)
    } else {
      if (!isEmailAllowed(email)) {
        setAuthError('Registration is restricted to authorized email domains.')
        setIsAuthLoading(false)
        return
      }

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: window.location.origin },
      })
      if (error) {
        setAuthError(error.message)
      } else if (!data.session) {
        setInfoMessage('Check your inbox to confirm your email, then sign in to continue.')
        setAuthView('login')
      }
    }

    setIsAuthLoading(false)
  }

  if (session) {
    const dest = userRole === 'employee' ? '/employee/dashboard' : '/dashboard'
    return <Navigate to={dest} replace />
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-10 text-slate-100">
      <div className="w-full max-w-4xl rounded-2xl border border-slate-800 bg-slate-900/80 p-8 shadow-2xl shadow-black/40">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Schedule Builder</p>
            <h1 className="mt-2 text-3xl font-semibold text-white">Supabase Auth</h1>
            <p className="mt-1 text-sm text-slate-300">Email/password auth with live session awareness.</p>
          </div>
          <div className="inline-flex gap-2 rounded-full bg-slate-800 p-1 shadow-inner shadow-slate-950/40">
            <button
              type="button"
              onClick={() => setAuthView('login')}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition ${authView === 'login' ? 'bg-white text-slate-900 shadow' : 'text-slate-200 hover:text-white'}`}
            >
              Login
            </button>
            <button
              type="button"
              onClick={() => setAuthView('register')}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition ${authView === 'register' ? 'bg-white text-slate-900 shadow' : 'text-slate-200 hover:text-white'}`}
            >
              Register
            </button>
          </div>
        </div>

        <div className="mt-8 grid gap-6 md:grid-cols-[1.1fr_0.9fr]">
          <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/70 p-6">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Access</p>
              <h2 className="mt-2 text-xl font-semibold text-white">{headline}</h2>
              <p className="mt-1 text-sm text-slate-300">Sessions refresh automatically via Supabase.</p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-200">Work email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100 outline-none ring-2 ring-transparent transition focus:border-slate-500 focus:ring-slate-600"
                placeholder="jane.manager@example.com"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-200">Password</label>
              <input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100 outline-none ring-2 ring-transparent transition focus:border-slate-500 focus:ring-slate-600"
                placeholder="At least 8 characters"
              />
            </div>

            {linkError && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{linkError}</div>
            )}

            {authError && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{authError}</div>
            )}

            {infoMessage && (
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">{infoMessage}</div>
            )}

            <button
              type="submit"
              disabled={isAuthLoading}
              className="w-full rounded-xl bg-white px-4 py-3 text-sm font-semibold text-slate-900 transition hover:translate-y-[-1px] hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isAuthLoading ? 'Working…' : authView === 'login' ? 'Sign in' : 'Create account'}
            </button>
          </form>

          <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/60 p-6 text-sm text-slate-200">
            <div className="flex items-center gap-3">
              <span className="h-2 w-2 rounded-full bg-emerald-400" aria-hidden />
              Supabase Auth with live session listener
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-4 text-xs text-slate-300">
              Sessions stay in sync via onAuthStateChange. RLS keeps data scoped to the manager's organization.
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-4 text-xs text-slate-300">
              Use the sidebar after signing in to access dashboard, schedule, employees, and locations.
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default AuthPage
