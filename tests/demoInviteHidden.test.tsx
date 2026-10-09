import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('../src/config/env', () => ({
  env: {
    demoMode: true,
    demoManagerEmail: 'demo-manager@example.com',
    demoEmployeeEmail: 'demo-employee@example.com',
    demoPassword: 'Password123!',
  },
}))

vi.mock('../src/lib/supabaseClient', () => {
  const ordered = { order: () => Promise.resolve({ data: [], error: null }) }
  return {
    supabase: {
      from: () => ({ select: () => ({ eq: () => ordered }) }),
      functions: { invoke: vi.fn() },
    },
  }
})

import AddEditEmployeeDialog from '../src/components/AddEditEmployeeDialog'
import type { EmployeeRecord } from '../src/components/EmployeesManager'

const employee: EmployeeRecord = {
  id: 'emp-1',
  name: 'Sam Server',
  email: 'sam@example.com',
  phone: null,
  hourly_rate: 18,
  home_location_id: null,
  is_floating: false,
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  role_ids: [],
  user_id: null,
}

const renderDialog = (userEmail: string | null) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AddEditEmployeeDialog
        isOpen
        onClose={() => {}}
        employee={employee}
        organizationId="org-1"
        locations={[]}
        roles={[]}
        currency="USD"
        onSaved={() => {}}
        userEmail={userEmail}
      />
    </QueryClientProvider>,
  )

describe('AddEditEmployeeDialog invite control in demo mode', () => {
  it('shows Send invite email for a regular manager', () => {
    renderDialog('boss@restaurant.com')
    expect(screen.getByRole('button', { name: 'Send invite email' })).toBeInTheDocument()
  })

  it('hides Send invite email for the demo manager', () => {
    renderDialog('demo-manager@example.com')
    expect(screen.queryByRole('button', { name: 'Send invite email' })).not.toBeInTheDocument()
    expect(screen.getByText('Invites are turned off in the demo.')).toBeInTheDocument()
  })
})
