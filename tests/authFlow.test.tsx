import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import * as fc from 'fast-check';
import ProtectedRoute from '../src/components/ProtectedRoute';

// Feature: cloudflare-pages-deployment, Property 7: Authentication Flow Security
describe('Authentication Flow Security', () => {
  it('should redirect unauthenticated users to login', () => {
    fc.assert(
      fc.property(fc.option(fc.object(), { nil: undefined }), (session) => {
        render(
          <MemoryRouter initialEntries={['/protected']}>
            <Routes>
              <Route path="/login" element={<div>Login Page</div>} />
              <Route element={<ProtectedRoute session={session as any} />}>
                <Route path="/protected" element={<div>Protected Content</div>} />
              </Route>
            </Routes>
          </MemoryRouter>
        );

        if (session) {
          expect(screen.getByText('Protected Content')).toBeInTheDocument();
        } else {
          expect(screen.getByText('Login Page')).toBeInTheDocument();
        }
        
        // Cleanup
        document.body.innerHTML = '';
      })
    );
  });
});
