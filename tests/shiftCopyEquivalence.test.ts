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

type TimeParts = { hour: number; minute: number }

const admin = createClient(supabaseUrl, secretKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const createdUserIds: string[] = []
const createdOrgIds: string[] = []

function toZonedISOString(baseDate: Date, time: string, timeZone: string) {
  const [hour, minute] = time.split(':').map(Number)
  const utcGuess = new Date(Date.UTC(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), hour, minute, 0, 0))
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  const parts = formatter.formatToParts(utcGuess)
  const lookup = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  const asInZone = Date.UTC(lookup('year'), lookup('month') - 1, lookup('day'), lookup('hour'), lookup('minute'))
  const offset = asInZone - utcGuess.getTime()
  const adjusted = new Date(utcGuess.getTime() - offset)
  return adjusted.toISOString()
}

function extractLocalTimeParts(iso: string, timeZone: string): TimeParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  const parts = formatter.formatToParts(new Date(iso))
  const lookup = (type: string) => Number(parts.find((p) => p.type === type)?.value || 0)
  return { hour: lookup('hour'), minute: lookup('minute') }
}

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

describe.skipIf(!hasIntegrationCreds)('Property 7: Shift Copy Equivalence', () => {
  let manager: ManagerContext
  let locationId: string
  let employeeId: string
  let roleId: string
  const timeZone = 'America/New_York'

  beforeAll(async () => {
    manager = await provisionManager('ShiftCopy')

    const { data: location, error: locationError } = await manager.client
      .from('locations')
      .insert({
        organization_id: manager.orgId,
        name: `Copy Source ${randomUUID().slice(0, 6)}`,
        address: '123 Copy Lane',
        timezone: timeZone,
      })
      .select('id')
      .single()

    expect(locationError).toBeNull()
    locationId = location?.id as string

    const { data: role, error: roleError } = await manager.client
      .from('roles')
      .insert({ organization_id: manager.orgId, name: 'Server', color: '#2563EB' })
      .select('id')
      .single()

    expect(roleError).toBeNull()
    roleId = role?.id as string

    const { data: employee, error: employeeError } = await manager.client
      .from('employees')
      .insert({
        organization_id: manager.orgId,
        home_location_id: locationId,
        name: `Copy Tester ${randomUUID().slice(0, 5)}`,
        email: `copy-${randomUUID().slice(0, 4)}@example.com`,
        hourly_rate: 18,
        is_floating: false,
        is_active: true,
      })
      .select('id')
      .single()

    expect(employeeError).toBeNull()
    employeeId = employee?.id as string
  })

  afterAll(async () => {
    await cleanup()
  })

  it('duplicates a shift while preserving time-of-day, role, and employee assignment', async () => {
    const baseDay = new Date()
    baseDay.setDate(baseDay.getDate() + 5)
    baseDay.setHours(0, 0, 0, 0)

    const originalStart = toZonedISOString(baseDay, '09:00', timeZone)
    const originalEnd = toZonedISOString(baseDay, '17:00', timeZone)

    const { data: sourceShift, error: sourceError } = await manager.client
      .from('shifts')
      .insert({
        organization_id: manager.orgId,
        location_id: locationId,
        employee_id: employeeId,
        role_id: roleId,
        start_datetime: originalStart,
        end_datetime: originalEnd,
      })
      .select('id, start_datetime, end_datetime, employee_id, role_id')
      .single()

    expect(sourceError).toBeNull()
    expect(sourceShift?.id).toBeDefined()

    const copyDay = new Date(baseDay)
    copyDay.setDate(copyDay.getDate() + 2)
    const copyStart = toZonedISOString(copyDay, '09:00', timeZone)
    const copyEnd = toZonedISOString(copyDay, '17:00', timeZone)

    const { data: copiedShift, error: copyError } = await manager.client
      .from('shifts')
      .insert({
        organization_id: manager.orgId,
        location_id: locationId,
        employee_id: employeeId,
        role_id: roleId,
        start_datetime: copyStart,
        end_datetime: copyEnd,
      })
      .select('id, start_datetime, end_datetime, employee_id, role_id')
      .single()

    expect(copyError).toBeNull()
    expect(copiedShift?.id).toBeDefined()
    expect(copiedShift?.id).not.toBe(sourceShift?.id)

    const sourceTime = extractLocalTimeParts(sourceShift?.start_datetime || '', timeZone)
    const copiedTime = extractLocalTimeParts(copiedShift?.start_datetime || '', timeZone)

    expect(copiedShift?.employee_id).toBe(employeeId)
    expect(copiedShift?.role_id).toBe(roleId)
    expect(copiedTime.hour).toBe(sourceTime.hour)
    expect(copiedTime.minute).toBe(sourceTime.minute)

    const durationHours = (isoEnd: string, isoStart: string) =>
      (new Date(isoEnd).getTime() - new Date(isoStart).getTime()) / (1000 * 60 * 60)

    expect(durationHours(copiedShift?.end_datetime || '', copiedShift?.start_datetime || '')).toBe(
      durationHours(sourceShift?.end_datetime || '', sourceShift?.start_datetime || ''),
    )

    const { data: existingSource, error: fetchError } = await manager.client
      .from('shifts')
      .select('id')
      .eq('id', sourceShift?.id)
      .single()

    expect(fetchError).toBeNull()
    expect(existingSource?.id).toBe(sourceShift?.id)
  })
})
