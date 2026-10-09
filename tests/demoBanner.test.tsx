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

  it('switching signs in as the other demo account without signing out first', async () => {
    render(<DemoBanner email="demo-manager@example.com" role="manager" config={config} />)
    fireEvent.click(screen.getByRole('button', { name: 'Switch to employee' }))
    await waitFor(() => expect(signInWithPassword).toHaveBeenCalledTimes(1))
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: 'demo-employee@example.com',
      password: 'Password123!',
    })
    expect(signOut).not.toHaveBeenCalled()
    expect(calls).toEqual(['signIn'])
  })

  it('employee switching signs in as the demo manager', async () => {
    render(<DemoBanner email="demo-employee@example.com" role="employee" config={config} />)
    fireEvent.click(screen.getByRole('button', { name: 'Switch to manager' }))
    await waitFor(() => expect(signInWithPassword).toHaveBeenCalledTimes(1))
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: 'demo-manager@example.com',
      password: 'Password123!',
    })
    expect(signOut).not.toHaveBeenCalled()
  })

  it('disables the button while switching', async () => {
    let resolveSignIn: (value: { error: null }) => void = () => {}
    signInWithPassword.mockImplementation(
      () => new Promise((resolve) => { resolveSignIn = resolve }),
    )
    render(<DemoBanner email="demo-manager@example.com" role="manager" config={config} />)
    const button = screen.getByRole('button', { name: 'Switch to employee' })
    fireEvent.click(button)
    await waitFor(() => expect(button).toBeDisabled())
    fireEvent.click(button)
    expect(signInWithPassword).toHaveBeenCalledTimes(1)
    resolveSignIn({ error: null })
    await waitFor(() => expect(button).not.toBeDisabled())
  })

  it('clears the error when retrying', async () => {
    signInWithPassword.mockResolvedValueOnce({ error: new Error('nope') })
    let resolveSignIn: (value: { error: null }) => void = () => {}
    signInWithPassword.mockImplementationOnce(
      () => new Promise((resolve) => { resolveSignIn = resolve }),
    )
    render(<DemoBanner email="demo-employee@example.com" role="employee" config={config} />)
    const button = screen.getByRole('button', { name: 'Switch to manager' })
    fireEvent.click(button)
    expect(await screen.findByText('Demo is unavailable right now, try again later.')).toBeInTheDocument()
    fireEvent.click(button)
    await waitFor(() =>
      expect(screen.queryByText('Demo is unavailable right now, try again later.')).not.toBeInTheDocument(),
    )
    expect(screen.getByText("You're exploring the demo. Changes reset nightly.")).toBeInTheDocument()
    resolveSignIn({ error: null })
    await waitFor(() => expect(button).not.toBeDisabled())
  })

  it('lets the banner text wrap instead of truncating', () => {
    render(<DemoBanner email="demo-manager@example.com" role="manager" config={config} />)
    const text = screen.getByText("You're exploring the demo. Changes reset nightly.")
    expect(text).not.toHaveClass('truncate')
  })

  it('shows the unavailable message when sign-in fails', async () => {
    signInWithPassword.mockResolvedValue({ error: new Error('nope') })
    render(<DemoBanner email="demo-employee@example.com" role="employee" config={config} />)
    fireEvent.click(screen.getByRole('button', { name: 'Switch to manager' }))
    expect(await screen.findByText('Demo is unavailable right now, try again later.')).toBeInTheDocument()
  })
})
