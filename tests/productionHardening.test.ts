import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { checkRateLimit, resetRateLimits } from '../src/lib/security';

// Feature: cloudflare-pages-deployment, Property 10: Production Hardening
describe('Production Hardening', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetRateLimits();
  });

  it('should enforce rate limiting', () => {
    const limit = 5;
    const windowMs = 60000;

    // Reset internal state if possible, or use unique keys
    // Since checkRateLimit uses module-level state, we should use unique keys per test run
    
    fc.assert(
      fc.property(fc.string(), (uniqueKey) => {
        resetRateLimits();
        // First 'limit' attempts should succeed
        for (let i = 0; i < limit; i++) {
          expect(checkRateLimit(uniqueKey, limit, windowMs)).toBe(true);
        }
        
        // Next attempt should fail
        expect(checkRateLimit(uniqueKey, limit, windowMs)).toBe(false);
        
        // Advance time by windowMs + 1
        vi.advanceTimersByTime(windowMs + 1);
        
        // Should succeed again
        expect(checkRateLimit(uniqueKey, limit, windowMs)).toBe(true);
      })
    );
  });
});
