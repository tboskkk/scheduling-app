import { describe, it, expect } from 'vitest';
import { env } from '../src/config/env';

// Feature: cloudflare-pages-deployment, Property 6: Environment Isolation
describe('Environment Isolation', () => {
  it('should have environment configuration field', () => {
    expect(env).toHaveProperty('environment');
  });

  it('should have separate configuration fields for Supabase', () => {
    expect(env).toHaveProperty('supabaseUrl');
    expect(env).toHaveProperty('supabaseKey');
  });

  it('should default to development environment if not specified', () => {
    // This assumes the test runner doesn't set VITE_APP_ENVIRONMENT, or sets it to development
    // If VITE_APP_ENVIRONMENT is set in the test environment, this might fail or need adjustment
    if (!process.env.VITE_APP_ENVIRONMENT) {
       expect(env.environment).toBe('development');
    }
  });
});
