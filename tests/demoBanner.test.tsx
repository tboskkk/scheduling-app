import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const calls: string[] = []
const signOut = vi.fn()
const signInWithPassword = vi.fn()
vi.mock('../src/lib/supabaseClient', () => ({
  supabase: {
    auth: {
      signOut: (...args: unknown[]) => signOut(...args),
      signInWithPassword: (...args: unknown[]) => signInWithPassword(...args),
    },
  },
}))

import DemoBanner from '../src/components/DemoBanner'
import type { DemoConfig } from '../src/lib/demo'

const config: DemoConfig = {
  demoMode: true,
  demoManagerEmail: 'demo-manager@example.com',
  demoEmployeeEmail: 'demo-employee@example.com',
  demoPassword: 'Password123!',
}

describe('DemoBanner', () => {
  beforeEach(() => {
    calls.length = 0
    signOut.mockReset()
    signInWithPassword.mockReset()
    signOut.mockImplementation(async () => {
      calls.push('signOut')
      return { error: null }
    })
    signInWithPassword.mockImplementation(async () => {
      calls.push('signIn')
      return { error: null }
    })
  })

  it('is hidden for non-demo users', () => {
    const { container } = render(<DemoBanner email="boss@restaurant.com" role="manager" config={config} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('is hidden when email is null', () => {
    const { container } = render(<DemoBanner email={null} role="manager" config={config} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the banner copy for the demo manager', () => {
    render(<DemoBanner email="demo-manager@example.com" role="manager" config={config} />)
    expect(screen.getByText("You're exploring the demo. Changes reset nightly.")).toBeInTheDocument()
  })

  it('manager sees Switch to employee', () => {
    render(<DemoBanner email="demo-manager@example.com" role="manager" config={config} />)
    expect(screen.getByRole('button', { name: 'Switch to employee' })).toBeInTheDocument()
  })

  it('employee sees Switch to manager', () => {
    render(<DemoBanner email="demo-employee@example.com" role="employee" config={config} />)
    expect(screen.getByRole('button', { name: 'Switch to manager' })).toBeInTheDocument()
  })

  it('switching signs out then signs in as the other demo account', async () => {
    render(<DemoBanner email="demo-manager@example.com" role="manager" config={config} />)
    fireEvent.click(screen.getByRole('button', { name: 'Switch to employee' }))
    await waitFor(() => expect(signInWithPassword).toHaveBeenCalledTimes(1))
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: 'demo-employee@example.com',
      password: 'Password123!',
    })
    expect(calls).toEqual(['signOut', 'signIn'])
  })

  it('shows the unavailable message when sign-in fails', async () => {
    signInWithPassword.mockResolvedValue({ error: new Error('nope') })
    render(<DemoBanner email="demo-employee@example.com" role="employee" config={config} />)
    fireEvent.click(screen.getByRole('button', { name: 'Switch to manager' }))
    expect(await screen.findByText('Demo is unavailable right now, try again later.')).toBeInTheDocument()
  })
})
