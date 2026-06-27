import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OfflineIndicator } from '../src/components/OfflineIndicator';
import * as fc from 'fast-check';

// Mock navigator.onLine
const mockNavigatorOnline = () => {
  Object.defineProperty(navigator, 'onLine', {
    value: true,
    writable: true,
  });
};

describe('Performance and Reliability Properties', () => {
  beforeEach(() => {
    mockNavigatorOnline();
  });

  // Property 15: Performance and Reliability
  // Validates: Requirements 7.2, 7.4, 7.5
  it('Property 15: Performance and Reliability - Offline detection should provide user feedback', () => {
    render(<OfflineIndicator />);
    
    // Initially online, should not show
    expect(screen.queryByText(/You are currently offline/i)).not.toBeInTheDocument();

    // Simulate offline
    act(() => {
      Object.defineProperty(navigator, 'onLine', { value: false, writable: true });
      window.dispatchEvent(new Event('offline'));
    });

    expect(screen.getByText(/You are currently offline/i)).toBeInTheDocument();

    // Simulate online
    act(() => {
      Object.defineProperty(navigator, 'onLine', { value: true, writable: true });
      window.dispatchEvent(new Event('online'));
    });

    expect(screen.queryByText(/You are currently offline/i)).not.toBeInTheDocument();
  });

  // Property 16: Graceful Degradation
  // Validates: Requirements 7.3
  it('Property 16: Graceful Degradation - Components should handle rapid connectivity changes gracefully', () => {
     fc.assert(
       fc.property(fc.array(fc.boolean()), (statuses) => {
         const { unmount } = render(<OfflineIndicator />);
         
         statuses.forEach(isOnline => {
           act(() => {
             Object.defineProperty(navigator, 'onLine', { value: isOnline, writable: true });
             window.dispatchEvent(new Event(isOnline ? 'online' : 'offline'));
           });
           
           if (!isOnline) {
             expect(screen.getByText(/You are currently offline/i)).toBeInTheDocument();
           } else {
             expect(screen.queryByText(/You are currently offline/i)).not.toBeInTheDocument();
           }
         });
         
         unmount();
       })
     );
  });
});
