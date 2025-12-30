import type { ManagerProfile } from '../types'
import LocationsManager from '../components/LocationsManager'

interface LocationsPageProps {
  managerProfile: ManagerProfile | null
}

function LocationsPage({ managerProfile }: LocationsPageProps) {
  if (!managerProfile) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-6 text-sm text-slate-200">
        Add an organization to manage locations.
      </div>
    )
  }

  return <LocationsManager organizationId={managerProfile.organization_id} />
}

export default LocationsPage
