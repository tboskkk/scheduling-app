-- 0010_same_org_integrity.sql
-- Rows can only reference rows in the same organization.
-- Apply in the Supabase dashboard SQL editor. Runs as a single transaction and
-- is safe to run more than once. Needs Postgres 15 or later
-- (ON DELETE SET NULL (column)).
--
-- The hole: the manager write policies (0004) only check a row's own
-- organization_id. The foreign keys on that row (location, employee, role,
-- schedule, shift) were never checked, so any signed-in user could create
-- their own org (onboarding) and point their rows at another org's rows.
-- Nothing leaked on read, but:
--   - a future shift in org B pointing at org A's location made
--     trg_prevent_location_delete (SECURITY DEFINER, sees every org) refuse
--     to delete that location in org A (denial of service);
--   - everything else was silent cross-org corruption (another org's
--     employee on a shift, time-off or trade row, another org's role on a
--     coverage rule or employee, ...).
--
-- Changes:
--   1. Pre-check: abort with a list of offending rows if live data already
--      has a cross-org reference (nothing is changed in that case)
--   2. Check that every foreign key below exists exactly once, with the
--      expected name and ON DELETE action (abort if the live schema differs)
--   3. UNIQUE (organization_id, id) on locations, employees, roles,
--      schedules and shifts, so they can be the target of composite keys
--   4. Replace each org-scoped foreign key with a composite one on
--      (organization_id, <column>), same name, same ON DELETE action.
--      SET NULL keys use ON DELETE SET NULL (<column>) so organization_id is
--      never nulled. MATCH SIMPLE (the default): a NULL employee_id / role_id
--      / schedule_id / shift id skips the check, so open shifts still work.
--   5. coverage_requirements and employee_roles have no organization_id:
--      a BEFORE INSERT/UPDATE trigger checks that both sides are in the same
--      organization
--
-- Composite keys are enforced for every role (postgres, service_role and
-- SECURITY DEFINER functions included), so no RLS policy changes are needed.
-- Constraint names are kept, so PostgREST embeds and the
-- employees!shift_trade_requests_..._fkey hints in the app keep working.
--
-- Side effect: a referenced row's organization_id can no longer be changed
-- while other rows point at it (ON UPDATE NO ACTION). The API roles could
-- never change it anyway (the update policies pin organization_id).
--
-- Not org-scoped, unchanged: every <table>.organization_id ->
-- organizations, managers.id -> auth.users, employees.user_id -> auth.users,
-- schedules.published_by -> auth.users.

BEGIN;

-- =============================================================================
-- 0. Server version
-- =============================================================================

DO $$
BEGIN
  IF current_setting('server_version_num')::int < 150000 THEN
    RAISE EXCEPTION '0010 needs Postgres 15 or later (found %)', current_setting('server_version');
  END IF;
END
$$;

-- =============================================================================
-- 1. Pre-check: no existing cross-org references
--
--    Each query returns the ids of rows that point at a row in another
--    organization. If any are found, the migration stops here and lists up
--    to five ids per relationship. Fix (or delete) those rows and run again.
-- =============================================================================

