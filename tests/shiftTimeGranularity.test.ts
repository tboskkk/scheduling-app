import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const supabaseUrl = process.env.VITE_SUPABASE_PROJECT_URL
const publishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY
const secretKey = process.env.SUPABASE_SECRET_KEY

if (!supabaseUrl || !publishableKey || !secretKey) {
  throw new Error(
    'Set VITE_SUPABASE_PROJECT_URL, VITE_SUPABASE_PUBLISHABLE_KEY, and SUPABASE_SECRET_KEY to run shift granularity tests.',
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

  const { error: managerError } = await admin.from('managers').insert({ id: userId, organization_id: orgId, email })
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

describe('Property 6: Shift Time Granularity', () => {
  let manager: ManagerContext
  let locationId: string

  beforeAll(async () => {
    manager = await provisionManager('ShiftGranularity')
    const { data: location, error: locationError } = await manager.client
      .from('locations')
      .insert({
        organization_id: manager.orgId,
        name: `Granularity ${randomUUID().slice(0, 6)}`,
        timezone: 'America/New_York',
      })
      .select('id')
      .single()

    expect(locationError).toBeNull()
    locationId = location?.id as string
  })

  afterAll(async () => {
    await cleanup()
  })

  it('rejects shifts not aligned to 15-minute increments and accepts valid ones', async () => {
    const invalidStart = new Date()
    invalidStart.setDate(invalidStart.getDate() + 2)
    invalidStart.setHours(9, 10, 0, 0)
    const invalidEnd = new Date(invalidStart.getTime() + 90 * 60 * 1000)

    const invalidAttempt = await manager.client.from('shifts').insert({
      organization_id: manager.orgId,
      location_id: locationId,
      start_datetime: invalidStart.toISOString(),
      end_datetime: invalidEnd.toISOString(),
    })

    expect(invalidAttempt.error).not.toBeNull()

    const validStart = new Date()
    validStart.setDate(validStart.getDate() + 3)
    validStart.setHours(10, 15, 0, 0)
    const validEnd = new Date(validStart.getTime() + 150 * 60 * 1000)

    const { data: validShift, error: validError } = await manager.client
      .from('shifts')
      .insert({
        organization_id: manager.orgId,
        location_id: locationId,
        start_datetime: validStart.toISOString(),
        end_datetime: validEnd.toISOString(),
      })
      .select('id, start_datetime, end_datetime')
      .single()

    expect(validError).toBeNull()
    expect(validShift?.id).toBeDefined()
    expect(new Date(validShift?.start_datetime || '').getMinutes() % 15).toBe(0)
    expect(new Date(validShift?.end_datetime || '').getMinutes() % 15).toBe(0)
  })
})
