import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const signInWithPassword = vi.fn()
vi.mock('../src/lib/supabaseClient', () => ({
  supabase: { auth: { signInWithPassword: (...args: unknown[]) => signInWithPassword(...args) } },
}))

import DemoLoginButtons from '../src/components/DemoLoginButtons'
import type { DemoConfig } from '../src/lib/demo'

const onConfig: DemoConfig = {
  demoMode: true,
  demoManagerEmail: 'demo-manager@example.com',
  demoEmployeeEmail: 'demo-employee@example.com',
  demoPassword: 'Password123!',
}
const offConfig: DemoConfig = { ...onConfig, demoMode: false }

describe('DemoLoginButtons', () => {
  beforeEach(() => {
    signInWithPassword.mockReset()
    signInWithPassword.mockResolvedValue({ error: null })
  })

  it('renders nothing when demo mode is off', () => {
    const { container } = render(<DemoLoginButtons config={offConfig} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders Try as manager and Try as employee when on', () => {
    render(<DemoLoginButtons config={onConfig} />)
    expect(screen.getByRole('button', { name: 'Try as manager' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try as employee' })).toBeInTheDocument()
  })

  it('signs in with the manager credentials', async () => {
    render(<DemoLoginButtons config={onConfig} />)
    fireEvent.click(screen.getByRole('button', { name: 'Try as manager' }))
    await waitFor(() => expect(signInWithPassword).toHaveBeenCalledTimes(1))
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: 'demo-manager@example.com',
      password: 'Password123!',
    })
  })

  it('disables both buttons while signing in', async () => {
    signInWithPassword.mockReturnValue(new Promise(() => {}))
    render(<DemoLoginButtons config={onConfig} />)
    const manager = screen.getByRole('button', { name: 'Try as manager' })
    const employee = screen.getByRole('button', { name: 'Try as employee' })
    fireEvent.click(manager)
    await waitFor(() => expect(manager).toBeDisabled())
    expect(employee).toBeDisabled()
    fireEvent.click(employee)
    expect(signInWithPassword).toHaveBeenCalledTimes(1)
  })

  it('shows friendly error when demo sign-in fails', async () => {
    signInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials' } })
    const onError = vi.fn()
    render(<DemoLoginButtons config={onConfig} onError={onError} />)
    fireEvent.click(screen.getByRole('button', { name: 'Try as employee' }))
    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith('Demo is unavailable right now, try again later.'),
    )
    expect(screen.getByRole('button', { name: 'Try as employee' })).not.toBeDisabled()
  })
})
