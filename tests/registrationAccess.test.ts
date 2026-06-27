import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { isEmailAllowed } from '../src/lib/auth-utils';

// Feature: cloudflare-pages-deployment, Property 8: Registration Access Control
describe('Registration Access Control', () => {
  it('should validate email against allowed domains when domains are specified', () => {
    fc.assert(
      fc.property(
        fc.emailAddress(), // valid email
        fc.array(fc.domain(), { minLength: 1 }), // non-empty allowed domains
        (email, allowedDomains) => {
          const result = isEmailAllowed(email, allowedDomains);
          const domain = email.split('@')[1];
          
          if (allowedDomains.includes(domain)) {
            expect(result).toBe(true);
          } else {
            expect(result).toBe(false);
          }
        }
      )
    );
  });

  it('should use pattern matching when no domains are specified', () => {
    // Test legitimate business emails
    expect(isEmailAllowed('user@company.com', [])).toBe(true);
    expect(isEmailAllowed('admin@corp.org', [])).toBe(true);
    expect(isEmailAllowed('manager@business.net', [])).toBe(true);
    expect(isEmailAllowed('user@gmail.com', [])).toBe(true);
    expect(isEmailAllowed('user@outlook.com', [])).toBe(true);
    
    // Test blocked disposable emails
    expect(isEmailAllowed('user@10minutemail.com', [])).toBe(false);
    expect(isEmailAllowed('user@tempmail.org', [])).toBe(false);
    expect(isEmailAllowed('user@guerrillamail.com', [])).toBe(false);
    
    // Test invalid emails
    expect(isEmailAllowed('invalid-email', [])).toBe(false);
    expect(isEmailAllowed('', [])).toBe(false);
    expect(isEmailAllowed('user@', [])).toBe(false);
  });

  it('should handle edge cases properly', () => {
    // Test case sensitivity
    expect(isEmailAllowed('User@Gmail.Com', [])).toBe(true);
    
    // Test business patterns
    expect(isEmailAllowed('contact@startup.co.uk', [])).toBe(true);
    expect(isEmailAllowed('info@company.corp', [])).toBe(true);
    expect(isEmailAllowed('sales@business.inc', [])).toBe(true);
  });
});
