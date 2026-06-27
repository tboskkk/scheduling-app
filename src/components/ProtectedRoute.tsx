import { Navigate, Outlet } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import LoadingSpinner from './LoadingSpinner'

type UserRole = 'manager' | 'employee' | null

interface ProtectedRouteProps {
  session: Session | null
  allowedRole: 'manager' | 'employee'
  userRole: UserRole
  isFetchingProfile?: boolean
  redirectTo?: string
}

function ProtectedRoute({ session, allowedRole, userRole, isFetchingProfile = false }: ProtectedRouteProps) {
  if (!session) {
    return <Navigate to="/login" replace />
  }

  // Wait for role resolution before deciding
  if (isFetchingProfile || userRole === null) {
    return <LoadingSpinner size="lg" className="min-h-screen" />
  }

  if (userRole !== allowedRole) {
    const redirect = userRole === 'employee' ? '/employee/dashboard' : '/dashboard'
    return <Navigate to={redirect} replace />
  }

  return <Outlet />
}

export default ProtectedRoute
