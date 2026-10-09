import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// Employees may only read their own row of `employees` (migration 0008), so
// colleague names must come from the employee_public_profiles view.
const tablesQueried: string[] = []
const selects: Record<string, string[]> = {}

const tradeRow = {
  id: 'req-1',
  organization_id: 'org-1',
  requesting_employee_id: 'emp-bob',
  target_employee_id: 'emp-me',
  requesting_shift_id: 'shift-1',
  target_shift_id: null,
  status: 'pending',
  requester_note: null,
  manager_note: null,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
  requesting_shift: { start_datetime: '2026-10-12T15:00:00Z', end_datetime: '2026-10-12T21:00:00Z' },
  target_shift: null,
}

function builder(table: string) {
  const result =
    table === 'shift_trade_requests'
      ? { data: [tradeRow], error: null }
      : table === 'employee_public_profiles'
        ? { data: [{ id: 'emp-bob', name: 'Bob Colleague' }, { id: 'emp-me', name: 'Me Myself' }], error: null }
        : { data: null, error: { message: `unexpected table ${table}` } }
  const b: Record<string, unknown> = {}
  for (const m of ['or', 'order', 'in', 'eq', 'neq']) b[m] = () => b
  b.select = (cols: string) => {
    ;(selects[table] ??= []).push(cols)
    return b
  }
  b.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return b
}

vi.mock('../src/lib/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      tablesQueried.push(table)
      return builder(table)
    },
    rpc: async () => ({ error: null }),
  },
}))

import ShiftTradeRequestsPage from '../src/pages/employee/ShiftTradeRequestsPage'
import type { EmployeeProfile } from '../src/types'

const profile = {
  id: 'emp-me',
  organization_id: 'org-1',
  name: 'Me Myself',
  email: null,
  home_location_id: null,
  is_active: true,
  role_ids: [],
} as unknown as EmployeeProfile

describe('ShiftTradeRequestsPage colleague names', () => {
  beforeEach(() => {
    tablesQueried.length = 0
    for (const k of Object.keys(selects)) delete selects[k]
  })

  it('shows the colleague name from employee_public_profiles and never reads employees', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <ShiftTradeRequestsPage employeeProfile={profile} />
      </QueryClientProvider>,
    )
    fireEvent.click(await screen.findByRole('button', { name: /Incoming \(1\)/ }))
    expect(await screen.findByText('From: Bob Colleague')).toBeInTheDocument()
    expect(tablesQueried).toContain('employee_public_profiles')
    expect(tablesQueried).not.toContain('employees')
    expect(selects.shift_trade_requests.join(' ')).not.toMatch(/employees/)
  })
})
