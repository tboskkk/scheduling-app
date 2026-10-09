import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const mockEnv = vi.hoisted(() => ({
  demoMode: true,
  demoManagerEmail: 'demo-manager@example.com',
  demoEmployeeEmail: 'demo-employee@example.com',
  demoPassword: 'Password123!',
  allowedEmailDomains: [] as string[],
}))
vi.mock('../src/config/env', () => ({ env: mockEnv }))

vi.mock('../src/lib/supabaseClient', () => ({
  supabase: { auth: { signInWithPassword: vi.fn(), signUp: vi.fn() } },
}))

import AuthPage from '../src/pages/AuthPage'

const renderLogin = () =>
  render(
    <MemoryRouter>
      <AuthPage mode="login" session={null} />
    </MemoryRouter>,
  )

const emailInput = () => screen.getByPlaceholderText('you@example.com')

describe('AuthPage demo block placement', () => {
  beforeEach(() => {
    mockEnv.demoMode = true
  })

  it('puts the demo block before the login form so phones see it first', () => {
    renderLogin()
    const manager = screen.getByRole('button', { name: 'Try as manager' })
    expect(manager.compareDocumentPosition(emailInput()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByText('Try the demo')).toBeInTheDocument()
  })

  it('moves the demo block back below the form on desktop', () => {
    renderLogin()
    const block = screen.getByTestId('demo-login-block')
    expect(block).toHaveClass('md:order-last')
    expect(block.parentElement).toHaveClass('flex', 'flex-col', 'gap-4')
  })

  it('keeps the original layout when demo mode is off', () => {
    mockEnv.demoMode = false
    renderLogin()
    expect(screen.queryByRole('button', { name: 'Try as manager' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('demo-login-block')).not.toBeInTheDocument()
    const column = emailInput().closest('form')!.parentElement!
    expect(column.className).toBe('space-y-4')
  })
})
