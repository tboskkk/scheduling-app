import { create } from 'zustand'
import { supabase } from './supabaseClient'
import { DEFAULT_ORGANIZATION_SETTINGS } from '../types'
import type { Organization, OrganizationSettings } from '../types'

interface OrganizationStore {
  organization: Organization | null
  isLoading: boolean
  error: string | null
  fetchOrganization: () => Promise<void>
  updateSettings: (settings: OrganizationSettings) => Promise<void>
}

export const useOrganizationStore = create<OrganizationStore>((set, get) => ({
  organization: null,
  isLoading: false,
  error: null,
  fetchOrganization: async () => {
    set({ isLoading: true, error: null })
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      const { data: managerData, error: managerError } = await supabase
        .from('managers')
        .select('organization_id')
        .eq('id', user.id)
        .single()

      if (managerError) throw managerError

      const { data: orgData, error: orgError } = await supabase
        .from('organizations')
        .select('*')
        .eq('id', managerData.organization_id)
        .single()

      if (orgError) throw orgError

      // Merge with defaults to ensure all fields exist
      const settings = { ...DEFAULT_ORGANIZATION_SETTINGS, ...orgData.settings }
      
      set({ organization: { ...orgData, settings } })
    } catch (error: any) {
      set({ error: error.message })
    } finally {
      set({ isLoading: false })
    }
  },
  updateSettings: async (settings: OrganizationSettings) => {
    const { organization } = get()
    if (!organization) return

    set({ isLoading: true, error: null })
    try {
      const { error } = await supabase
        .from('organizations')
        .update({ settings })
        .eq('id', organization.id)

      if (error) throw error

      set({ organization: { ...organization, settings } })
    } catch (error: any) {
      set({ error: error.message })
    } finally {
      set({ isLoading: false })
    }
  },
}))
