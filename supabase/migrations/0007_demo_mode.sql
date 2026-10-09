-- 0007_demo_mode.sql
-- Demo mode: seed data for the fictional "Northwind Kitchen" organization and
-- a nightly pg_cron job that wipes and re-seeds it.
-- Apply in the Supabase dashboard SQL editor. Runs as a single transaction and
-- is safe to run more than once (if not exists / or replace / upserts).
--
-- Changes:
--   1. private.demo_config: the demo org id, demo auth user ids and password
--   2. private.reset_demo(): deletes every demo-org row and re-seeds it
--   3. Lock down EXECUTE on private.reset_demo()
--   4. Schedule the nightly reset with pg_cron (09:00 UTC = 3 AM Saskatchewan)
--   5. Run the reset once now
--
-- Safety: reset_demo() is SECURITY DEFINER (owned by postgres) so it bypasses
-- RLS. Every delete and update below is therefore filtered by the demo org id,
-- or by the two demo user ids for auth.users. No other organization is touched.
--
-- Preconditions: the two demo auth users already exist (managers.id and
-- employees.user_id reference auth.users).

BEGIN;

-- =============================================================================
-- 1. Demo config (not reachable through the REST API)
--
--    One row. reset_demo() reads it with SELECT ... INTO STRICT, so a missing
--    or duplicated row raises instead of seeding the wrong org.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.demo_config (
  org_id           uuid PRIMARY KEY,
  manager_user_id  uuid NOT NULL,
  employee_user_id uuid NOT NULL,
  password         text NOT NULL
);

INSERT INTO private.demo_config (org_id, manager_user_id, employee_user_id, password)
VALUES (
  'd3e00000-0000-4000-8000-000000000001',
  'b0274d86-5ba5-439a-9e08-d69161dfd56d',
  'a840a06a-eb99-43e6-94a5-78e5dc49ba98',
  'Password123!'
)
ON CONFLICT (org_id) DO UPDATE
  SET manager_user_id  = EXCLUDED.manager_user_id,
      employee_user_id = EXCLUDED.employee_user_id,
      password         = EXCLUDED.password;

-- 0004 granted USAGE on schema private to anon/authenticated (for the RLS
-- helpers). Make sure neither can read this table.
REVOKE ALL ON TABLE private.demo_config FROM PUBLIC, anon, authenticated;

-- =============================================================================
-- 2. private.reset_demo()
--
--    Week layout: org week_start_day is 1 (Monday), matching Postgres
--    date_trunc('week', ...). w0 is the current week (published), w1 is next
--    week (draft). The restaurant is closed Mondays; shifts run Tue to Sun.
--    Day offsets from Monday: 1 Tue, 2 Wed, 3 Thu, 4 Fri, 5 Sat, 6 Sun.
--    coverage_requirements.day_of_week is 0 = Sun ... 6 = Sat.
--
--    The rota is built so week w0 has no rules-engine findings: every shift
--    sits inside the employee's availability, nobody works twice in a day,
--    no shift is over 8h, nobody is over 40h, and every gap between shifts is
--    at least 12h. Week w1 repeats it minus one Riverside Line Cook evening
--    shift (Thursday), so the coverage check flags exactly one gap.
-- =============================================================================

CREATE OR REPLACE FUNCTION private.reset_demo()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  -- Config
  v_org_id           uuid;
  v_manager_user_id  uuid;
  v_employee_user_id uuid;
  v_password         text;

  -- Weeks
  v_w0 date := date_trunc('week', current_date)::date;
  v_w1 date := date_trunc('week', current_date)::date + 7;

  -- Locations
  v_downtown  uuid;
  v_riverside uuid;

  -- Roles
  v_server     uuid;
  v_line_cook  uuid;
  v_host       uuid;
  v_dishwasher uuid;
  v_shift_lead uuid;

  -- Employees: Downtown
  v_sam    uuid;  -- linked to the demo employee login
  v_priya  uuid;
  v_theo   uuid;
  v_rosa   uuid;
  v_ben    uuid;
  v_nadia  uuid;
  -- Employees: Riverside
  v_omar   uuid;
  v_lucy   uuid;
  v_kai    uuid;
  v_mateo  uuid;
  v_grace  uuid;
  -- Employee: floating (works both locations)
  v_jordan uuid;

  -- Schedules (week w0, published)
  v_downtown_w0  uuid;
  v_riverside_w0 uuid;

  -- Shifts used by the pending trade request
  v_trade_from_shift uuid;
  v_trade_to_shift   uuid;
