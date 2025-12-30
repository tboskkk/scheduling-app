import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const supabaseUrl = process.env.VITE_SUPABASE_PROJECT_URL!
const publishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY!
const secretKey = process.env.SUPABASE_SECRET_KEY

if (!supabaseUrl || !publishableKey || !secretKey) {
  throw new Error(
    'Set VITE_SUPABASE_PROJECT_URL, VITE_SUPABASE_PUBLISHABLE_KEY, and SUPABASE_SECRET_KEY to run organization isolation tests.',
  )
}

type ManagerContext = {
  email: string
  password: string
  userId: string
  orgId: string
  client: SupabaseClient
}

const admin = createClient(supabaseUrl, secretKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const createdUserIds: string[] = []
const createdOrgIds: string[] = []

async function provisionManager(label: string): Promise<ManagerContext> {
  const email = `manager+${label.toLowerCase()}-${randomUUID()}@example.com`
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

  return { email, password, userId, orgId, client }
}

async function cleanup() {
  if (createdOrgIds.length) {
    await admin.from('organizations').delete().in('id', createdOrgIds)
  }
  await Promise.all(createdUserIds.map((id) => admin.auth.admin.deleteUser(id)))
}

describe('Property 21: Organization Data Isolation', () => {
  let managerA: ManagerContext
  let managerB: ManagerContext

  beforeAll(async () => {
    managerA = await provisionManager('A')
    managerB = await provisionManager('B')
  })

  afterAll(async () => {
    await cleanup()
  })

  it('managers can access only data within their organization', async () => {
    const { data: createdLocation, error: createLocationError } = await managerA.client
      .from('locations')
      .insert({
        organization_id: managerA.orgId,
        name: 'Org A - HQ',
        timezone: 'America/New_York',
      })
      .select('id, organization_id')
      .single()

    expect(createLocationError).toBeNull()
    expect(createdLocation?.organization_id).toBe(managerA.orgId)

    const { data: managerAResult, error: managerASelectError } = await managerA.client
      .from('locations')
      .select('id, organization_id')
      .eq('id', createdLocation?.id)

    expect(managerASelectError).toBeNull()
    expect(managerAResult).toHaveLength(1)
    expect(managerAResult?.[0]?.organization_id).toBe(managerA.orgId)

    const { data: managerBResult, error: managerBSelectError } = await managerB.client
      .from('locations')
      .select('id, organization_id')
      .eq('id', createdLocation?.id)

    expect(managerBSelectError).toBeNull()
    expect(managerBResult).toHaveLength(0)
  })

  it('managers cannot create resources inside another organization', async () => {
    const { error: crossInsertError } = await managerA.client.from('locations').insert({
      organization_id: managerB.orgId,
      name: 'Should Fail',
      timezone: 'UTC',
    })

    expect(crossInsertError).toBeTruthy()
  })
})
