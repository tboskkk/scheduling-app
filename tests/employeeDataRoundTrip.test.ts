import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const supabaseUrl = process.env.VITE_SUPABASE_PROJECT_URL!
const publishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY!
const secretKey = process.env.SUPABASE_SECRET_KEY

if (!supabaseUrl || !publishableKey || !secretKey) {
  throw new Error(
    'Set VITE_SUPABASE_PROJECT_URL, VITE_SUPABASE_PUBLISHABLE_KEY, and SUPABASE_SECRET_KEY to run employee round-trip tests.',
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

describe('Property 3: Employee Data Round-Trip', () => {
  let manager: ManagerContext

  beforeAll(async () => {
    manager = await provisionManager('EmployeeRoundTrip')
  })

  afterAll(async () => {
    await cleanup()
  })

  it('creates employee with roles, availability, and unavailability, then reads equivalent data', async () => {
    const { data: location, error: locationError } = await manager.client
      .from('locations')
      .insert({
        organization_id: manager.orgId,
        name: `Employee HQ ${randomUUID().slice(0, 6)}`,
        address: '100 Test Way',
        timezone: 'America/New_York',
      })
      .select('id, name')
      .single()

    expect(locationError).toBeNull()
    expect(location?.id).toBeDefined()

    const { data: role, error: roleError } = await manager.client
      .from('roles')
      .insert({
        organization_id: manager.orgId,
        name: 'Front Desk',
        color: '#5eead4',
      })
      .select('id, name')
      .single()

    expect(roleError).toBeNull()
    expect(role?.id).toBeDefined()

    const employeePayload = {
      organization_id: manager.orgId,
      home_location_id: location?.id,
      name: `Casey ${randomUUID().slice(0, 4)}`,
      email: 'casey@example.com',
      phone: '555-111-2222',
      hourly_rate: 19.75,
      is_floating: false,
      is_active: true,
    }

    const { data: employee, error: employeeError } = await manager.client
      .from('employees')
      .insert(employeePayload)
      .select('id, name, email, phone, hourly_rate, home_location_id, is_floating, is_active')
      .single()

    expect(employeeError).toBeNull()
    expect(employee?.home_location_id).toBe(location?.id)

    const { error: roleAssignError } = await manager.client
      .from('employee_roles')
      .insert({ employee_id: employee?.id, role_id: role?.id })
    expect(roleAssignError).toBeNull()

    const { error: availabilityError } = await manager.client.from('employee_availability').insert({
      organization_id: manager.orgId,
      employee_id: employee?.id,
      day_of_week: 1,
      start_time: '09:00',
      end_time: '17:00',
    })
    expect(availabilityError).toBeNull()

    const start = new Date(Date.now() + 48 * 60 * 60 * 1000)
    const end = new Date(start.getTime() + 3 * 60 * 60 * 1000)
    const { error: unavailabilityError } = await manager.client.from('employee_unavailability').insert({
      organization_id: manager.orgId,
      employee_id: employee?.id,
      start_datetime: start.toISOString(),
      end_datetime: end.toISOString(),
    })
    expect(unavailabilityError).toBeNull()

    const { data: fetchedEmployee, error: fetchEmployeeError } = await manager.client
      .from('employees')
      .select('id, name, email, phone, hourly_rate, home_location_id, is_floating, is_active')
      .eq('id', employee?.id)
      .single()

    expect(fetchEmployeeError).toBeNull()
    expect(fetchedEmployee).toMatchObject({
      name: employeePayload.name,
      email: employeePayload.email,
      phone: employeePayload.phone,
      hourly_rate: employeePayload.hourly_rate,
      home_location_id: employeePayload.home_location_id,
      is_floating: false,
      is_active: true,
    })

    const { data: fetchedRoles, error: fetchedRolesError } = await manager.client
      .from('employee_roles')
      .select('role_id')
      .eq('employee_id', employee?.id)

    expect(fetchedRolesError).toBeNull()
    expect(fetchedRoles?.map((r) => r.role_id)).toContain(role?.id)

    const { data: recurringAvailability, error: fetchAvailabilityError } = await manager.client
      .from('employee_availability')
      .select('day_of_week, start_time, end_time')
      .eq('employee_id', employee?.id)

    expect(fetchAvailabilityError).toBeNull()
    expect(recurringAvailability?.[0]).toMatchObject({
      day_of_week: 1,
      start_time: '09:00:00',
      end_time: '17:00:00',
    })

    const { data: unavailability, error: fetchUnavailabilityError } = await manager.client
      .from('employee_unavailability')
      .select('start_datetime, end_datetime')
      .eq('employee_id', employee?.id)

    expect(fetchUnavailabilityError).toBeNull()
    expect(new Date(unavailability?.[0]?.start_datetime || '').getTime()).toBe(start.getTime())
    expect(new Date(unavailability?.[0]?.end_datetime || '').getTime()).toBe(end.getTime())
  })
})
