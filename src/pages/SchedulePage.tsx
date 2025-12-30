import { useParams } from 'react-router-dom'
import type { ManagerProfile } from '../types'
import ScheduleGrid from '../components/schedule/ScheduleGrid'

interface SchedulePageProps {
  managerProfile: ManagerProfile | null
}

function SchedulePage({ managerProfile }: SchedulePageProps) {
  const { locationId } = useParams()
  const organizationId = managerProfile?.organization_id
  const canShow = Boolean(organizationId && locationId)

  if (!managerProfile) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-6 text-sm text-slate-200">
        Connect an organization to view schedules.
      </div>
    )
  }

  if (!locationId) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-6 text-sm text-slate-200">
        Pick a location from the sidebar to open the schedule grid.
      </div>
    )
  }

  return canShow ? (
    <ScheduleGrid organizationId={organizationId!} locationId={locationId!} />
  ) : (
    <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-6 text-sm text-slate-200">Loading schedule…</div>
  )
}

export default SchedulePage
