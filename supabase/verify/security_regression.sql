-- security_regression.sql
-- Regression check for 0009_manager_ownership_hardening.sql and
-- 0010_same_org_integrity.sql.
-- Paste the whole file into the Supabase SQL Editor and click Run (or run it
-- with psql as postgres). It returns ONE row of booleans. Expected: all true.
--
-- How it works: pg_temp.security_regression() builds two throwaway orgs
-- (A = victim, B = attacker) with their own auth users, managers, locations,
-- roles, employees, schedules and shifts, then runs each case as the API role
-- "authenticated" with that user's JWT claims (the same thing PostgREST does).
-- A "denied" case passes only when the write fails with the expected error
-- code; an "allowed" case passes only when it succeeds.
--
-- Safety: everything runs inside one subtransaction that is always rolled
-- back at the end (the results are kept in PL/pgSQL variables, which survive
-- the rollback). No row is left behind, in public or in auth.users. The only
-- thing created is a temporary function that disappears with the session.
-- Fixture ids start with f0f0 / emails end in @regression.invalid.
--
-- Columns:
--   n09_*  migration 0009 (manager ownership, same-org trades)
--   x10_*  migration 0010 (rows only reference rows in the same organization)

DROP FUNCTION IF EXISTS pg_temp.security_regression_try(text, text, boolean);
DROP FUNCTION IF EXISTS pg_temp.security_regression();

-- Run one statement as "authenticated" with the given user id.
-- Returns 'ok' or the SQLSTATE of the error. With p_keep = false the
-- statement's effects are always undone; with p_keep = true a successful
-- statement's effects stay (still inside the outer, rolled-back block).
CREATE FUNCTION pg_temp.security_regression_try(p_user text, p_sql text, p_keep boolean DEFAULT false)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_state text;
BEGIN
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', p_user, 'role', 'authenticated',
                        'email', p_user || '@regression.invalid')::text, true);
    EXECUTE p_sql;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);
    IF NOT p_keep THEN
      RAISE EXCEPTION 'security_regression:undo';
    END IF;
    RETURN 'ok';
  EXCEPTION WHEN others THEN
    -- the subtransaction rollback also restores the role and the claims
    IF SQLERRM = 'security_regression:undo' THEN
      RETURN 'ok';
    END IF;
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    RETURN v_state;
  END;
END;
$$;

CREATE FUNCTION pg_temp.security_regression()
RETURNS TABLE (
  n09_join_other_org_denied        boolean,
  n09_move_manager_row_denied      boolean,
  n09_created_by_pinned            boolean,
  n09_onboarding_works             boolean,
  n09_second_onboarding_refused    boolean,
  n09_trade_cross_org_denied       boolean,
  n09_trade_self_approve_denied    boolean,
  n09_trade_same_org_flow_works    boolean,
  x10_shift_location_denied        boolean,
  x10_shift_employee_denied        boolean,
  x10_shift_role_denied            boolean,
  x10_shift_schedule_denied        boolean,
  x10_shift_update_denied          boolean,
  x10_schedule_location_denied     boolean,
  x10_coverage_role_denied         boolean,
  x10_employee_role_denied         boolean,
  x10_availability_denied          boolean,
  x10_unavailability_denied        boolean,
  x10_home_location_denied         boolean,
  x10_time_off_denied              boolean,
  x10_manager_trade_denied         boolean,
  x10_location_delete_not_blocked  boolean,
  x10_same_org_writes_work         boolean,
  x10_delete_employee_nulls_shift  boolean,
  x10_delete_role_nulls_shift      boolean
)
LANGUAGE plpgsql
AS $$
DECLARE
  -- users
  u_a   text := 'f0f00000-0000-4000-8000-00000000a001';  -- manager of A
  u_b   text := 'f0f00000-0000-4000-8000-00000000b001';  -- manager of B
  u_new text := 'f0f00000-0000-4000-8000-00000000c001';  -- signed in, no org
  u_e1  text := 'f0f00000-0000-4000-8000-00000000a101';  -- employee in A
  u_e2  text := 'f0f00000-0000-4000-8000-00000000a102';  -- employee in A
  u_e3  text := 'f0f00000-0000-4000-8000-00000000b101';  -- employee in B
  -- rows
  org_a  text := 'f0f00000-0000-4000-8000-0000000a0000';
  org_b  text := 'f0f00000-0000-4000-8000-0000000b0000';
  loc_a  text := 'f0f00000-0000-4000-8000-0000000a0101';
  loc_a2 text := 'f0f00000-0000-4000-8000-0000000a0102';  -- spare, no shifts
  loc_b  text := 'f0f00000-0000-4000-8000-0000000b0101';
  role_a text := 'f0f00000-0000-4000-8000-0000000a0201';
  role_b text := 'f0f00000-0000-4000-8000-0000000b0201';
  emp_a1 text := 'f0f00000-0000-4000-8000-0000000a0301';
  emp_a2 text := 'f0f00000-0000-4000-8000-0000000a0302';
  emp_b1 text := 'f0f00000-0000-4000-8000-0000000b0301';
  sch_a  text := 'f0f00000-0000-4000-8000-0000000a0401';
  sch_b  text := 'f0f00000-0000-4000-8000-0000000b0401';
  sh_a1  text := 'f0f00000-0000-4000-8000-0000000a0501';
  sh_a2  text := 'f0f00000-0000-4000-8000-0000000a0502';
  sh_b1  text := 'f0f00000-0000-4000-8000-0000000b0501';
  trade  text := 'f0f00000-0000-4000-8000-0000000a0601';
  t1     text := quote_literal((date_trunc('week', now()) + interval '17 days 10 hours')::text);
  t2     text := quote_literal((date_trunc('week', now()) + interval '17 days 14 hours')::text);
  v      text;
  r      record;
  -- results
  b01 boolean; b02 boolean; b03 boolean; b04 boolean; b05 boolean;
  b06 boolean; b07 boolean; b08 boolean; b09 boolean; b10 boolean;
  b11 boolean; b12 boolean; b13 boolean; b14 boolean; b15 boolean;
  b16 boolean; b17 boolean; b18 boolean; b19 boolean; b20 boolean;
  b21 boolean; b22 boolean; b23 boolean; b24 boolean; b25 boolean;
