import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import SettingsPage from '../src/pages/SettingsPage';
import { useOrganizationStore } from '../src/lib/useOrganizationStore';

// Mock useOrganizationStore
vi.mock('../src/lib/useOrganizationStore', () => ({
  useOrganizationStore: vi.fn(),
}));

describe('Privacy Properties', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock URL.createObjectURL and URL.revokeObjectURL
    global.URL.createObjectURL = vi.fn(() => 'blob:test');
    global.URL.revokeObjectURL = vi.fn();
    
    // Mock anchor click
    // We can't easily mock the click on the created element, but we can check if createObjectURL was called.
  });

  // Property 17: Data Privacy Compliance
  // Validates: Requirements 8.1, 8.2, 8.5
  it('Property 17: Data Privacy Compliance - Users can export their data', async () => {
    const mockSettings = {
      weekly_overtime_threshold: 40,
      daily_overtime_threshold: 8,
      min_rest_period_hours: 12,
      week_start_day: 1,
      time_format: '24h',
      currency: 'USD',
      enable_california_rules: false,
    };

    (useOrganizationStore as any).mockReturnValue({
      organization: { settings: mockSettings },
      fetchOrganization: vi.fn(),
      updateSettings: vi.fn(),
      isLoading: false,
      error: null,
    });

    render(<SettingsPage />);

    const downloadBtn = screen.getByText('Download Data');
    fireEvent.click(downloadBtn);

    expect(global.URL.createObjectURL).toHaveBeenCalled();
    // We verify that the blob was created with the correct data
    const blob = (global.URL.createObjectURL as any).mock.calls[0][0];
    expect(blob).toBeInstanceOf(Blob);
    
    // Use FileReader to read blob content as text() might not be available in jsdom environment
    const reader = new FileReader();
    const promise = new Promise((resolve) => {
      reader.onload = () => resolve(reader.result);
    });
    reader.readAsText(blob);
    const text = await promise;
    
    const data = JSON.parse(text as string);
    expect(data).toEqual(mockSettings);
  });

  // Property 18: Data Cleanup
  // Validates: Requirements 8.3
  it('Property 18: Data Cleanup - Users can request account deletion', () => {
    (useOrganizationStore as any).mockReturnValue({
      organization: { settings: {} },
      fetchOrganization: vi.fn(),
      updateSettings: vi.fn(),
      isLoading: false,
      error: null,
    });

    // Mock window.confirm and window.alert
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

    render(<SettingsPage />);

    const deleteBtn = screen.getByRole('button', { name: 'Delete Account' });
    fireEvent.click(deleteBtn);

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('delete your account'));
    expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining('Account deletion request received'));
  });
});
