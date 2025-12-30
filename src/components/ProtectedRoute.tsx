import { Navigate, Outlet } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'

interface ProtectedRouteProps {
  session: Session | null
  redirectTo?: string
}

function ProtectedRoute({ session, redirectTo = '/login' }: ProtectedRouteProps) {
  if (!session) {
    return <Navigate to={redirectTo} replace />
  }

  return <Outlet />
}

export default ProtectedRoute