BEGIN
  SELECT org_id, manager_user_id, employee_user_id, password
    INTO STRICT v_org_id, v_manager_user_id, v_employee_user_id, v_password
    FROM private.demo_config;

  -- ---------------------------------------------------------------------------
  -- Organization (settings = DEFAULT_ORGANIZATION_SETTINGS, week starts Monday)
  -- ---------------------------------------------------------------------------
  INSERT INTO public.organizations (id, name, settings)
  VALUES (
    v_org_id,
    'Northwind Kitchen',
    '{
      "weekly_overtime_threshold": 40,
      "daily_overtime_threshold": 8,
      "min_rest_period_hours": 8,
      "week_start_day": 1,
      "enable_california_rules": false,
      "time_format": "12h",
      "currency": "CAD",
      "quick_shifts": [
        {"id": "1", "label": "Morning", "start": "08:00", "end": "12:00"},
        {"id": "2", "label": "Day",     "start": "09:00", "end": "17:00"},
        {"id": "3", "label": "Evening", "start": "12:00", "end": "20:00"},
        {"id": "4", "label": "Night",   "start": "22:00", "end": "06:00"}
      ]
    }'::jsonb
  )
  ON CONFLICT (id) DO UPDATE
    SET name     = EXCLUDED.name,
        settings = EXCLUDED.settings;

  -- ---------------------------------------------------------------------------
  -- Wipe demo-org data, children first. Every statement is filtered by the
  -- demo org (directly, or through its locations / employees).
  -- Shifts go before locations: trg_prevent_location_delete blocks deleting a
  -- location that still has future shifts.
  -- ---------------------------------------------------------------------------
  DELETE FROM public.shift_trade_requests    WHERE organization_id = v_org_id;
  DELETE FROM public.time_off_requests       WHERE organization_id = v_org_id;
  DELETE FROM public.shifts                  WHERE organization_id = v_org_id;
  DELETE FROM public.schedules               WHERE organization_id = v_org_id;
  DELETE FROM public.employee_unavailability WHERE organization_id = v_org_id;
  DELETE FROM public.employee_availability   WHERE organization_id = v_org_id;
  DELETE FROM public.coverage_requirements
    WHERE location_id IN (SELECT id FROM public.locations WHERE organization_id = v_org_id);
  DELETE FROM public.employee_roles
    WHERE employee_id IN (SELECT id FROM public.employees WHERE organization_id = v_org_id);
  DELETE FROM public.employees               WHERE organization_id = v_org_id;
  DELETE FROM public.roles                   WHERE organization_id = v_org_id;
  DELETE FROM public.locations               WHERE organization_id = v_org_id;

  -- ---------------------------------------------------------------------------
  -- Demo manager (id = demo manager auth user)
  -- ---------------------------------------------------------------------------
  INSERT INTO public.managers (id, organization_id, email)
  VALUES (v_manager_user_id, v_org_id, 'demo-manager@example.com')
  ON CONFLICT (id) DO UPDATE
    SET organization_id = EXCLUDED.organization_id,
        email           = EXCLUDED.email;

  -- ---------------------------------------------------------------------------
  -- Locations
  -- ---------------------------------------------------------------------------
  INSERT INTO public.locations (organization_id, name, address, timezone)
  VALUES (v_org_id, 'Downtown', '210 Harbour Lane', 'America/Regina')
  RETURNING id INTO v_downtown;

  INSERT INTO public.locations (organization_id, name, address, timezone)
  VALUES (v_org_id, 'Riverside', '45 Riverside Drive', 'America/Regina')
  RETURNING id INTO v_riverside;

  -- ---------------------------------------------------------------------------
  -- Roles (distinct colours)
  -- ---------------------------------------------------------------------------
  INSERT INTO public.roles (organization_id, name, color)
  VALUES (v_org_id, 'Server', '#3b82f6') RETURNING id INTO v_server;
  INSERT INTO public.roles (organization_id, name, color)
  VALUES (v_org_id, 'Line Cook', '#ef4444') RETURNING id INTO v_line_cook;
  INSERT INTO public.roles (organization_id, name, color)
  VALUES (v_org_id, 'Host', '#22c55e') RETURNING id INTO v_host;
  INSERT INTO public.roles (organization_id, name, color)
  VALUES (v_org_id, 'Dishwasher', '#f59e0b') RETURNING id INTO v_dishwasher;
  INSERT INTO public.roles (organization_id, name, color)
  VALUES (v_org_id, 'Shift Lead', '#8b5cf6') RETURNING id INTO v_shift_lead;

  -- ---------------------------------------------------------------------------
  -- Employees (fictional, @example.com, no phone numbers)
  -- ---------------------------------------------------------------------------
  -- Downtown
  INSERT INTO public.employees
    (organization_id, home_location_id, name, email, hourly_rate, is_floating, display_order, user_id)
  VALUES
    (v_org_id, v_downtown, 'Sam Whitlock', 'demo-employee@example.com', 16.50, false, 1, v_employee_user_id)
  RETURNING id INTO v_sam;

  INSERT INTO public.employees
    (organization_id, home_location_id, name, email, hourly_rate, is_floating, display_order)
  VALUES (v_org_id, v_downtown, 'Priya Lindqvist', 'priya.lindqvist@example.com', 16.50, false, 2)
  RETURNING id INTO v_priya;

  INSERT INTO public.employees
    (organization_id, home_location_id, name, email, hourly_rate, is_floating, display_order)
  VALUES (v_org_id, v_downtown, 'Theo Marchetti', 'theo.marchetti@example.com', 16.00, false, 3)
  RETURNING id INTO v_theo;

  INSERT INTO public.employees
    (organization_id, home_location_id, name, email, hourly_rate, is_floating, display_order)
  VALUES (v_org_id, v_downtown, 'Rosa Delacroix', 'rosa.delacroix@example.com', 19.50, false, 4)
  RETURNING id INTO v_rosa;

  INSERT INTO public.employees
    (organization_id, home_location_id, name, email, hourly_rate, is_floating, display_order)
  VALUES (v_org_id, v_downtown, 'Ben Halloran', 'ben.halloran@example.com', 18.75, false, 5)
  RETURNING id INTO v_ben;

  INSERT INTO public.employees
    (organization_id, home_location_id, name, email, hourly_rate, is_floating, display_order)
  VALUES (v_org_id, v_downtown, 'Nadia Brightwater', 'nadia.brightwater@example.com', 23.00, false, 6)
  RETURNING id INTO v_nadia;

  -- Riverside
  INSERT INTO public.employees
    (organization_id, home_location_id, name, email, hourly_rate, is_floating, display_order)
  VALUES (v_org_id, v_riverside, 'Omar Fairbanks', 'omar.fairbanks@example.com', 16.50, false, 7)
  RETURNING id INTO v_omar;

  INSERT INTO public.employees
    (organization_id, home_location_id, name, email, hourly_rate, is_floating, display_order)
  VALUES (v_org_id, v_riverside, 'Lucy Tremblay', 'lucy.tremblay@example.com', 16.00, false, 8)
  RETURNING id INTO v_lucy;

  INSERT INTO public.employees
    (organization_id, home_location_id, name, email, hourly_rate, is_floating, display_order)
  VALUES (v_org_id, v_riverside, 'Kai Sorensen', 'kai.sorensen@example.com', 19.50, false, 9)
  RETURNING id INTO v_kai;

  INSERT INTO public.employees
    (organization_id, home_location_id, name, email, hourly_rate, is_floating, display_order)
  VALUES (v_org_id, v_riverside, 'Mateo Quill', 'mateo.quill@example.com', 18.75, false, 10)
  RETURNING id INTO v_mateo;

  INSERT INTO public.employees
    (organization_id, home_location_id, name, email, hourly_rate, is_floating, display_order)
  VALUES (v_org_id, v_riverside, 'Grace Ashdown', 'grace.ashdown@example.com', 23.00, false, 11)
  RETURNING id INTO v_grace;

  -- Floating: home is Downtown, also covers Riverside
  INSERT INTO public.employees
    (organization_id, home_location_id, name, email, hourly_rate, is_floating, display_order)
  VALUES (v_org_id, v_downtown, 'Jordan Pike', 'jordan.pike@example.com', 20.00, true, 12)
  RETURNING id INTO v_jordan;

  -- ---------------------------------------------------------------------------
  -- Employee roles
  -- ---------------------------------------------------------------------------
  INSERT INTO public.employee_roles (employee_id, role_id)
  VALUES
    (v_sam,    v_server), (v_sam,    v_host),
    (v_priya,  v_server),
    (v_theo,   v_server), (v_theo,   v_host),
    (v_rosa,   v_line_cook),
    (v_ben,    v_line_cook), (v_ben,   v_dishwasher),
    (v_nadia,  v_shift_lead), (v_nadia, v_server),
    (v_omar,   v_server),
    (v_lucy,   v_server), (v_lucy,   v_host),
    (v_kai,    v_line_cook), (v_kai,   v_dishwasher),
    (v_mateo,  v_line_cook), (v_mateo, v_dishwasher),
    (v_grace,  v_shift_lead), (v_grace, v_server),
    (v_jordan, v_line_cook), (v_jordan, v_server), (v_jordan, v_dishwasher);

  -- ---------------------------------------------------------------------------
  -- Weekly availability (local times; day_of_week 0 = Sun ... 6 = Sat)
  -- Nobody is available Monday (closed). A few people have narrower windows.
  -- ---------------------------------------------------------------------------
  INSERT INTO public.employee_availability
    (organization_id, employee_id, day_of_week, start_time, end_time)
  SELECT v_org_id, a.emp, d.dow, a.start_t, a.end_t
  FROM (VALUES
    (v_sam,    ARRAY[0, 2, 4, 5, 6],    time '10:00', time '22:00'),  -- no Wednesdays
    (v_priya,  ARRAY[0, 2, 3, 4, 5, 6], time '10:00', time '22:00'),
    (v_theo,   ARRAY[0, 2, 3, 4, 5, 6], time '15:00', time '23:00'),  -- evenings only
    (v_rosa,   ARRAY[0, 2, 3, 4, 5, 6], time '10:00', time '22:00'),
    (v_ben,    ARRAY[0, 2, 3, 4, 5, 6], time '10:00', time '22:00'),
    (v_nadia,  ARRAY[0, 2, 3, 4, 5, 6], time '10:00', time '23:00'),
    (v_omar,   ARRAY[2, 3, 4, 5, 6],    time '10:00', time '22:00'),  -- no Sundays
    (v_lucy,   ARRAY[0, 2, 3, 4, 5, 6], time '10:00', time '22:00'),
    (v_kai,    ARRAY[0, 2, 3, 4, 5, 6], time '10:00', time '22:00'),
    (v_mateo,  ARRAY[0, 2, 3, 4, 5, 6], time '10:00', time '22:00'),
    (v_grace,  ARRAY[0, 2, 3, 4, 5, 6], time '10:00', time '23:00'),
    (v_jordan, ARRAY[2, 3, 4, 5, 6],    time '10:00', time '22:00')   -- no Sundays
  ) AS a(emp, days, start_t, end_t)
  CROSS JOIN LATERAL unnest(a.days) AS d(dow);

  -- ---------------------------------------------------------------------------
  -- Coverage rules (coverage_requirements has no organization_id; it hangs off
  -- the demo locations)
  -- ---------------------------------------------------------------------------
  -- Server and Line Cook, 11:00 to 21:00, Tue to Sun, both locations
  INSERT INTO public.coverage_requirements
    (location_id, role_id, day_of_week, start_time, end_time, min_employees)
  SELECT l.loc_id, r.role_id, d.dow, time '11:00', time '21:00', 1
  FROM unnest(ARRAY[v_downtown, v_riverside]) AS l(loc_id)
  CROSS JOIN unnest(ARRAY[v_server, v_line_cook]) AS r(role_id)
  CROSS JOIN unnest(ARRAY[2, 3, 4, 5, 6, 0]) AS d(dow);

  -- Friday and Saturday evening extras
  INSERT INTO public.coverage_requirements
    (location_id, role_id, day_of_week, start_time, end_time, min_employees)
  VALUES
    (v_downtown,  v_shift_lead, 5, time '17:00', time '22:00', 1),
    (v_downtown,  v_shift_lead, 6, time '17:00', time '22:00', 1),
    (v_downtown,  v_host,       5, time '17:00', time '21:00', 1),
    (v_downtown,  v_host,       6, time '17:00', time '21:00', 1),
    (v_riverside, v_shift_lead, 5, time '17:00', time '22:00', 1),
    (v_riverside, v_shift_lead, 6, time '17:00', time '22:00', 1),
    (v_riverside, v_dishwasher, 5, time '17:00', time '22:00', 1),
    (v_riverside, v_dishwasher, 6, time '17:00', time '22:00', 1);

  -- ---------------------------------------------------------------------------
  -- Schedules: w0 published (by the demo manager last Friday), w1 draft
  -- ---------------------------------------------------------------------------
  INSERT INTO public.schedules
    (organization_id, location_id, week_start_date, status, published_at, published_by, version)
  VALUES (
    v_org_id, v_downtown, v_w0, 'published',
    ((v_w0 - 3) + time '14:00') AT TIME ZONE 'America/Regina', v_manager_user_id, 1
  )
  RETURNING id INTO v_downtown_w0;

  INSERT INTO public.schedules
    (organization_id, location_id, week_start_date, status, published_at, published_by, version)
  VALUES (
    v_org_id, v_riverside, v_w0, 'published',
    ((v_w0 - 3) + time '14:00') AT TIME ZONE 'America/Regina', v_manager_user_id, 1
  )
  RETURNING id INTO v_riverside_w0;

  INSERT INTO public.schedules (organization_id, location_id, week_start_date, status)
  VALUES
    (v_org_id, v_downtown,  v_w1, 'draft'),
    (v_org_id, v_riverside, v_w1, 'draft');

  -- ---------------------------------------------------------------------------
  -- Shifts: one weekly rota, inserted for w0 and w1.
  -- Times are America/Regina local, on 15-minute marks:
  --   Server lunch 11:00-16:00, Server dinner 16:00-21:00,
  --   Line Cook AM 10:30-16:30, Line Cook PM 15:30-21:30,
  --   Host 17:00-21:00, Dishwasher 17:00-22:00, Shift Lead 15:00-23:00.
  -- w0 shifts link to the published schedule (employees can only read shifts
  -- on a published schedule); w1 shifts stay unlinked, like app-made drafts.
  -- ---------------------------------------------------------------------------
  INSERT INTO public.shifts
    (organization_id, location_id, schedule_id, employee_id, role_id, start_datetime, end_datetime)
  SELECT
    v_org_id,
    t.loc,
    CASE WHEN w.wk = 0 THEN
      CASE WHEN t.loc = v_downtown THEN v_downtown_w0 ELSE v_riverside_w0 END
    END,
    t.emp,
    t.role,
    ((v_w0 + w.wk + t.d) + t.starts) AT TIME ZONE 'America/Regina',
    ((v_w0 + w.wk + t.d) + t.ends)   AT TIME ZONE 'America/Regina'
  FROM (VALUES
    -- Downtown, Tuesday
    (v_downtown, 1, v_server,     v_sam,    time '11:00', time '16:00'),
    (v_downtown, 1, v_server,     v_theo,   time '16:00', time '21:00'),
    (v_downtown, 1, v_line_cook,  v_jordan, time '10:30', time '16:30'),
    (v_downtown, 1, v_line_cook,  v_rosa,   time '15:30', time '21:30'),
    -- Downtown, Wednesday
    (v_downtown, 2, v_server,     v_priya,  time '11:00', time '16:00'),
    (v_downtown, 2, v_server,     v_theo,   time '16:00', time '21:00'),
    (v_downtown, 2, v_line_cook,  v_ben,    time '10:30', time '16:30'),
    (v_downtown, 2, v_line_cook,  v_jordan, time '15:30', time '21:30'),
    -- Downtown, Thursday
    (v_downtown, 3, v_server,     v_sam,    time '11:00', time '16:00'),
    (v_downtown, 3, v_server,     v_priya,  time '16:00', time '21:00'),
    (v_downtown, 3, v_line_cook,  v_rosa,   time '10:30', time '16:30'),
    (v_downtown, 3, v_line_cook,  v_ben,    time '15:30', time '21:30'),
    -- Downtown, Friday
    (v_downtown, 4, v_server,     v_priya,  time '11:00', time '16:00'),
    (v_downtown, 4, v_server,     v_sam,    time '16:00', time '21:00'),
    (v_downtown, 4, v_host,       v_theo,   time '17:00', time '21:00'),
    (v_downtown, 4, v_shift_lead, v_nadia,  time '15:00', time '23:00'),
    (v_downtown, 4, v_line_cook,  v_rosa,   time '10:30', time '16:30'),
    (v_downtown, 4, v_line_cook,  v_ben,    time '15:30', time '21:30'),
    -- Downtown, Saturday
    (v_downtown, 5, v_server,     v_sam,    time '11:00', time '16:00'),
    (v_downtown, 5, v_server,     v_priya,  time '16:00', time '21:00'),
    (v_downtown, 5, v_host,       v_theo,   time '17:00', time '21:00'),
    (v_downtown, 5, v_shift_lead, v_nadia,  time '15:00', time '23:00'),
    (v_downtown, 5, v_line_cook,  v_ben,    time '10:30', time '16:30'),
    (v_downtown, 5, v_line_cook,  v_rosa,   time '15:30', time '21:30'),
    -- Downtown, Sunday
    (v_downtown, 6, v_server,     v_nadia,  time '11:00', time '16:00'),
    (v_downtown, 6, v_server,     v_theo,   time '16:00', time '21:00'),
    (v_downtown, 6, v_line_cook,  v_rosa,   time '10:30', time '16:30'),
    (v_downtown, 6, v_line_cook,  v_ben,    time '15:30', time '21:30'),

    -- Riverside, Tuesday
    (v_riverside, 1, v_server,     v_omar,   time '11:00', time '16:00'),
    (v_riverside, 1, v_server,     v_lucy,   time '16:00', time '21:00'),
    (v_riverside, 1, v_line_cook,  v_kai,    time '10:30', time '16:30'),
    (v_riverside, 1, v_line_cook,  v_mateo,  time '15:30', time '21:30'),
    -- Riverside, Wednesday
    (v_riverside, 2, v_server,     v_grace,  time '11:00', time '16:00'),
    (v_riverside, 2, v_server,     v_omar,   time '16:00', time '21:00'),
    (v_riverside, 2, v_line_cook,  v_mateo,  time '10:30', time '16:30'),
    (v_riverside, 2, v_line_cook,  v_kai,    time '15:30', time '21:30'),
    -- Riverside, Thursday (the PM Line Cook shift is left out of w1, below)
    (v_riverside, 3, v_server,     v_lucy,   time '11:00', time '16:00'),
    (v_riverside, 3, v_server,     v_grace,  time '16:00', time '21:00'),
    (v_riverside, 3, v_line_cook,  v_kai,    time '10:30', time '16:30'),
    (v_riverside, 3, v_line_cook,  v_jordan, time '15:30', time '21:30'),
    -- Riverside, Friday
    (v_riverside, 4, v_server,     v_omar,   time '11:00', time '16:00'),
    (v_riverside, 4, v_server,     v_lucy,   time '16:00', time '21:00'),
    (v_riverside, 4, v_line_cook,  v_jordan, time '10:30', time '16:30'),
    (v_riverside, 4, v_line_cook,  v_kai,    time '15:30', time '21:30'),
    (v_riverside, 4, v_dishwasher, v_mateo,  time '17:00', time '22:00'),
    (v_riverside, 4, v_shift_lead, v_grace,  time '15:00', time '23:00'),
    -- Riverside, Saturday
    (v_riverside, 5, v_server,     v_lucy,   time '11:00', time '16:00'),
    (v_riverside, 5, v_server,     v_omar,   time '16:00', time '21:00'),
    (v_riverside, 5, v_line_cook,  v_mateo,  time '10:30', time '16:30'),
    (v_riverside, 5, v_line_cook,  v_jordan, time '15:30', time '21:30'),
    (v_riverside, 5, v_dishwasher, v_kai,    time '17:00', time '22:00'),
    (v_riverside, 5, v_shift_lead, v_grace,  time '15:00', time '23:00'),
    -- Riverside, Sunday
    (v_riverside, 6, v_server,     v_grace,  time '11:00', time '16:00'),
    (v_riverside, 6, v_server,     v_lucy,   time '16:00', time '21:00'),
    (v_riverside, 6, v_line_cook,  v_kai,    time '10:30', time '16:30'),
    (v_riverside, 6, v_line_cook,  v_mateo,  time '15:30', time '21:30')
  ) AS t(loc, d, role, emp, starts, ends)
  CROSS JOIN (VALUES (0), (7)) AS w(wk)
  -- Leave Riverside Line Cook short on Thursday evening of w1, so the
  -- coverage check flags it in the draft week.
  WHERE NOT (w.wk = 7 AND t.loc = v_riverside AND t.d = 3
             AND t.role = v_line_cook AND t.starts = time '15:30');

  -- ---------------------------------------------------------------------------
  -- Published snapshot: same shape ScheduleGrid.handlePublish writes
  -- (the grid's shift rows, ordered by start time)
  -- ---------------------------------------------------------------------------
  UPDATE public.schedules sch
  SET snapshot = COALESCE((
    SELECT jsonb_agg(
             jsonb_build_object(
               'id',                   s.id,
               'location_id',          s.location_id,
               'employee_id',          s.employee_id,
               'role_id',              s.role_id,
               'start_datetime',       s.start_datetime,
               'end_datetime',         s.end_datetime,
               'break_start_datetime', s.break_start_datetime,
               'break_end_datetime',   s.break_end_datetime
             )
             ORDER BY s.start_datetime
           )
    FROM public.shifts s
    WHERE s.organization_id = v_org_id
      AND s.schedule_id = sch.id
  ), '[]'::jsonb)
  WHERE sch.organization_id = v_org_id
    AND sch.status = 'published';

  -- ---------------------------------------------------------------------------
  -- Pending time-off requests (dates are in w1 or later, so they always pass
  -- tor_start_date_not_past)
  -- ---------------------------------------------------------------------------
  INSERT INTO public.time_off_requests
    (organization_id, employee_id, start_date, end_date, reason, status)
  VALUES
    (v_org_id, v_sam,  v_w0 + 18, v_w0 + 20, 'Family wedding out of town', 'pending'),
    (v_org_id, v_omar, v_w0 + 8,  v_w0 + 8,  'Medical appointment',        'pending');

  -- ---------------------------------------------------------------------------
  -- Pending shift trade: Priya asks the demo employee (Sam) to swap their
  -- Saturday shifts in the published week. Both are Server shifts, so the
  -- swap keeps both of them inside availability and under daily limits.
  -- ---------------------------------------------------------------------------
  SELECT id INTO STRICT v_trade_from_shift
    FROM public.shifts
    WHERE organization_id = v_org_id
      AND employee_id = v_priya
      AND start_datetime = ((v_w0 + 5) + time '16:00') AT TIME ZONE 'America/Regina';

  SELECT id INTO STRICT v_trade_to_shift
    FROM public.shifts
    WHERE organization_id = v_org_id
      AND employee_id = v_sam
      AND start_datetime = ((v_w0 + 5) + time '11:00') AT TIME ZONE 'America/Regina';

  INSERT INTO public.shift_trade_requests
    (organization_id, requesting_employee_id, target_employee_id,
     requesting_shift_id, target_shift_id, status, requester_note)
  VALUES
    (v_org_id, v_priya, v_sam, v_trade_from_shift, v_trade_to_shift, 'pending',
     'Could we swap Saturday shifts? I have a family dinner that evening.');

  -- ---------------------------------------------------------------------------
  -- Restore the two demo logins (a visitor may have changed email or password).
  -- In its own block: if Supabase ever restricts writes to auth.users, the data
  -- reset above still commits and only a warning is raised.
  -- ---------------------------------------------------------------------------
  BEGIN
    UPDATE auth.users
      SET email              = 'demo-manager@example.com',
          encrypted_password = extensions.crypt(v_password, extensions.gen_salt('bf')),
          email_confirmed_at = COALESCE(email_confirmed_at, now()),
          updated_at         = now()
      WHERE id = v_manager_user_id;

    UPDATE auth.users
      SET email              = 'demo-employee@example.com',
          encrypted_password = extensions.crypt(v_password, extensions.gen_salt('bf')),
          email_confirmed_at = COALESCE(email_confirmed_at, now()),
          updated_at         = now()
      WHERE id = v_employee_user_id;
  EXCEPTION WHEN others THEN
    RAISE WARNING 'reset_demo: could not restore demo auth users: %', SQLERRM;
  END;
END;
$$;

-- =============================================================================
-- 3. Lock down EXECUTE (only postgres / pg_cron should run the reset)
-- =============================================================================

REVOKE EXECUTE ON FUNCTION private.reset_demo() FROM PUBLIC, anon, authenticated;

-- =============================================================================
-- 4. Nightly reset: 09:00 UTC = 3 AM Saskatchewan (America/Regina, no DST)
--    Unschedule first so rerunning this file does not fail or duplicate.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

SELECT cron.unschedule('reset-demo')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'reset-demo');

SELECT cron.schedule('reset-demo', '0 9 * * *', 'select private.reset_demo()');

-- =============================================================================
-- 5. Seed the demo org now
-- =============================================================================

SELECT private.reset_demo();

COMMIT;
