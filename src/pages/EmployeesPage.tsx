import type { ManagerProfile } from '../types'
import EmployeesManager from '../components/EmployeesManager'

interface EmployeesPageProps {
  managerProfile: ManagerProfile | null
}

function EmployeesPage({ managerProfile }: EmployeesPageProps) {
  if (!managerProfile) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-6 text-sm text-slate-200">
        Add an organization to manage employees.
      </div>
    )
  }

  return <EmployeesManager organizationId={managerProfile.organization_id} userEmail={managerProfile.email} />
}

export default EmployeesPage
