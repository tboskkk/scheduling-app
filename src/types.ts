export type ManagerProfile = {
  organization_id: string
  email: string | null
}

export type ScheduleStatus = 'draft' | 'published';

export type Schedule = {
  id: string;
  organization_id: string;
  location_id: string;
  week_start_date: string;
  status: ScheduleStatus;
  published_at: string | null;
  published_by: string | null;
  version: number;
  snapshot: ShiftRecord[] | null;
  created_at: string;
}

// Shift coming from the API may be partially populated (e.g., before insert returns id).
export type ShiftRecord = {
  id?: string
  location_id: string
  schedule_id?: string | null
  employee_id: string | null
  role_id: string | null
  start_datetime: string
  end_datetime: string
  break_start_datetime?: string | null
  break_end_datetime?: string | null
}

export type GridEmployee = {
  id: string
  name: string
  is_floating: boolean
  home_location_id: string | null
  display_order?: number
}

export type EmployeeAvailability = {
  id: string
  organization_id: string
  employee_id: string
  day_of_week: number
  start_time: string
  end_time: string
}

export type EmployeeUnavailability = {
  id: string
  organization_id: string
  employee_id: string
  start_datetime: string
  end_datetime: string
}

export type CoverageRequirement = {
  id: string
  location_id: string
  role_id: string
  day_of_week: number
  start_time: string
  end_time: string
  min_employees: number
}

export interface QuickShift {
  id: string;
  label: string;
  start: string;
  end: string;
}

export interface OrganizationSettings {
  weekly_overtime_threshold: number;
  daily_overtime_threshold: number;
  min_rest_period_hours: number;
  week_start_day: number; // 0 = Sunday, 1 = Monday, etc.
  enable_california_rules: boolean;
  time_format: '12h' | '24h';
  currency: string;
  quick_shifts: QuickShift[];
}

export const DEFAULT_ORGANIZATION_SETTINGS: OrganizationSettings = {
  weekly_overtime_threshold: 40,
  daily_overtime_threshold: 8,
  min_rest_period_hours: 8,
  week_start_day: 0,
  enable_california_rules: false,
  time_format: '12h',
  currency: 'CAD',
  quick_shifts: [
    { id: '1', label: 'Morning', start: '08:00', end: '12:00' },
    { id: '2', label: 'Day', start: '09:00', end: '17:00' },
    { id: '3', label: 'Evening', start: '12:00', end: '20:00' },
    { id: '4', label: 'Night', start: '22:00', end: '06:00' },
  ],
};

export interface Organization {
  id: string;
  name: string;
  settings: OrganizationSettings;
  created_at: string;
}

export type EmployeeProfile = {
  id: string
  organization_id: string
  name: string
  email: string | null
  home_location_id: string | null
  is_active: boolean
  role_ids: string[]
}

export type TimeOffRequest = {
  id: string
  organization_id: string
  employee_id: string
  start_date: string
  end_date: string
  reason: string | null
  status: 'pending' | 'approved' | 'denied'
  manager_note: string | null
  created_at: string
  updated_at: string
}

export type ShiftTradeRequest = {
  id: string
  organization_id: string
  requesting_employee_id: string
  target_employee_id: string
  requesting_shift_id: string | null
  target_shift_id: string | null
  status: 'pending' | 'accepted' | 'declined' | 'approved' | 'denied'
  requester_note: string | null
  manager_note: string | null
  created_at: string
  updated_at: string
}
