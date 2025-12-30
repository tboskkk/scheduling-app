import { describe, it, expect, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';

// Mock dependencies
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(),
}));

vi.mock('../src/config/env', () => ({
  env: {
    supabaseUrl: 'https://example.supabase.co',
    supabaseKey: 'test-key',
  },
}));

// Feature: cloudflare-pages-deployment, Property 9: Data Access Control
describe('Data Access Control', () => {
  it('should configure Supabase client with session persistence', async () => {
    // Import the module to trigger createClient
    await import('../src/lib/supabaseClient');

    expect(createClient).toHaveBeenCalledWith(
      'https://example.supabase.co',
      'test-key',
      expect.objectContaining({
        auth: expect.objectContaining({
          persistSession: true,
          autoRefreshToken: true,
        }),
      })
    );
  });
});
