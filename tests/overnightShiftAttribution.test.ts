import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const supabaseUrl = process.env.VITE_SUPABASE_PROJECT_URL!
const publishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY!
const secretKey = process.env.SUPABASE_SECRET_KEY

if (!supabaseUrl || !publishableKey || !secretKey) {
  throw new Error(
    'Set VITE_SUPABASE_PROJECT_URL, VITE_SUPABASE_PUBLISHABLE_KEY, and SUPABASE_SECRET_KEY to run overnight attribution tests.',
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

function localDateLabel(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso))
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

describe('Property 8: Overnight Shift Day Attribution', () => {
  let manager: ManagerContext
  let locationId: string
  const timeZone = 'America/Los_Angeles'

  beforeAll(async () => {
    manager = await provisionManager('OvernightAttribution')
    const { data: location, error: locationError } = await manager.client
      .from('locations')
      .insert({
        organization_id: manager.orgId,
        name: `Overnight ${randomUUID().slice(0, 6)}`,
        timezone: timeZone,
      })
      .select('id')
      .single()

    expect(locationError).toBeNull()
    locationId = location?.id as string
  })

  afterAll(async () => {
    await cleanup()
  })

  it('attributes overnight shifts to the calendar day they start in the location timezone', async () => {
    const startLocal = new Date()
    startLocal.setDate(startLocal.getDate() + 3)
    startLocal.setHours(0, 0, 0, 0)

    const startIso = toZonedISOString(startLocal, '22:00', timeZone)
    const endLocal = new Date(startLocal)
    endLocal.setDate(startLocal.getDate() + 1)
    const endIso = toZonedISOString(endLocal, '02:00', timeZone)

    const { data: shift, error: shiftError } = await manager.client
      .from('shifts')
      .insert({
        organization_id: manager.orgId,
        location_id: locationId,
        start_datetime: startIso,
        end_datetime: endIso,
      })
      .select('id, start_datetime, end_datetime')
      .single()

    expect(shiftError).toBeNull()
    expect(shift?.id).toBeDefined()

    const startDayLabel = localDateLabel(startIso, timeZone)
    const shiftStartDay = localDateLabel(shift?.start_datetime || '', timeZone)
    const shiftEndDay = localDateLabel(shift?.end_datetime || '', timeZone)

    expect(shiftStartDay).toBe(startDayLabel)
    expect(shiftEndDay).not.toBe(startDayLabel)

    const weekAnchor = new Date(startLocal)
    weekAnchor.setDate(weekAnchor.getDate() - weekAnchor.getDay())
    const weekStartIso = toZonedISOString(weekAnchor, '00:00', timeZone)
    const weekEnd = new Date(weekAnchor)
    weekEnd.setDate(weekAnchor.getDate() + 7)
    const weekEndIso = toZonedISOString(weekEnd, '00:00', timeZone)

    const { data: weeklyShifts, error: weeklyError } = await manager.client
      .from('shifts')
      .select('id, start_datetime')
      .gte('start_datetime', weekStartIso)
      .lt('start_datetime', weekEndIso)

    expect(weeklyError).toBeNull()
    const ids = (weeklyShifts ?? []).map((s) => s.id)
    expect(ids).toContain(shift?.id)
  })
})
