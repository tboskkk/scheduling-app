import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as fc from 'fast-check';

// Feature: cloudflare-pages-deployment, Property 3: Comprehensive Security Headers
describe('Security Headers', () => {
  it('should have all required security headers configured', () => {
    const headersPath = path.resolve(__dirname, '../public/_headers');
    const headersContent = fs.readFileSync(headersPath, 'utf-8');
    
    // Parse headers
    const lines = headersContent.split('\n');
    const headers: Record<string, string> = {};
    
    lines.forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('/*')) {
        const [key, ...valueParts] = trimmed.split(':');
        if (key && valueParts.length > 0) {
          headers[key.trim()] = valueParts.join(':').trim();
        }
      }
    });

    // Property test: Check if required headers are present
    fc.assert(
      fc.property(fc.constant(headers), (h) => {
        expect(h).toHaveProperty('Content-Security-Policy');
        expect(h).toHaveProperty('Strict-Transport-Security');
        expect(h).toHaveProperty('X-Frame-Options');
        expect(h).toHaveProperty('X-Content-Type-Options');
        expect(h).toHaveProperty('Referrer-Policy');
        expect(h).toHaveProperty('Permissions-Policy');
        
        // Check specific values
        expect(h['X-Frame-Options']).toBe('DENY');
        expect(h['X-Content-Type-Options']).toBe('nosniff');
        expect(h['Strict-Transport-Security']).toContain('max-age=31536000');
      })
    );
  });
});
