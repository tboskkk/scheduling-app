import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const supabaseUrl = process.env.VITE_SUPABASE_PROJECT_URL!
const publishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY!
const secretKey = process.env.SUPABASE_SECRET_KEY

if (!supabaseUrl || !publishableKey || !secretKey) {
  throw new Error(
    'Set VITE_SUPABASE_PROJECT_URL, VITE_SUPABASE_PUBLISHABLE_KEY, and SUPABASE_SECRET_KEY to run employee filtering tests.',
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

describe('Property 4: Employee Filtering by Location', () => {
  let manager: ManagerContext

  beforeAll(async () => {
    manager = await provisionManager('EmployeeFilter')
  })

  afterAll(async () => {
    await cleanup()
  })

  it('returns employees scoped by location filter while including floating employees', async () => {
    const { data: locations, error: locationError } = await manager.client
      .from('locations')
      .insert([
        { organization_id: manager.orgId, name: `North ${randomUUID().slice(0, 4)}`, timezone: 'America/New_York' },
        { organization_id: manager.orgId, name: `South ${randomUUID().slice(0, 4)}`, timezone: 'America/Chicago' },
      ])
      .select('id, name')

    expect(locationError).toBeNull()
    const [locationA, locationB] = locations ?? []
    expect(locationA?.id).toBeDefined()
    expect(locationB?.id).toBeDefined()

    const { data: roles, error: roleError } = await manager.client
      .from('roles')
      .insert([
        { organization_id: manager.orgId, name: 'Cashier', color: '#22d3ee' },
        { organization_id: manager.orgId, name: 'Manager', color: '#f97316' },
      ])
      .select('id, name')

    expect(roleError).toBeNull()
    const cashierRole = roles?.find((r) => r.name === 'Cashier')
    const managerRole = roles?.find((r) => r.name === 'Manager')
    expect(cashierRole?.id).toBeDefined()
    expect(managerRole?.id).toBeDefined()

    const { data: employees, error: employeeError } = await manager.client
      .from('employees')
      .insert([
        {
          organization_id: manager.orgId,
          home_location_id: locationA?.id,
          name: 'Alex A',
          email: 'alex@example.com',
          hourly_rate: 18.5,
          is_floating: false,
        },
        {
          organization_id: manager.orgId,
          home_location_id: locationB?.id,
          name: 'Bri B',
          email: 'bri@example.com',
          hourly_rate: 20,
          is_floating: false,
        },
        {
          organization_id: manager.orgId,
          home_location_id: locationB?.id,
          name: 'Floater F',
          email: 'floater@example.com',
          hourly_rate: 21,
          is_floating: true,
        },
      ])
      .select('id, name, home_location_id, is_floating')

    expect(employeeError).toBeNull()
    const alex = employees?.find((e) => e.name === 'Alex A')
    const bri = employees?.find((e) => e.name === 'Bri B')
    const floater = employees?.find((e) => e.name === 'Floater F')
    expect(alex?.id).toBeDefined()
    expect(bri?.id).toBeDefined()
    expect(floater?.id).toBeDefined()

    const { error: roleAttachError } = await manager.client.from('employee_roles').insert([
      { employee_id: alex?.id, role_id: cashierRole?.id },
      { employee_id: bri?.id, role_id: managerRole?.id },
      { employee_id: floater?.id, role_id: managerRole?.id },
    ])
    expect(roleAttachError).toBeNull()

    const { data: roster, error: rosterError } = await manager.client
      .from('employees')
      .select('id, name, home_location_id, is_floating, employee_roles(role_id)')
      .order('name', { ascending: true })

    expect(rosterError).toBeNull()

    const byLocationA = (roster || []).filter(
      (e) => e.is_floating || e.home_location_id === locationA?.id,
    )
    expect(byLocationA.map((e) => e.name)).toEqual(expect.arrayContaining(['Alex A', 'Floater F']))
    expect(byLocationA.map((e) => e.name)).not.toContain('Bri B')

    const byManagerRole = (roster || []).filter((e) =>
      (e.employee_roles || []).some((r: { role_id: string }) => r.role_id === managerRole?.id),
    )
    expect(byManagerRole.map((e) => e.name)).toEqual(expect.arrayContaining(['Bri B', 'Floater F']))
    expect(byManagerRole.map((e) => e.name)).not.toContain('Alex A')
  })
})
