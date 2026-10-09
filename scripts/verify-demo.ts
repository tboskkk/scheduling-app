// Live check that the demo logins work and the demo employee is isolated.
// Run from the repo root: bun scripts/verify-demo.ts
// Bun loads .env automatically. Exits 1 if any check fails.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const DEMO_ORG_ID = 'd3e00000-0000-4000-8000-000000000001'
const EXPECTED_LOCATIONS = 2
const EXPECTED_EMPLOYEES = 12

function requireEnv(names: string[], hint: string): Record<string, string> {
  const missing = names.filter((name) => !process.env[name])
  if (missing.length > 0) {
    console.error(`Missing in .env: ${missing.join(', ')}`)
    console.error(hint)
    process.exit(1)
  }
  return Object.fromEntries(names.map((name) => [name, process.env[name] as string]))
}

const project = requireEnv(
  ['VITE_SUPABASE_PROJECT_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY'],
  'Run this from the repo root so bun picks up .env.',
)
const demo = requireEnv(
  ['VITE_DEMO_MANAGER_EMAIL', 'VITE_DEMO_EMPLOYEE_EMAIL', 'VITE_DEMO_PASSWORD'],
  'Add the demo login variables to .env, then run this again.',
)

let failures = 0

function report(name: string, ok: boolean, detail: string) {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}

function newClient(): SupabaseClient {
  return createClient(project.VITE_SUPABASE_PROJECT_URL, project.VITE_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

async function signIn(client: SupabaseClient, email: string, label: string): Promise<string | null> {
  const { data, error } = await client.auth.signInWithPassword({ email, password: demo.VITE_DEMO_PASSWORD })
  const userId = data.user?.id ?? null
  report(`${label} sign-in`, !error && !!userId, error ? error.message : email)
  return error ? null : userId
}

async function checkManager() {
  const client = newClient()
  const userId = await signIn(client, demo.VITE_DEMO_MANAGER_EMAIL, 'manager')
  if (!userId) {
    report('manager checks', false, 'skipped, sign-in failed')
    return
  }

  const manager = await client.from('managers').select('id, organization_id').eq('id', userId).maybeSingle()
  report(
    'manager row found in demo org',
    !manager.error && manager.data?.organization_id === DEMO_ORG_ID,
    manager.error ? manager.error.message : `organization_id=${manager.data?.organization_id ?? 'none'}`,
  )

  const locations = await client.from('locations').select('id', { count: 'exact', head: true })
  report(
    `manager sees ${EXPECTED_LOCATIONS} locations`,
    !locations.error && locations.count === EXPECTED_LOCATIONS,
    locations.error ? locations.error.message : `count=${locations.count}`,
  )

  const employees = await client.from('employees').select('id', { count: 'exact', head: true })
  report(
    `manager sees ${EXPECTED_EMPLOYEES} employees`,
    !employees.error && employees.count === EXPECTED_EMPLOYEES,
    employees.error ? employees.error.message : `count=${employees.count}`,
  )

  await client.auth.signOut()
}

async function checkEmployee() {
  const client = newClient()
  const userId = await signIn(client, demo.VITE_DEMO_EMPLOYEE_EMAIL, 'employee')
  if (!userId) {
    report('employee checks', false, 'skipped, sign-in failed')
    return
  }

  const own = await client.from('employees').select('id, name').eq('user_id', userId)
  const ownId = own.data?.length === 1 ? own.data[0].id : null
  report(
    'employee finds exactly one own employees row',
    !own.error && ownId !== null,
    own.error ? own.error.message : `rows=${own.data?.length ?? 0}`,
  )

  const timeOff = await client.from('time_off_requests').select('id, employee_id')
  const timeOffRows = timeOff.data ?? []
  const othersTimeOff = timeOffRows.filter((row) => row.employee_id !== ownId).length
  report(
    'employee sees only own time_off_requests',
    !timeOff.error && ownId !== null && timeOffRows.length > 0 && othersTimeOff === 0,
    timeOff.error ? timeOff.error.message : `rows=${timeOffRows.length}, not own=${othersTimeOff}`,
  )

  const names = await client.from('employee_public_profiles').select('id, name')
  const named = (names.data ?? []).filter((row) => typeof row.name === 'string' && row.name.length > 0)
  report(
    'colleague view returns names',
    !names.error && named.length > 1,
    names.error ? names.error.message : `rows with a name=${named.length}`,
  )

  // The view must not expose these columns: PostgREST rejects unknown columns
  // (42703). If it ever returns rows, none may carry the keys.
  const hidden = await client.from('employee_public_profiles').select('hourly_rate, email, phone')
  const leakedKeys = new Set<string>()
  for (const row of (hidden.data ?? []) as Record<string, unknown>[]) {
    for (const key of ['hourly_rate', 'email', 'phone']) {
      if (key in row) leakedKeys.add(key)
    }
  }
  report(
    'colleague view hides hourly_rate, email, phone',
    hidden.error ? hidden.error.code === '42703' : leakedKeys.size === 0,
    hidden.error ? `rejected: ${hidden.error.message}` : `leaked=${[...leakedKeys].join(', ') || 'none'}`,
  )

  // Manager-only columns of colleagues must not be readable: either the column
  // is refused (42501) or only the employee's own row comes back.
  const rates = await client.from('employees').select('id, hourly_rate')
  const rateRows = rates.data ?? []
  const colleagueRows = rateRows.filter((row) => row.id !== ownId).length
  report(
    'employee cannot read colleagues hourly_rate',
    rates.error ? rates.error.code === '42501' : ownId !== null && colleagueRows === 0,
    rates.error ? `rejected: ${rates.error.message}` : `rows=${rateRows.length}, colleagues=${colleagueRows}`,
  )

  await client.auth.signOut()
}

await checkManager()
await checkEmployee()

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
