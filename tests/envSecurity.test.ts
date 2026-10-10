import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { validateEnv } from '../src/config/env';

// Feature: cloudflare-pages-deployment, Property 5: Environment Variable Security
describe('Environment Variable Security', () => {
  it('should validate required environment variables', () => {
    fc.assert(
      fc.property(
        fc.record({
          supabaseUrl: fc.option(fc.webUrl().map(url => url.startsWith('https://') ? url : `https://${url}`), { nil: undefined }),
          supabaseKey: fc.option(fc.string(), { nil: undefined }),
          environment: fc.string(),
          enableAnalytics: fc.boolean(),
          allowedEmailDomains: fc.array(fc.string())
        }),
        (mockEnv) => {
          const isValid = !!mockEnv.supabaseUrl && !!mockEnv.supabaseKey;
          
          if (isValid) {
            expect(() => validateEnv(mockEnv as never)).not.toThrow();
          } else {
            expect(() => validateEnv(mockEnv as never)).toThrow(/Missing required environment variables/);
          }
        }
      )
    );
  });
});
