import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const supabaseUrl = process.env.VITE_SUPABASE_PROJECT_URL ?? ''
const publishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? ''
const secretKey = process.env.SUPABASE_SECRET_KEY ?? ''
const hasIntegrationCreds = !!(
  process.env.VITE_SUPABASE_PROJECT_URL &&
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY &&
  process.env.SUPABASE_SECRET_KEY
)

type ManagerContext = {
  email: string
  password: string
  orgId: string
  userId: string
  client: SupabaseClient
}

const admin = createClient(supabaseUrl, secretKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const createdUserIds: string[] = []
const createdOrgIds: string[] = []

async function provisionManager(label: string): Promise<ManagerContext> {
  const email = `manager+${label}-${randomUUID()}@example.com`
  const password = `P@ssw0rd-${randomUUID().slice(0, 8)}`

  const { data: orgData, error: orgError } = await admin
    .from('organizations')
    .insert({ name: `${label} Org` })
    .select('id')
    .single()
  if (orgError || !orgData) throw orgError
  const orgId = orgData.id
  createdOrgIds.push(orgId)

  const { data: userData, error: userError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (userError || !userData?.user) throw userError
  const userId = userData.user.id
  createdUserIds.push(userId)

  const { error: managerError } = await admin
    .from('managers')
    .insert({ id: userId, organization_id: orgId, email })
  if (managerError) throw managerError

  const client = createClient(supabaseUrl, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { error: signInError } = await client.auth.signInWithPassword({ email, password })
  if (signInError) throw signInError

  return { email, password, orgId, userId, client }
}

async function cleanup() {
  if (createdOrgIds.length) {
    await admin.from('organizations').delete().in('id', createdOrgIds)
  }
  await Promise.all(createdUserIds.map((id) => admin.auth.admin.deleteUser(id)))
}

describe.skipIf(!hasIntegrationCreds)('Property 1: Location Data Round-Trip', () => {
  let manager: ManagerContext

  beforeAll(async () => {
    manager = await provisionManager('RoundTrip')
  })

  afterAll(async () => {
    await cleanup()
  })

  it('creates a location and retrieves equivalent data', async () => {
    const locationInput = {
      organization_id: manager.orgId,
      name: `Round Trip HQ ${randomUUID().slice(0, 6)}`,
      address: '123 Example Street, Test City',
      timezone: 'America/New_York',
    }

    const { data: createdLocation, error: createError } = await manager.client
      .from('locations')
      .insert(locationInput)
      .select('id, organization_id, name, address, timezone')
      .single()

    expect(createError).toBeNull()
    expect(createdLocation?.organization_id).toBe(manager.orgId)
    expect(createdLocation?.name).toBe(locationInput.name)
    expect(createdLocation?.address).toBe(locationInput.address)
    expect(createdLocation?.timezone).toBe(locationInput.timezone)

    const { data: fetchedLocation, error: fetchError } = await manager.client
      .from('locations')
      .select('id, organization_id, name, address, timezone')
      .eq('id', createdLocation?.id)
      .single()

    expect(fetchError).toBeNull()
    expect(fetchedLocation).toMatchObject({
      organization_id: manager.orgId,
      name: locationInput.name,
      address: locationInput.address,
      timezone: locationInput.timezone,
    })
  })
})
