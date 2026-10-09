import { useEffect, useState, Suspense, lazy } from 'react'
import type { Session } from '@supabase/supabase-js'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { supabase } from './lib/supabaseClient'
import './App.css'
import ProtectedRoute from './components/ProtectedRoute'
import AppLayout from './components/layout/AppLayout'
import LoadingSpinner from './components/LoadingSpinner'
import type { ManagerProfile, EmployeeProfile } from './types'
import { analytics } from './lib/analytics'

// Lazy load page components with preloading for critical routes
const AuthPage = lazy(() => import('./pages/AuthPage'))
const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const SchedulePage = lazy(() => import('./pages/SchedulePage'))
const EmployeesPage = lazy(() => import('./pages/EmployeesPage'))
const LocationsPage = lazy(() => import('./pages/LocationsPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const PrivacyPage = lazy(() => import('./pages/PrivacyPage'))
const EmployeeSetupPage = lazy(() => import('./pages/EmployeeSetupPage'))
const RequestsPage = lazy(() => import('./pages/RequestsPage'))

// Employee portal pages
const EmployeeLayout = lazy(() => import('./components/employee/EmployeeLayout'))
const EmployeeDashboardPage = lazy(() => import('./pages/employee/EmployeeDashboardPage'))
const EmployeeSchedulePage = lazy(() => import('./pages/employee/EmployeeSchedulePage'))
const TimeOffRequestsPage = lazy(() => import('./pages/employee/TimeOffRequestsPage'))
const ShiftTradeRequestsPage = lazy(() => import('./pages/employee/ShiftTradeRequestsPage'))

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

type UserRole = 'manager' | 'employee' | null

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [userRole, setUserRole] = useState<UserRole>(null)
  const [managerProfile, setManagerProfile] = useState<ManagerProfile | null>(null)
  const [employeeProfile, setEmployeeProfile] = useState<EmployeeProfile | null>(null)
  const [isFetchingProfile, setIsFetchingProfile] = useState(false)

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
        setEmployeeProfile(null)
        setUserRole(null)
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
    const loadProfile = async () => {
      if (!session?.user?.id) return
      setIsFetchingProfile(true)

      // 1. Try manager first — maybeSingle() returns null (not 406) when no row found
      const { data: managerData } = await supabase
        .from('managers')
        .select('organization_id, email')
        .eq('id', session.user.id)
        .maybeSingle()

      if (managerData) {
        setManagerProfile(managerData)
        setUserRole('manager')
        setIsFetchingProfile(false)
        return
      }

      // 2. Not a manager — check employee table
      const { data: empData } = await supabase
        .from('employees')
        .select('id, organization_id, name, email, home_location_id, is_active')
        .eq('user_id', session.user.id)
        .maybeSingle()

      if (empData) {
        // Load role_ids via employee_roles
        const { data: rolesData } = await supabase
          .from('employee_roles')
          .select('role_id')
          .eq('employee_id', empData.id)

        const profile: EmployeeProfile = {
          ...empData,
          role_ids: (rolesData ?? []).map((r: { role_id: string }) => r.role_id),
        }
        setEmployeeProfile(profile)
        setUserRole('employee')
      } else {
        setUserRole(null)
      }

      setIsFetchingProfile(false)
    }

    loadProfile()
  }, [session?.user?.id])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
  }

  const handleOrganizationCreated = (orgId: string) => {
    if (!session?.user) return
    const emailForManager = session.user.email ?? ''
    setManagerProfile({ organization_id: orgId, email: emailForManager })
    setUserRole('manager')
  }

  // Deactivated employee screen
  if (session && userRole === 'employee' && employeeProfile && !employeeProfile.is_active) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
        <div className="max-w-md text-center space-y-4">
          <div className="text-4xl">🔒</div>
          <h1 className="text-xl font-semibold text-white">Account Deactivated</h1>
          <p className="text-slate-400">Your account has been deactivated. Please contact your manager for assistance.</p>
          <button
            onClick={handleSignOut}
            className="mt-4 rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 hover:border-red-400 hover:text-red-200 transition"
          >
            Sign out
          </button>
        </div>
      </div>
    )
  }

  return (
    <BrowserRouter>
      <LocationTracker />
      <Suspense fallback={<LoadingSpinner size="lg" className="min-h-screen" />}>
        <Routes>
          {/* Public routes */}
          <Route path="/login" element={<AuthPage mode="login" session={session} userRole={userRole} />} />
          <Route path="/register" element={<AuthPage mode="register" session={session} userRole={userRole} />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/employee/setup" element={<EmployeeSetupPage />} />

          {/* Manager routes */}
          <Route element={<ProtectedRoute session={session} allowedRole="manager" userRole={userRole} isFetchingProfile={isFetchingProfile} />}>
            <Route
              element={
                session ? (
                  <AppLayout
                    session={session}
                    managerProfile={managerProfile}
                    onSignOut={handleSignOut}
                    isManagerLoading={isFetchingProfile}
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
                    isFetchingManager={isFetchingProfile}
                    onOrganizationCreated={handleOrganizationCreated}
                  />
                }
              />
              <Route path="/schedule/:locationId" element={<SchedulePage managerProfile={managerProfile} />} />
              <Route path="/schedule" element={<SchedulePage managerProfile={managerProfile} />} />
              <Route path="/employees" element={<EmployeesPage managerProfile={managerProfile} />} />
              <Route path="/locations" element={<LocationsPage managerProfile={managerProfile} />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/requests" element={<RequestsPage managerProfile={managerProfile} />} />
              <Route index element={<Navigate to="/dashboard" replace />} />
            </Route>
          </Route>

          {/* Employee routes */}
          <Route path="/employee" element={<Navigate to="/employee/dashboard" replace />} />
          <Route element={<ProtectedRoute session={session} allowedRole="employee" userRole={userRole} isFetchingProfile={isFetchingProfile} />}>
            <Route element={<EmployeeLayout employeeProfile={employeeProfile} onSignOut={handleSignOut} userEmail={session?.user.email ?? null} />}>
              <Route path="/employee/dashboard" element={<EmployeeDashboardPage employeeProfile={employeeProfile} />} />
              <Route path="/employee/schedule" element={<EmployeeSchedulePage employeeProfile={employeeProfile} />} />
              <Route path="/employee/time-off" element={<TimeOffRequestsPage employeeProfile={employeeProfile} />} />
              <Route path="/employee/trades" element={<ShiftTradeRequestsPage employeeProfile={employeeProfile} />} />
            </Route>
          </Route>

          {/* Role-aware catch-all */}
          <Route
            path="*"
            element={
              !session ? (
                <Navigate to="/login" replace />
              ) : isFetchingProfile ? (
                <LoadingSpinner size="lg" className="min-h-screen" />
              ) : userRole === null ? (
                <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
                  <div className="max-w-md text-center space-y-4">
                    <div className="text-4xl">⚠️</div>
                    <h1 className="text-xl font-semibold text-white">Account Not Linked</h1>
                    <p className="text-slate-400 text-sm">
                      Your account isn't linked to a manager or employee profile yet.
                      If you received an invite email, please use that link to set up your account.
                      Otherwise, contact your manager for assistance.
                    </p>
                    <button
                      onClick={handleSignOut}
                      className="mt-4 rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 hover:border-red-400 hover:text-red-200 transition"
                    >
                      Sign out
                    </button>
                  </div>
                </div>
              ) : userRole === 'employee' ? (
                <Navigate to="/employee/dashboard" replace />
              ) : (
                <Navigate to="/dashboard" replace />
              )
            }
          />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}

export default App
