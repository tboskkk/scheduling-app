import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const supabaseUrl = process.env.VITE_SUPABASE_PROJECT_URL!
const publishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY!
const secretKey = process.env.SUPABASE_SECRET_KEY

if (!supabaseUrl || !publishableKey || !secretKey) {
  throw new Error(
    'Set VITE_SUPABASE_PROJECT_URL, VITE_SUPABASE_PUBLISHABLE_KEY, and SUPABASE_SECRET_KEY to run deletion guard tests.',
  )
}

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

describe('Property 2: Location Deletion Guards', () => {
  let manager: ManagerContext

  beforeAll(async () => {
    manager = await provisionManager('DeletionGuard')
  })

  afterAll(async () => {
    await cleanup()
  })

  it('blocks deleting a location that has future shifts', async () => {
    const { data: location, error: locationError } = await manager.client
      .from('locations')
      .insert({
        organization_id: manager.orgId,
        name: `Guarded Location ${randomUUID().slice(0, 6)}`,
        address: '123 Guard Lane',
        timezone: 'America/New_York',
      })
      .select('id, name')
      .single()

    expect(locationError).toBeNull()
    expect(location?.id).toBeDefined()

    const start = new Date()
    start.setDate(start.getDate() + 1)
    start.setHours(9, 0, 0, 0)
    const end = new Date(start.getTime() + 2 * 60 * 60 * 1000)
    const { error: shiftError } = await manager.client.from('shifts').insert({
      organization_id: manager.orgId,
      location_id: location?.id,
      start_datetime: start.toISOString(),
      end_datetime: end.toISOString(),
    })

    expect(shiftError).toBeNull()

    const deleteAttempt = await manager.client.from('locations').delete().eq('id', location?.id)
    expect(deleteAttempt.error).not.toBeNull()

    const { data: remainingLocation, error: fetchError } = await manager.client
      .from('locations')
      .select('id')
      .eq('id', location?.id)
      .maybeSingle()

    expect(fetchError).toBeNull()
    expect(remainingLocation?.id).toBe(location?.id)
  })

  it('allows deletion once future shifts are removed', async () => {
    const { data: location, error: locationError } = await manager.client
      .from('locations')
      .insert({
        organization_id: manager.orgId,
        name: `Safe Delete ${randomUUID().slice(0, 6)}`,
        address: '456 Clean Street',
        timezone: 'America/Chicago',
      })
      .select('id, name')
      .single()

    expect(locationError).toBeNull()
    expect(location?.id).toBeDefined()

    const start = new Date()
    start.setDate(start.getDate() + 1)
    start.setHours(10, 0, 0, 0)
    const end = new Date(start.getTime() + 60 * 60 * 1000)
    const { error: shiftError } = await manager.client.from('shifts').insert({
      organization_id: manager.orgId,
      location_id: location?.id,
      start_datetime: start.toISOString(),
      end_datetime: end.toISOString(),
    })

    expect(shiftError).toBeNull()

    const { error: removeShiftError } = await manager.client
      .from('shifts')
      .delete()
      .eq('location_id', location?.id)
    expect(removeShiftError).toBeNull()

    const deleteAttempt = await manager.client.from('locations').delete().eq('id', location?.id)
    expect(deleteAttempt.error).toBeNull()

    const { data: remainingLocation, error: fetchError } = await manager.client
      .from('locations')
      .select('id')
      .eq('id', location?.id)
      .maybeSingle()

    expect(fetchError).toBeNull()
    expect(remainingLocation).toBeNull()
  })
})
