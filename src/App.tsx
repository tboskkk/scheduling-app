import { useEffect, useState, Suspense, lazy } from 'react'
import type { Session } from '@supabase/supabase-js'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { supabase } from './lib/supabaseClient'
import './App.css'
import ProtectedRoute from './components/ProtectedRoute'
import AppLayout from './components/layout/AppLayout'
import LoadingSpinner from './components/LoadingSpinner'
import type { ManagerProfile } from './types'
import { analytics } from './lib/analytics'

// Lazy load page components with preloading for critical routes
const AuthPage = lazy(() => import('./pages/AuthPage'))
const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const SchedulePage = lazy(() => import('./pages/SchedulePage'))
const EmployeesPage = lazy(() => import('./pages/EmployeesPage'))
const LocationsPage = lazy(() => import('./pages/LocationsPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const PrivacyPage = lazy(() => import('./pages/PrivacyPage'))

// Preload critical routes after initial load
const preloadCriticalRoutes = () => {
  // Preload dashboard and schedule pages as they're most commonly accessed
  import('./pages/DashboardPage')
  import('./pages/SchedulePage')
}

function LocationTracker() {
  const location = useLocation()

  useEffect(() => {
    analytics.pageView(location.pathname)
  }, [location])

  return null
}

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [managerProfile, setManagerProfile] = useState<ManagerProfile | null>(null)
  const [isFetchingManager, setIsFetchingManager] = useState(false)

  useEffect(() => {
    const bootstrapSession = async () => {
      const { data, error } = await supabase.auth.getSession()
      if (error) return
      setSession(data.session ?? null)
      
      // Preload critical routes if user is authenticated
      if (data.session) {
        setTimeout(preloadCriticalRoutes, 100)
      }
    }

    bootstrapSession()
    const { data: subscription } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession ?? null)
      if (event === 'SIGNED_OUT') {
        setManagerProfile(null)
      } else if (event === 'SIGNED_IN' && nextSession) {
        // Preload critical routes on sign in
        setTimeout(preloadCriticalRoutes, 100)
      }
    })

    return () => {
      subscription?.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    const loadManagerProfile = async () => {
      if (!session?.user?.id) return
      setIsFetchingManager(true)
      
      // Retry logic to handle potential replication lag or race conditions
      let retries = 3
      let data = null
      let error = null

      while (retries > 0) {
        const result = await supabase
          .from('managers')
          .select('organization_id, email')
          .single()
        
        data = result.data
        error = result.error

        if (data || error?.code !== 'PGRST116') {
          break
        }
        
        // If not found, wait a bit and retry
        retries--
        if (retries > 0) await new Promise(r => setTimeout(r, 500))
      }

      if (data) {
        setManagerProfile(data)
      } else if (error?.code !== 'PGRST116') {
        console.error(error?.message ?? 'Unable to load manager profile')
      } else {
        setManagerProfile(null)
      }

      setIsFetchingManager(false)
    }

    loadManagerProfile()
  }, [session?.user?.id])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
  }

  const handleOrganizationCreated = (orgId: string) => {
    if (!session?.user) return
    const emailForManager = session.user.email ?? ''
    setManagerProfile({ organization_id: orgId, email: emailForManager })
  }

  return (
    <BrowserRouter>
      <LocationTracker />
      <Suspense fallback={<LoadingSpinner size="lg" className="min-h-screen" />}>
        <Routes>
          <Route path="/login" element={<AuthPage mode="login" session={session} />} />
          <Route path="/register" element={<AuthPage mode="register" session={session} />} />
          <Route path="/privacy" element={<PrivacyPage />} />

          <Route element={<ProtectedRoute session={session} />}>
            <Route
              element={
                session ? (
                  <AppLayout
                    session={session}
                    managerProfile={managerProfile}
                    onSignOut={handleSignOut}
                    isManagerLoading={isFetchingManager}
                  />
                ) : (
                  <Navigate to="/login" replace />
                )
              }
            >
              <Route
                path="/dashboard"
                element={
                  <DashboardPage
                    managerProfile={managerProfile}
                    isFetchingManager={isFetchingManager}
                    onOrganizationCreated={handleOrganizationCreated}
                    userEmail={session?.user?.email ?? ''}
                  />
                }
              />
              <Route path="/schedule/:locationId" element={<SchedulePage managerProfile={managerProfile} />} />
              <Route path="/schedule" element={<SchedulePage managerProfile={managerProfile} />} />
              <Route path="/employees" element={<EmployeesPage managerProfile={managerProfile} />} />
              <Route path="/locations" element={<LocationsPage managerProfile={managerProfile} />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route index element={<Navigate to="/dashboard" replace />} />
            </Route>
          </Route>

          <Route path="*" element={<Navigate to={session ? '/dashboard' : '/login'} replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}

export default App
