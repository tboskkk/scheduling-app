// Test case to reproduce the overtime bug with breaks
// Based on the actual shift data from the images

const shift = {
  id: '269f3e7b-0c0a-458e-96f0-2cd47d608d2e',
  location_id: 'test-location',
  employee_id: 'test-employee',
  role_id: 'cashier-role',
  start_datetime: '2024-01-01T12:15:00-06:00', // 12:15 PM America/Regina
  end_datetime: '2024-01-01T21:15:00-06:00',   // 9:15 PM America/Regina
  break_start_datetime: '2024-01-01T16:00:00-06:00', // 4:00 PM
  break_end_datetime: '2024-01-01T17:00:00-06:00'    // 5:00 PM
}

// Convert to UTC for testing (Regina is UTC-6)
const shiftUTC = {
  ...shift,
  start_datetime: '2024-01-01T18:15:00Z', // 12:15 PM Regina = 6:15 PM UTC
  end_datetime: '2024-01-02T03:15:00Z',   // 9:15 PM Regina = 3:15 AM UTC next day
  break_start_datetime: '2024-01-01T22:00:00Z', // 4:00 PM Regina = 10:00 PM UTC
  break_end_datetime: '2024-01-01T23:00:00Z'    // 5:00 PM Regina = 11:00 PM UTC
}

console.log('Shift data:', shiftUTC)
console.log('Expected: 8 hours (9h shift - 1h break)')
console.log('Actual bug: Shows 9.0h (break not subtracted)')