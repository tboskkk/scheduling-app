import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { validateSchedule, ConflictSeverity } from '../src/lib/rules-engine'
import { OrganizationSettings } from '../src/types'

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

describe.skipIf(!hasIntegrationCreds)('Organization Settings', () => {
  let manager: ManagerContext

  beforeAll(async () => {
    manager = await provisionManager('OrgSettings')
  })

  afterAll(async () => {
    await cleanup()
  })

  it('Property 23: Organization Settings Round-Trip', async () => {
    // 1. Verify default settings
    const { data: org, error: fetchError } = await manager.client
      .from('organizations')
      .select('settings')
      .eq('id', manager.orgId)
      .single()
    
    expect(fetchError).toBeNull()
    expect(org?.settings).toEqual({}) // Default in DB is empty object, app merges with defaults

    // 2. Update settings
    const newSettings: OrganizationSettings = {
      weekly_overtime_threshold: 45,
      daily_overtime_threshold: 10,
      min_rest_period_hours: 12,
      week_start_day: 1, // Monday
      enable_california_rules: true,
      time_format: '24h',
      currency: 'CAD',
      quick_shifts: [],
    }

    const { error: updateError } = await manager.client
      .from('organizations')
      .update({ settings: newSettings })
      .eq('id', manager.orgId)

    expect(updateError).toBeNull()

    // 3. Fetch and verify
    const { data: updatedOrg, error: refetchError } = await manager.client
      .from('organizations')
      .select('settings')
      .eq('id', manager.orgId)
      .single()

    expect(refetchError).toBeNull()
    expect(updatedOrg?.settings).toEqual(newSettings)
  })

  it('Property 24: California Overtime Rules Application', async () => {
    // This test validates the logic in rules-engine, not necessarily the DB persistence
    // But we can simulate the flow where settings are passed to the validator

    const shifts = [
      {
        id: 's1',
        location_id: 'loc1',
        employee_id: 'emp1',
        role_id: 'role1',
        start_datetime: '2024-01-01T08:00:00Z', // 10 hours
        end_datetime: '2024-01-01T18:00:00Z'
      }
    ]
    const employees = [{ id: 'emp1', name: 'Test Emp', is_floating: false, home_location_id: 'loc1' }]

    // Case 1: CA Rules Disabled, Custom Thresholds (e.g. 12h daily)
    const configNoCA = {
      maxDailyHours: 12,
      maxWeeklyHours: 40,
      enableCaliforniaRules: false
    }
    
    const errorsNoCA = validateSchedule(shifts, employees, [], [], [], configNoCA)
    // Should be no error because 10h < 12h
    const dailyErrorsNoCA = errorsNoCA.filter(e => e.ruleType === 'DAILY_OVERTIME')
    expect(dailyErrorsNoCA.length).toBe(0)

    // Case 2: CA Rules Enabled (Forces 8h daily)
    const configCA = {
      maxDailyHours: 12, // User setting ignored
      maxWeeklyHours: 40,
      enableCaliforniaRules: true
    }

    const errorsCA = validateSchedule(shifts, employees, [], [], [], configCA)
    // Should have error because 10h > 8h (forced by CA rules)
    const dailyErrorsCA = errorsCA.filter(e => e.ruleType === 'DAILY_OVERTIME')
    expect(dailyErrorsCA.length).toBeGreaterThan(0)
    expect(dailyErrorsCA[0].severity).toBe(ConflictSeverity.SOFT_WARNING)
    expect(dailyErrorsCA[0].message).toContain('Daily overtime')
  })
})
