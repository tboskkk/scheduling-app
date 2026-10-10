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

// Created only with credentials so module load never throws (suites skip via hasIntegrationCreds).
const admin: SupabaseClient = hasIntegrationCreds
  ? createClient(supabaseUrl, secretKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : (null as never)

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

describe.skipIf(!hasIntegrationCreds)('Property 17: Coverage Rule Round-Trip', () => {
  let manager: ManagerContext
  let locationId: string
  let roleId: string

  beforeAll(async () => {
    manager = await provisionManager('CoverageRules')

    // Create Location
    const { data: loc } = await manager.client
      .from('locations')
      .insert({
        organization_id: manager.orgId,
        name: 'Test Location',
        address: '123 Test St',
        timezone: 'UTC'
      })
      .select('id')
      .single()
    locationId = loc!.id

    // Create Role
    const { data: role } = await manager.client
      .from('roles')
      .insert({
        organization_id: manager.orgId,
        name: 'Test Role',
        color: '#ff0000'
      })
      .select('id')
      .single()
    roleId = role!.id
  })

  afterAll(async () => {
    await cleanup()
  })

  it('creates a coverage rule and retrieves equivalent data', async () => {
    const ruleInput = {
      location_id: locationId,
      role_id: roleId,
      day_of_week: 1, // Monday
      start_time: '09:00:00',
      end_time: '17:00:00',
      min_employees: 2
    }

    const { data: createdRule, error: createError } = await manager.client
      .from('coverage_requirements')
      .insert(ruleInput)
      .select('*')
      .single()

    expect(createError).toBeNull()
    expect(createdRule).toMatchObject(ruleInput)

    const { data: fetchedRule, error: fetchError } = await manager.client
      .from('coverage_requirements')
      .select('*')
      .eq('id', createdRule!.id)
      .single()

    expect(fetchError).toBeNull()
    expect(fetchedRule).toMatchObject(ruleInput)
  })

  it('updates a coverage rule', async () => {
    const ruleInput = {
      location_id: locationId,
      role_id: roleId,
      day_of_week: 2, // Tuesday
      start_time: '10:00:00',
      end_time: '18:00:00',
      min_employees: 3
    }

    const { data: createdRule } = await manager.client
      .from('coverage_requirements')
      .insert(ruleInput)
      .select('id')
      .single()

    const { error: updateError } = await manager.client
      .from('coverage_requirements')
      .update({ min_employees: 5 })
      .eq('id', createdRule!.id)

    expect(updateError).toBeNull()

    const { data: updatedRule } = await manager.client
      .from('coverage_requirements')
      .select('min_employees')
      .eq('id', createdRule!.id)
      .single()

    expect(updatedRule?.min_employees).toBe(5)
  })

  it('deletes a coverage rule', async () => {
    const ruleInput = {
      location_id: locationId,
      role_id: roleId,
      day_of_week: 3, // Wednesday
      start_time: '12:00:00',
      end_time: '20:00:00',
      min_employees: 1
    }

    const { data: createdRule } = await manager.client
      .from('coverage_requirements')
      .insert(ruleInput)
      .select('id')
      .single()

    const { error: deleteError } = await manager.client
      .from('coverage_requirements')
      .delete()
      .eq('id', createdRule!.id)

    expect(deleteError).toBeNull()

    const { data: fetchedRule } = await manager.client
      .from('coverage_requirements')
      .select('*')
      .eq('id', createdRule!.id)
      .single()

    expect(fetchedRule).toBeNull()
  })
})
