import { describe, it, expect, vi } from 'vitest';
const mockEnv = vi.hoisted(() => ({
  demoMode: true,
  demoManagerEmail: 'demo-manager@example.com',
  demoEmployeeEmail: 'demo-employee@example.com',
  demoPassword: 'x',
}));
vi.mock('../src/config/env', () => ({ env: mockEnv }));
import { getDemoConfig, isDemoUser, type DemoConfig } from '../src/lib/demo';

const cfg: DemoConfig = {
  demoMode: true,
  demoManagerEmail: 'demo-manager@example.com',
  demoEmployeeEmail: 'demo-employee@example.com',
  demoPassword: 'x',
};

describe('isDemoUser', () => {
  it('matches the demo accounts case-insensitively', () => {
    expect(isDemoUser('demo-manager@example.com', cfg)).toBe(true);
    expect(isDemoUser('DEMO-EMPLOYEE@example.com', cfg)).toBe(true);
  });

  it('rejects other emails and nullish values', () => {
    expect(isDemoUser('tyler@example.com', cfg)).toBe(false);
    expect(isDemoUser(null, cfg)).toBe(false);
    expect(isDemoUser(undefined, cfg)).toBe(false);
  });

  it('returns false for every email when demo mode is off', () => {
    const off = { ...cfg, demoMode: false };
    expect(isDemoUser('demo-manager@example.com', off)).toBe(false);
    expect(isDemoUser('demo-employee@example.com', off)).toBe(false);
    expect(isDemoUser('tyler@example.com', off)).toBe(false);
  });

  it('returns false for empty email when demo emails are empty', () => {
    const empty = { ...cfg, demoManagerEmail: '', demoEmployeeEmail: '' };
    expect(isDemoUser('', empty)).toBe(false);
  });
});

describe('demo mode needs all three credentials', () => {
  const creds = ['demoManagerEmail', 'demoEmployeeEmail', 'demoPassword'] as const;

  it('getDemoConfig is on when the flag and all credentials are set', () => {
    expect(getDemoConfig().demoMode).toBe(true);
  });

  it.each(creds)('getDemoConfig turns demo mode off when %s is empty', (key) => {
    const saved = mockEnv[key];
    mockEnv[key] = '';
    try {
      expect(getDemoConfig().demoMode).toBe(false);
    } finally {
      mockEnv[key] = saved;
    }
  });

  it.each(creds)('isDemoUser is false for the demo emails when %s is empty', (key) => {
    const partial = { ...cfg, [key]: '  ' };
    expect(isDemoUser('demo-manager@example.com', partial)).toBe(false);
    expect(isDemoUser('demo-employee@example.com', partial)).toBe(false);
  });
});