DO $$
DECLARE
  r       record;
  v_count bigint;
  v_ids   text;
  v_msg   text := '';
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('shifts.location_id',
       'SELECT c.id::text FROM public.shifts c JOIN public.locations p ON p.id = c.location_id WHERE p.organization_id <> c.organization_id'),
      ('shifts.employee_id',
       'SELECT c.id::text FROM public.shifts c JOIN public.employees p ON p.id = c.employee_id WHERE p.organization_id <> c.organization_id'),
      ('shifts.role_id',
       'SELECT c.id::text FROM public.shifts c JOIN public.roles p ON p.id = c.role_id WHERE p.organization_id <> c.organization_id'),
      ('shifts.schedule_id',
       'SELECT c.id::text FROM public.shifts c JOIN public.schedules p ON p.id = c.schedule_id WHERE p.organization_id <> c.organization_id'),
      ('schedules.location_id',
       'SELECT c.id::text FROM public.schedules c JOIN public.locations p ON p.id = c.location_id WHERE p.organization_id <> c.organization_id'),
      ('employees.home_location_id',
       'SELECT c.id::text FROM public.employees c JOIN public.locations p ON p.id = c.home_location_id WHERE p.organization_id <> c.organization_id'),
      ('employee_availability.employee_id',
       'SELECT c.id::text FROM public.employee_availability c JOIN public.employees p ON p.id = c.employee_id WHERE p.organization_id <> c.organization_id'),
      ('employee_unavailability.employee_id',
       'SELECT c.id::text FROM public.employee_unavailability c JOIN public.employees p ON p.id = c.employee_id WHERE p.organization_id <> c.organization_id'),
      ('time_off_requests.employee_id',
       'SELECT c.id::text FROM public.time_off_requests c JOIN public.employees p ON p.id = c.employee_id WHERE p.organization_id <> c.organization_id'),
      ('shift_trade_requests.requesting_employee_id',
       'SELECT c.id::text FROM public.shift_trade_requests c JOIN public.employees p ON p.id = c.requesting_employee_id WHERE p.organization_id <> c.organization_id'),
      ('shift_trade_requests.target_employee_id',
       'SELECT c.id::text FROM public.shift_trade_requests c JOIN public.employees p ON p.id = c.target_employee_id WHERE p.organization_id <> c.organization_id'),
      ('shift_trade_requests.requesting_shift_id',
       'SELECT c.id::text FROM public.shift_trade_requests c JOIN public.shifts p ON p.id = c.requesting_shift_id WHERE p.organization_id <> c.organization_id'),
      ('shift_trade_requests.target_shift_id',
       'SELECT c.id::text FROM public.shift_trade_requests c JOIN public.shifts p ON p.id = c.target_shift_id WHERE p.organization_id <> c.organization_id'),
      ('coverage_requirements (location vs role)',
       'SELECT c.id::text FROM public.coverage_requirements c JOIN public.locations l ON l.id = c.location_id JOIN public.roles p ON p.id = c.role_id WHERE p.organization_id <> l.organization_id'),
      ('employee_roles (employee vs role)',
       'SELECT c.employee_id::text || ''/'' || c.role_id::text FROM public.employee_roles c JOIN public.employees e ON e.id = c.employee_id JOIN public.roles p ON p.id = c.role_id WHERE p.organization_id <> e.organization_id')
    ) AS t(label, q)
  LOOP
    EXECUTE format(
      'SELECT count(*), string_agg(id, '', '') FILTER (WHERE rn <= 5)
         FROM (SELECT id, row_number() OVER (ORDER BY id) AS rn FROM (%s) x(id)) y',
      r.q)
      INTO v_count, v_ids;
    IF v_count > 0 THEN
      v_msg := v_msg || format(E'\n  %s: %s row(s), e.g. %s', r.label, v_count, v_ids);
    END IF;
  END LOOP;

  IF v_msg <> '' THEN
    RAISE EXCEPTION '0010 stopped, nothing was changed: rows reference another organization:%', v_msg
      USING errcode = '23503';
  END IF;
END
$$;

-- =============================================================================
-- 2. Expected starting point
--
--    Each relationship must have exactly one foreign key, with the name and
--    ON DELETE action from 0001 / 0002 (or the composite version from an
--    earlier run of this file). Otherwise stop, so a schema that drifted from
--    the migrations is never silently changed.
--    confdeltype: c = CASCADE, n = SET NULL.
-- =============================================================================

DO $$
DECLARE
  r      record;
  v_n    int;
  v_name text;
  v_del  text;
  v_upd  text;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('shifts',                  'location_id',            'locations', 'shifts_location_id_fkey',                        'c'),
      ('shifts',                  'employee_id',            'employees', 'shifts_employee_id_fkey',                        'n'),
      ('shifts',                  'role_id',                'roles',     'shifts_role_id_fkey',                            'n'),
      ('shifts',                  'schedule_id',            'schedules', 'shifts_schedule_id_fkey',                        'c'),
      ('schedules',               'location_id',            'locations', 'schedules_location_id_fkey',                     'c'),
      ('employees',               'home_location_id',       'locations', 'employees_home_location_id_fkey',                'n'),
      ('employee_availability',   'employee_id',            'employees', 'employee_availability_employee_id_fkey',         'c'),
      ('employee_unavailability', 'employee_id',            'employees', 'employee_unavailability_employee_id_fkey',       'c'),
      ('time_off_requests',       'employee_id',            'employees', 'time_off_requests_employee_id_fkey',             'c'),
      ('shift_trade_requests',    'requesting_employee_id', 'employees', 'shift_trade_requests_requesting_employee_id_fkey', 'c'),
      ('shift_trade_requests',    'target_employee_id',     'employees', 'shift_trade_requests_target_employee_id_fkey',   'c'),
      ('shift_trade_requests',    'requesting_shift_id',    'shifts',    'shift_trade_requests_requesting_shift_id_fkey',  'n'),
      ('shift_trade_requests',    'target_shift_id',        'shifts',    'shift_trade_requests_target_shift_id_fkey',      'n')
    ) AS t(tbl, col, ref, conname, del)
  LOOP
    SELECT count(*), string_agg(c.conname, ','), string_agg(c.confdeltype::text, ','),
           string_agg(c.confupdtype::text, ',')
      INTO v_n, v_name, v_del, v_upd
      FROM pg_constraint c
      JOIN pg_attribute a
        ON a.attrelid = c.conrelid AND a.attname = r.col
     WHERE c.contype = 'f'
       AND c.conrelid  = format('public.%I', r.tbl)::regclass
       AND c.confrelid = format('public.%I', r.ref)::regclass
       AND a.attnum = ANY (c.conkey);

    IF v_n <> 1 OR v_name IS DISTINCT FROM r.conname OR v_del IS DISTINCT FROM r.del
       OR v_upd IS DISTINCT FROM 'a' THEN
      RAISE EXCEPTION '0010 stopped, nothing was changed: expected one foreign key %.% -> % named % (on delete %, on update no action); found % (name %, on delete %, on update %)',
        r.tbl, r.col, r.ref, r.conname, r.del, v_n, v_name, v_del, v_upd;
    END IF;
  END LOOP;
