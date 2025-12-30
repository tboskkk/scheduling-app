import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { validateEnv } from '../src/config/env';

// Feature: cloudflare-pages-deployment, Property 12: Secure Transport
describe('Secure Transport', () => {
  it('should enforce HTTPS for Supabase URL', () => {
    fc.assert(
      fc.property(
        fc.record({
          supabaseUrl: fc.string(),
          supabaseKey: fc.constant('some-key'), // Ensure key is present so we hit the URL check
          environment: fc.string(),
          enableAnalytics: fc.boolean(),
          allowedEmailDomains: fc.array(fc.string())
        }),
        (mockEnv) => {
          if (mockEnv.supabaseUrl && !mockEnv.supabaseUrl.startsWith('https://')) {
            expect(() => validateEnv(mockEnv as any)).toThrow(/Supabase URL must use HTTPS/);
          } else if (mockEnv.supabaseUrl && mockEnv.supabaseKey) {
            // If it starts with https:// and has key, it should pass (or fail for other reasons if I added more checks)
            expect(() => validateEnv(mockEnv as any)).not.toThrow();
          }
        }
      )
    );
  });
});
