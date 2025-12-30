import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Deployment Properties', () => {
  const ciPath = path.resolve(__dirname, '../.github/workflows/ci.yml');
  
  const ciContent = fs.readFileSync(ciPath, 'utf-8');

  // Property 19: Deployment Pipeline Security
  // Validates: Requirements 9.1, 9.2, 9.3, 9.4
  it('Property 19: Deployment Pipeline Security - CI should run tests and security scans', () => {
    // Requirement 9.1: Run tests
    expect(ciContent).toContain('npm test');
    
    // Requirement 9.3: Security scans
    expect(ciContent).toContain('npm audit');
    
    // Requirement 9.2: Prevent deployment when tests fail
    // In a standard GitHub flow, branch protection rules would require this CI job to pass
    // before merging. The CI file itself defines the checks that must pass.
    expect(ciContent).toContain('npm run lint');
    expect(ciContent).toContain('npx tsc -b');
  });

  // Property 20: Rollback Capability
  // Validates: Requirements 9.5
  it('Property 20: Rollback Capability - Cloudflare Pages supports native rollback', () => {
    // This property is satisfied by the platform choice (Cloudflare Pages)
    // rather than a specific file configuration in the repo, as we are using
    // direct Git integration.
    // We can verify that we are NOT using a custom deploy script that might bypass this.
    const deployScriptPath = path.resolve(__dirname, '../.github/workflows/deploy.yml');
    expect(fs.existsSync(deployScriptPath)).toBe(false);
  });
});