END
$$;

-- =============================================================================
-- 3. UNIQUE (organization_id, id) on the referenced tables
--
--    id is already the primary key, so this never rejects a row. It only
--    gives the composite foreign keys below something to reference.
-- =============================================================================

DO $$
DECLARE
  v_tbl text;
BEGIN
  FOREACH v_tbl IN ARRAY ARRAY['locations', 'employees', 'roles', 'schedules', 'shifts']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname  = v_tbl || '_organization_id_id_key'
        AND conrelid = format('public.%I', v_tbl)::regclass
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I UNIQUE (organization_id, id)',
        v_tbl, v_tbl || '_organization_id_id_key');
    END IF;
  END LOOP;
END
$$;

-- =============================================================================
-- 4. Composite foreign keys (same names, same ON DELETE actions)
--
--    Each statement drops the old key and adds the new one in one ALTER
--    TABLE, so the table is never without a key. Adding validates every
--    existing row (already proven clean by step 1).
-- =============================================================================

-- shifts
ALTER TABLE public.shifts
  DROP CONSTRAINT IF EXISTS shifts_location_id_fkey,
  ADD  CONSTRAINT shifts_location_id_fkey
    FOREIGN KEY (organization_id, location_id)
    REFERENCES public.locations (organization_id, id)
    ON DELETE CASCADE;

ALTER TABLE public.shifts
  DROP CONSTRAINT IF EXISTS shifts_employee_id_fkey,
  ADD  CONSTRAINT shifts_employee_id_fkey
    FOREIGN KEY (organization_id, employee_id)
    REFERENCES public.employees (organization_id, id)
    ON DELETE SET NULL (employee_id);

ALTER TABLE public.shifts
  DROP CONSTRAINT IF EXISTS shifts_role_id_fkey,
  ADD  CONSTRAINT shifts_role_id_fkey
    FOREIGN KEY (organization_id, role_id)
    REFERENCES public.roles (organization_id, id)
    ON DELETE SET NULL (role_id);

ALTER TABLE public.shifts
  DROP CONSTRAINT IF EXISTS shifts_schedule_id_fkey,
  ADD  CONSTRAINT shifts_schedule_id_fkey
    FOREIGN KEY (organization_id, schedule_id)
    REFERENCES public.schedules (organization_id, id)
    ON DELETE CASCADE;

-- schedules
ALTER TABLE public.schedules
  DROP CONSTRAINT IF EXISTS schedules_location_id_fkey,
  ADD  CONSTRAINT schedules_location_id_fkey
    FOREIGN KEY (organization_id, location_id)
    REFERENCES public.locations (organization_id, id)
    ON DELETE CASCADE;

-- employees
ALTER TABLE public.employees
  DROP CONSTRAINT IF EXISTS employees_home_location_id_fkey,
  ADD  CONSTRAINT employees_home_location_id_fkey
    FOREIGN KEY (organization_id, home_location_id)
    REFERENCES public.locations (organization_id, id)
    ON DELETE SET NULL (home_location_id);

-- employee_availability / employee_unavailability
ALTER TABLE public.employee_availability
  DROP CONSTRAINT IF EXISTS employee_availability_employee_id_fkey,
  ADD  CONSTRAINT employee_availability_employee_id_fkey
    FOREIGN KEY (organization_id, employee_id)
    REFERENCES public.employees (organization_id, id)
    ON DELETE CASCADE;

ALTER TABLE public.employee_unavailability
  DROP CONSTRAINT IF EXISTS employee_unavailability_employee_id_fkey,
  ADD  CONSTRAINT employee_unavailability_employee_id_fkey
    FOREIGN KEY (organization_id, employee_id)
    REFERENCES public.employees (organization_id, id)
    ON DELETE CASCADE;

-- time_off_requests
ALTER TABLE public.time_off_requests
  DROP CONSTRAINT IF EXISTS time_off_requests_employee_id_fkey,
  ADD  CONSTRAINT time_off_requests_employee_id_fkey
    FOREIGN KEY (organization_id, employee_id)
    REFERENCES public.employees (organization_id, id)
    ON DELETE CASCADE;