BEGIN
  BEGIN
    -- -------------------------------------------------------------------------
    -- Fixtures (as postgres)
    -- -------------------------------------------------------------------------
    INSERT INTO auth.users (id, email)
    SELECT u::uuid, u || '@regression.invalid'
    FROM unnest(ARRAY[u_a, u_b, u_new, u_e1, u_e2, u_e3]) AS u;

    INSERT INTO public.organizations (id, name, created_by) VALUES
      (org_a::uuid, 'Regression A', u_a::uuid),
      (org_b::uuid, 'Regression B', u_b::uuid);
    INSERT INTO public.managers (id, organization_id, email) VALUES
      (u_a::uuid, org_a::uuid, 'a@regression.invalid'),
      (u_b::uuid, org_b::uuid, 'b@regression.invalid');
    INSERT INTO public.locations (id, organization_id, name, timezone) VALUES
      (loc_a::uuid,  org_a::uuid, 'A main',  'UTC'),
      (loc_a2::uuid, org_a::uuid, 'A spare', 'UTC'),
      (loc_b::uuid,  org_b::uuid, 'B main',  'UTC');
    INSERT INTO public.roles (id, organization_id, name) VALUES
      (role_a::uuid, org_a::uuid, 'A role'),
      (role_b::uuid, org_b::uuid, 'B role');
    INSERT INTO public.employees (id, organization_id, home_location_id, name, user_id) VALUES
      (emp_a1::uuid, org_a::uuid, loc_a::uuid, 'A one', u_e1::uuid),
      (emp_a2::uuid, org_a::uuid, loc_a::uuid, 'A two', u_e2::uuid),
      (emp_b1::uuid, org_b::uuid, loc_b::uuid, 'B one', u_e3::uuid);
    INSERT INTO public.schedules (id, organization_id, location_id, week_start_date, status) VALUES
      (sch_a::uuid, org_a::uuid, loc_a::uuid, (date_trunc('week', now()) + interval '14 days')::date, 'published'),
      (sch_b::uuid, org_b::uuid, loc_b::uuid, (date_trunc('week', now()) + interval '14 days')::date, 'published');
    EXECUTE format(
      'INSERT INTO public.shifts (id, organization_id, location_id, schedule_id, employee_id, role_id, start_datetime, end_datetime) VALUES
         (%L, %L, %L, %L, %L, %L, %s, %s),
         (%L, %L, %L, %L, %L, %L, %s::timestamptz + interval ''1 day'', %s::timestamptz + interval ''1 day''),
         (%L, %L, %L, %L, %L, %L, %s, %s)',
      sh_a1, org_a, loc_a, sch_a, emp_a1, role_a, t1, t2,
      sh_a2, org_a, loc_a, sch_a, emp_a2, role_a, t1, t2,
      sh_b1, org_b, loc_b, sch_b, emp_b1, role_b, t1, t2);

    -- -------------------------------------------------------------------------
    -- 0009
    -- -------------------------------------------------------------------------
    -- signed-in user without an org inserts a managers row for org A
    b01 := pg_temp.security_regression_try(u_new, format(
      'INSERT INTO public.managers (id, organization_id, email) VALUES (%L, %L, ''x'')', u_new, org_a)) = '42501';
    -- manager A moves their managers row to org B
    b02 := pg_temp.security_regression_try(u_a, format(
      'UPDATE public.managers SET organization_id = %L WHERE id = %L', org_b, u_a)) = '42501';
    -- a new org claiming created_by = manager B is stored with the caller instead
    v := pg_temp.security_regression_try(u_new, format(
      'INSERT INTO public.organizations (id, name, created_by) VALUES (''f0f00000-0000-4000-8000-0000000c0000'', ''spoof'', %L)', u_b), true);
    b03 := v = 'ok' AND (SELECT created_by::text FROM public.organizations
                          WHERE id = 'f0f00000-0000-4000-8000-0000000c0000') = u_new;
    DELETE FROM public.organizations WHERE id = 'f0f00000-0000-4000-8000-0000000c0000';
    -- onboarding RPC works for a new user, and refuses a second call
    -- (each check reads in its own statement, so it sees the case's writes)
    b04 := pg_temp.security_regression_try(u_new,
      'SELECT public.create_org_and_manager(''Regression new'')', true) = 'ok';
    b04 := b04 AND EXISTS (SELECT 1 FROM public.managers m JOIN public.organizations o ON o.id = m.organization_id
                   WHERE m.id = u_new::uuid AND o.created_by = u_new::uuid);
    b05 := pg_temp.security_regression_try(u_new,
      'SELECT public.create_org_and_manager(''Regression again'')') = '23505';
    -- employee E1 (org A) targets an org B employee and shift
    b06 := pg_temp.security_regression_try(u_e1, format(
      'INSERT INTO public.shift_trade_requests (organization_id, requesting_employee_id, target_employee_id, requesting_shift_id, target_shift_id)
       VALUES (%L, %L, %L, %L, %L)', org_a, emp_a1, emp_b1, sh_a1, sh_b1)) = '42501';
    -- same-org swap: E1 asks E2, E2 cannot self-approve, E2 accepts, manager approves
    b08 := pg_temp.security_regression_try(u_e1, format(
      'INSERT INTO public.shift_trade_requests (id, organization_id, requesting_employee_id, target_employee_id, requesting_shift_id, target_shift_id)
       VALUES (%L, %L, %L, %L, %L, %L)', trade, org_a, emp_a1, emp_a2, sh_a1, sh_a2), true) = 'ok';
    b07 := pg_temp.security_regression_try(u_e2, format(
      'UPDATE public.shift_trade_requests SET status = ''approved'' WHERE id = %L', trade)) = '42501';
    b08 := b08
      AND pg_temp.security_regression_try(u_e2, format(
            'SELECT public.respond_to_shift_trade(%L, ''accepted'')', trade), true) = 'ok';
    b08 := b08
      AND pg_temp.security_regression_try(u_a, format(
            'SELECT public.approve_reject_shift_trade(%L, ''approved'', NULL)', trade), true) = 'ok';
    b08 := b08
      AND (SELECT employee_id::text FROM public.shifts WHERE id = sh_a1::uuid) = emp_a2
      AND (SELECT employee_id::text FROM public.shifts WHERE id = sh_a2::uuid) = emp_a1;

    -- -------------------------------------------------------------------------
    -- 0010: manager B points org B rows at org A rows (expect 23503)
    -- -------------------------------------------------------------------------
    b09 := pg_temp.security_regression_try(u_b, format(
      'INSERT INTO public.shifts (organization_id, location_id, start_datetime, end_datetime) VALUES (%L, %L, %s, %s)',
      org_b, loc_a, t1, t2)) = '23503';
    b10 := pg_temp.security_regression_try(u_b, format(
      'INSERT INTO public.shifts (organization_id, location_id, employee_id, start_datetime, end_datetime) VALUES (%L, %L, %L, %s, %s)',
      org_b, loc_b, emp_a1, t1, t2)) = '23503';
    b11 := pg_temp.security_regression_try(u_b, format(
      'INSERT INTO public.shifts (organization_id, location_id, role_id, start_datetime, end_datetime) VALUES (%L, %L, %L, %s, %s)',
      org_b, loc_b, role_a, t1, t2)) = '23503';
    b12 := pg_temp.security_regression_try(u_b, format(
      'INSERT INTO public.shifts (organization_id, location_id, schedule_id, start_datetime, end_datetime) VALUES (%L, %L, %L, %s, %s)',
      org_b, loc_b, sch_a, t1, t2)) = '23503';
    b13 := pg_temp.security_regression_try(u_b, format(
      'UPDATE public.shifts SET location_id = %L WHERE id = %L', loc_a, sh_b1)) = '23503'
       AND pg_temp.security_regression_try(u_b, format(
      'UPDATE public.shifts SET employee_id = %L WHERE id = %L', emp_a1, sh_b1)) = '23503'
       AND pg_temp.security_regression_try(u_b, format(
      'UPDATE public.shifts SET role_id = %L WHERE id = %L', role_a, sh_b1)) = '23503'
       AND pg_temp.security_regression_try(u_b, format(
      'UPDATE public.shifts SET schedule_id = %L WHERE id = %L', sch_a, sh_b1)) = '23503';
    b14 := pg_temp.security_regression_try(u_b, format(
      'INSERT INTO public.schedules (organization_id, location_id, week_start_date) VALUES (%L, %L, current_date + 700)',
      org_b, loc_a)) = '23503'
       AND pg_temp.security_regression_try(u_b, format(
      'UPDATE public.schedules SET location_id = %L WHERE id = %L', loc_a2, sch_b)) = '23503';
    b15 := pg_temp.security_regression_try(u_b, format(
      'INSERT INTO public.coverage_requirements (location_id, role_id, day_of_week, start_time, end_time) VALUES (%L, %L, 1, ''09:00'', ''17:00'')',
      loc_b, role_a)) = '23503';
    b16 := pg_temp.security_regression_try(u_b, format(
      'INSERT INTO public.employee_roles (employee_id, role_id) VALUES (%L, %L)', emp_b1, role_a)) = '23503';
    b17 := pg_temp.security_regression_try(u_b, format(
      'INSERT INTO public.employee_availability (organization_id, employee_id, day_of_week, start_time, end_time) VALUES (%L, %L, 1, ''09:00'', ''17:00'')',
      org_b, emp_a1)) = '23503';
    b18 := pg_temp.security_regression_try(u_b, format(
      'INSERT INTO public.employee_unavailability (organization_id, employee_id, start_datetime, end_datetime) VALUES (%L, %L, %s, %s)',
      org_b, emp_a1, t1, t2)) = '23503';
    b19 := pg_temp.security_regression_try(u_b, format(
      'UPDATE public.employees SET home_location_id = %L WHERE id = %L', loc_a, emp_b1)) = '23503';
    b20 := pg_temp.security_regression_try(u_b, format(
      'INSERT INTO public.time_off_requests (organization_id, employee_id, start_date, end_date) VALUES (%L, %L, current_date + 30, current_date + 31)',
      org_b, emp_a1)) = '23503';
    b21 := pg_temp.security_regression_try(u_b, format(
      'INSERT INTO public.shift_trade_requests (organization_id, requesting_employee_id, target_employee_id) VALUES (%L, %L, %L)',
      org_b, emp_b1, emp_a1)) = '23503'
       AND pg_temp.security_regression_try(u_b, format(
      'INSERT INTO public.shift_trade_requests (organization_id, requesting_employee_id, target_employee_id, target_shift_id) VALUES (%L, %L, %L, %L)',
      org_b, emp_b1, emp_b1, sh_a1)) = '23503';
    -- location-delete DoS: B cannot plant a future shift on A's spare location,
    -- and A can still delete it
    b22 := pg_temp.security_regression_try(u_b, format(
      'INSERT INTO public.shifts (organization_id, location_id, start_datetime, end_datetime) VALUES (%L, %L, %s, %s)',
      org_b, loc_a2, t1, t2), true) = '23503'
       AND pg_temp.security_regression_try(u_a, format(
      'DELETE FROM public.locations WHERE id = %L', loc_a2), true) = 'ok';
    b22 := b22 AND NOT EXISTS (SELECT 1 FROM public.locations WHERE id = loc_a2::uuid);

    -- -------------------------------------------------------------------------
    -- 0010: same-org writes still work (manager A)
    -- -------------------------------------------------------------------------
    b23 := pg_temp.security_regression_try(u_a, format(
      'INSERT INTO public.shifts (organization_id, location_id, start_datetime, end_datetime) VALUES (%L, %L, %s, %s)',
      org_a, loc_a, t1, t2)) = 'ok'                                        -- open shift: employee/role/schedule NULL
       AND pg_temp.security_regression_try(u_a, format(
      'INSERT INTO public.shifts (organization_id, location_id, employee_id, role_id, schedule_id, start_datetime, end_datetime) VALUES (%L, %L, %L, %L, %L, %s, %s)',
      org_a, loc_a, emp_a1, role_a, sch_a, t1, t2)) = 'ok'
       AND pg_temp.security_regression_try(u_a, format(
      'UPDATE public.shifts SET employee_id = NULL, role_id = NULL WHERE id = %L', sh_a1)) = 'ok'
       AND pg_temp.security_regression_try(u_a, format(
      'INSERT INTO public.coverage_requirements (location_id, role_id, day_of_week, start_time, end_time) VALUES (%L, %L, 1, ''09:00'', ''17:00'')',
      loc_a, role_a)) = 'ok'
       AND pg_temp.security_regression_try(u_a, format(
      'INSERT INTO public.employee_roles (employee_id, role_id) VALUES (%L, %L)', emp_a2, role_a)) = 'ok'
       AND pg_temp.security_regression_try(u_a, format(
      'INSERT INTO public.employee_availability (organization_id, employee_id, day_of_week, start_time, end_time) VALUES (%L, %L, 1, ''09:00'', ''17:00'')',
      org_a, emp_a1)) = 'ok'
       AND pg_temp.security_regression_try(u_a, format(
      'UPDATE public.employees SET name = ''A one b'', organization_id = %L, home_location_id = %L WHERE id = %L',
      org_a, loc_a, emp_a1)) = 'ok'
       AND pg_temp.security_regression_try(u_a, format(
      'INSERT INTO public.time_off_requests (organization_id, employee_id, start_date, end_date) VALUES (%L, %L, current_date + 30, current_date + 31)',
      org_a, emp_a1)) = 'ok';

    -- ON DELETE unchanged: deleting an employee / role nulls only that column
    b24 := pg_temp.security_regression_try(u_a, format(
      'DELETE FROM public.employees WHERE id = %L', emp_a2), true) = 'ok';
    SELECT * INTO r FROM public.shifts WHERE id = sh_a1::uuid;          -- E2 has sh_a1 after the swap
    b24 := b24 AND r.employee_id IS NULL AND r.organization_id = org_a::uuid AND r.role_id = role_a::uuid;
    b25 := pg_temp.security_regression_try(u_a, format(
      'DELETE FROM public.roles WHERE id = %L', role_a), true) = 'ok';
    SELECT * INTO r FROM public.shifts WHERE id = sh_a2::uuid;
    b25 := b25 AND r.role_id IS NULL AND r.organization_id = org_a::uuid AND r.employee_id = emp_a1::uuid;

    RAISE EXCEPTION 'security_regression:rollback';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'security_regression:rollback' THEN
      RAISE;
    END IF;
  END;

  RETURN QUERY SELECT
    coalesce(b01, false), coalesce(b02, false), coalesce(b03, false), coalesce(b04, false),
    coalesce(b05, false), coalesce(b06, false), coalesce(b07, false), coalesce(b08, false),
    coalesce(b09, false), coalesce(b10, false), coalesce(b11, false), coalesce(b12, false),
    coalesce(b13, false), coalesce(b14, false), coalesce(b15, false), coalesce(b16, false),
    coalesce(b17, false), coalesce(b18, false), coalesce(b19, false), coalesce(b20, false),
    coalesce(b21, false), coalesce(b22, false), coalesce(b23, false), coalesce(b24, false),
    coalesce(b25, false);
END;
$$;

SELECT * FROM pg_temp.security_regression();
