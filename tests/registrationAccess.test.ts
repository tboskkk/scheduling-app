import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { isEmailAllowed } from '../src/lib/auth-utils';

// Feature: cloudflare-pages-deployment, Property 8: Registration Access Control
describe('Registration Access Control', () => {
  it('should validate email against allowed domains', () => {
    fc.assert(
      fc.property(
        fc.string(), // email
        fc.array(fc.string()), // allowed domains
        (email, allowedDomains) => {
          const result = isEmailAllowed(email, allowedDomains);
          
          if (allowedDomains.length === 0) {
            expect(result).toBe(true);
          } else {
            if (!email.includes('@')) {
              expect(result).toBe(false);
            } else {
              const domain = email.split('@')[1];
              if (allowedDomains.includes(domain)) {
                expect(result).toBe(true);
              } else {
                expect(result).toBe(false);
              }
            }
          }
        }
      )
    );
  });
});