-- shift_trade_requests (0009 closed the employee policies; this also covers
-- the manager "FOR ALL" policy, which only checks organization_id)
ALTER TABLE public.shift_trade_requests
  DROP CONSTRAINT IF EXISTS shift_trade_requests_requesting_employee_id_fkey,
  ADD  CONSTRAINT shift_trade_requests_requesting_employee_id_fkey
    FOREIGN KEY (organization_id, requesting_employee_id)
    REFERENCES public.employees (organization_id, id)
    ON DELETE CASCADE;

ALTER TABLE public.shift_trade_requests
  DROP CONSTRAINT IF EXISTS shift_trade_requests_target_employee_id_fkey,
  ADD  CONSTRAINT shift_trade_requests_target_employee_id_fkey
    FOREIGN KEY (organization_id, target_employee_id)
    REFERENCES public.employees (organization_id, id)
    ON DELETE CASCADE;

ALTER TABLE public.shift_trade_requests
  DROP CONSTRAINT IF EXISTS shift_trade_requests_requesting_shift_id_fkey,
  ADD  CONSTRAINT shift_trade_requests_requesting_shift_id_fkey
    FOREIGN KEY (organization_id, requesting_shift_id)
    REFERENCES public.shifts (organization_id, id)
    ON DELETE SET NULL (requesting_shift_id);

ALTER TABLE public.shift_trade_requests
  DROP CONSTRAINT IF EXISTS shift_trade_requests_target_shift_id_fkey,
  ADD  CONSTRAINT shift_trade_requests_target_shift_id_fkey
    FOREIGN KEY (organization_id, target_shift_id)
    REFERENCES public.shifts (organization_id, id)
    ON DELETE SET NULL (target_shift_id);

-- =============================================================================
-- 5. Tables without organization_id: same-org triggers
--
--    coverage_requirements hangs off a location; employee_roles off an
--    employee. Adding an organization_id column would need the app (or
--    another trigger) to fill it, so a check trigger is simpler. Their
--    existing single-column foreign keys (all ON DELETE CASCADE) stay.
--
--    SECURITY DEFINER (owned by postgres) so the check sees both rows past
--    RLS and compares the real organizations. FOR KEY SHARE locks the two
--    parent rows like a foreign key check does, so neither can be deleted
--    or moved to another organization before this transaction commits.
--    A missing parent is left to the foreign key (clearer error).
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.coverage_requirements_same_org()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_location_org uuid;
  v_role_org     uuid;
BEGIN
  SELECT organization_id INTO v_location_org
    FROM public.locations WHERE id = NEW.location_id FOR KEY SHARE;
  SELECT organization_id INTO v_role_org
    FROM public.roles WHERE id = NEW.role_id FOR KEY SHARE;

  IF v_location_org IS NOT NULL AND v_role_org IS NOT NULL
     AND v_location_org <> v_role_org THEN
    RAISE EXCEPTION 'coverage rule role and location must belong to the same organization'
      USING errcode = '23503';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.employee_roles_same_org()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_employee_org uuid;
  v_role_org     uuid;
BEGIN
  SELECT organization_id INTO v_employee_org
    FROM public.employees WHERE id = NEW.employee_id FOR KEY SHARE;
  SELECT organization_id INTO v_role_org
    FROM public.roles WHERE id = NEW.role_id FOR KEY SHARE;

  IF v_employee_org IS NOT NULL AND v_role_org IS NOT NULL
     AND v_employee_org <> v_role_org THEN
    RAISE EXCEPTION 'employee and role must belong to the same organization'
      USING errcode = '23503';
  END IF;
  RETURN NEW;
END;
$$;

-- Trigger machinery does not need EXECUTE; nobody should call these directly.
REVOKE EXECUTE ON FUNCTION private.coverage_requirements_same_org() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION private.employee_roles_same_org()        FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_coverage_requirements_same_org ON public.coverage_requirements;
CREATE TRIGGER trg_coverage_requirements_same_org
  BEFORE INSERT OR UPDATE OF location_id, role_id ON public.coverage_requirements
  FOR EACH ROW
  EXECUTE FUNCTION private.coverage_requirements_same_org();

DROP TRIGGER IF EXISTS trg_employee_roles_same_org ON public.employee_roles;
CREATE TRIGGER trg_employee_roles_same_org
  BEFORE INSERT OR UPDATE OF employee_id, role_id ON public.employee_roles
  FOR EACH ROW
  EXECUTE FUNCTION private.employee_roles_same_org();

-- PostgREST: reload the schema cache (relationships changed shape).
NOTIFY pgrst, 'reload schema';

COMMIT;
