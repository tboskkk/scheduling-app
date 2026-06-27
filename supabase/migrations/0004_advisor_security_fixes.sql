-- 0004_advisor_security_fixes.sql
-- Addresses 19 of 20 Supabase Advisor security warnings.
--
-- Remaining warning (auth_leaked_password_protection) requires a Dashboard action:
--   Auth → Settings → Enable "Leaked Password Protection"
--
-- Changes:
--   1. Move citext extension from public to extensions schema
--   2. Create private schema; move RLS helper functions there (removes REST exposure)
--   3. Rebuild all RLS policies to reference private.xxx() helpers
--   4. Update employee_public_profiles view
--   5. Drop old public-schema helper functions
--   6. Switch action RPCs to SECURITY INVOKER (eliminates authenticated SD warnings)
--   7. Add employee UPDATE policy on shift_trade_requests (required for SECURITY INVOKER)
--   8. Lock down EXECUTE grants: revoke PUBLIC, grant only authenticated where needed

BEGIN;

-- ═════════════════════════════════════════════════════════════════════════════
-- 1. Move citext out of the public schema
-- ═════════════════════════════════════════════════════════════════════════════

ALTER EXTENSION citext SET SCHEMA extensions;

-- ═════════════════════════════════════════════════════════════════════════════
-- 2. Private schema + helper functions (not exposed via PostgREST/REST API)
--
--    These must remain SECURITY DEFINER: they are called inside RLS policies
--    on the very tables they query, so SECURITY INVOKER would cause infinite
--    recursion. Moving them to "private" removes the REST exposure that
--    triggered the advisor warnings.
-- ═════════════════════════════════════════════════════════════════════════════

CREATE SCHEMA IF NOT EXISTS private;

-- Roles need USAGE on private so RLS policy evaluation can call functions here.
GRANT USAGE ON SCHEMA private TO authenticated, anon, service_role;

CREATE OR REPLACE FUNCTION private.current_manager_org_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id FROM public.managers WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION private.current_employee_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.employees WHERE user_id = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION private.current_employee_org_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id FROM public.employees WHERE user_id = auth.uid() LIMIT 1;
$$;

-- Explicitly revoke PUBLIC default and grant only what's needed.
REVOKE EXECUTE ON FUNCTION private.current_manager_org_id()  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION private.current_employee_id()     FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION private.current_employee_org_id() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION private.current_manager_org_id()  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.current_employee_id()     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.current_employee_org_id() TO authenticated, service_role;

-- ═════════════════════════════════════════════════════════════════════════════
-- 3. Rebuild all RLS policies to use private.xxx() helpers
-- ═════════════════════════════════════════════════════════════════════════════

-- ── organizations ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Select own org" ON public.organizations;
CREATE POLICY "Select own org" ON public.organizations
  FOR SELECT USING (id = private.current_manager_org_id());

DROP POLICY IF EXISTS "Update own org" ON public.organizations;
CREATE POLICY "Update own org" ON public.organizations
  FOR UPDATE
  USING     (id = private.current_manager_org_id())
  WITH CHECK (id = private.current_manager_org_id());

-- ── locations ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Select locations in org" ON public.locations;
CREATE POLICY "Select locations in org" ON public.locations
  FOR SELECT USING (organization_id = private.current_manager_org_id());

DROP POLICY IF EXISTS "Insert locations in org" ON public.locations;
CREATE POLICY "Insert locations in org" ON public.locations
  FOR INSERT WITH CHECK (organization_id = private.current_manager_org_id());

DROP POLICY IF EXISTS "Update locations in org" ON public.locations;
CREATE POLICY "Update locations in org" ON public.locations
  FOR UPDATE
  USING     (organization_id = private.current_manager_org_id())
  WITH CHECK (organization_id = private.current_manager_org_id());

DROP POLICY IF EXISTS "Delete locations in org" ON public.locations;
CREATE POLICY "Delete locations in org" ON public.locations
  FOR DELETE USING (organization_id = private.current_manager_org_id());

DROP POLICY IF EXISTS "employees can read locations" ON public.locations;
CREATE POLICY "employees can read locations" ON public.locations
  FOR SELECT USING (organization_id = private.current_employee_org_id());

-- ── roles ─────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Select roles in org" ON public.roles;
CREATE POLICY "Select roles in org" ON public.roles
  FOR SELECT USING (organization_id = private.current_manager_org_id());

DROP POLICY IF EXISTS "Insert roles in org" ON public.roles;
CREATE POLICY "Insert roles in org" ON public.roles
  FOR INSERT WITH CHECK (organization_id = private.current_manager_org_id());

DROP POLICY IF EXISTS "Update roles in org" ON public.roles;
CREATE POLICY "Update roles in org" ON public.roles
  FOR UPDATE
  USING     (organization_id = private.current_manager_org_id())
  WITH CHECK (organization_id = private.current_manager_org_id());

DROP POLICY IF EXISTS "Delete roles in org" ON public.roles;
CREATE POLICY "Delete roles in org" ON public.roles
  FOR DELETE USING (organization_id = private.current_manager_org_id());

DROP POLICY IF EXISTS "employees can read roles" ON public.roles;
CREATE POLICY "employees can read roles" ON public.roles
  FOR SELECT USING (organization_id = private.current_employee_org_id());

-- ── employees ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Select employees in org" ON public.employees;
CREATE POLICY "Select employees in org" ON public.employees
  FOR SELECT USING (organization_id = private.current_manager_org_id());

DROP POLICY IF EXISTS "Insert employees in org" ON public.employees;
CREATE POLICY "Insert employees in org" ON public.employees
  FOR INSERT WITH CHECK (organization_id = private.current_manager_org_id());

DROP POLICY IF EXISTS "Update employees in org" ON public.employees;
CREATE POLICY "Update employees in org" ON public.employees
  FOR UPDATE
  USING     (organization_id = private.current_manager_org_id())
  WITH CHECK (organization_id = private.current_manager_org_id());

DROP POLICY IF EXISTS "Delete employees in org" ON public.employees;
CREATE POLICY "Delete employees in org" ON public.employees
  FOR DELETE USING (organization_id = private.current_manager_org_id());

DROP POLICY IF EXISTS "employees can view org colleagues" ON public.employees;
CREATE POLICY "employees can view org colleagues" ON public.employees
  FOR SELECT USING (organization_id = private.current_employee_org_id());

-- ── employee_roles ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Select employee_roles in org" ON public.employee_roles;
CREATE POLICY "Select employee_roles in org" ON public.employee_roles
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = employee_roles.employee_id
        AND e.organization_id = private.current_manager_org_id()
    )
  );

DROP POLICY IF EXISTS "Insert employee_roles in org" ON public.employee_roles;
CREATE POLICY "Insert employee_roles in org" ON public.employee_roles
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = employee_roles.employee_id
        AND e.organization_id = private.current_manager_org_id()
    )
  );

DROP POLICY IF EXISTS "Delete employee_roles in org" ON public.employee_roles;
CREATE POLICY "Delete employee_roles in org" ON public.employee_roles
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = employee_roles.employee_id
        AND e.organization_id = private.current_manager_org_id()
    )
  );

DROP POLICY IF EXISTS "employees can read employee_roles" ON public.employee_roles;
CREATE POLICY "employees can read employee_roles" ON public.employee_roles
  FOR SELECT USING (
    employee_id IN (
      SELECT id FROM public.employees
      WHERE organization_id = private.current_employee_org_id()
    )
  );

-- ── shifts ───────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Select shifts in org" ON public.shifts;
CREATE POLICY "Select shifts in org" ON public.shifts
  FOR SELECT USING (organization_id = private.current_manager_org_id());

DROP POLICY IF EXISTS "Insert shifts in org" ON public.shifts;
CREATE POLICY "Insert shifts in org" ON public.shifts
  FOR INSERT WITH CHECK (organization_id = private.current_manager_org_id());

DROP POLICY IF EXISTS "Update shifts in org" ON public.shifts;
CREATE POLICY "Update shifts in org" ON public.shifts
  FOR UPDATE
  USING     (organization_id = private.current_manager_org_id())
  WITH CHECK (organization_id = private.current_manager_org_id());

DROP POLICY IF EXISTS "Delete shifts in org" ON public.shifts;
CREATE POLICY "Delete shifts in org" ON public.shifts
  FOR DELETE USING (organization_id = private.current_manager_org_id());

DROP POLICY IF EXISTS "employees can read published shifts" ON public.shifts;
CREATE POLICY "employees can read published shifts" ON public.shifts
  FOR SELECT USING (
    organization_id = private.current_employee_org_id()
    AND schedule_id IN (
      SELECT id FROM public.schedules
      WHERE organization_id = private.current_employee_org_id()
        AND status = 'published'
    )
  );

-- ── schedules ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Select schedules in org" ON public.schedules;
CREATE POLICY "Select schedules in org" ON public.schedules
  FOR SELECT USING (organization_id = private.current_manager_org_id());

DROP POLICY IF EXISTS "Insert schedules in org" ON public.schedules;
CREATE POLICY "Insert schedules in org" ON public.schedules
  FOR INSERT WITH CHECK (organization_id = private.current_manager_org_id());

DROP POLICY IF EXISTS "Update schedules in org" ON public.schedules;
CREATE POLICY "Update schedules in org" ON public.schedules
  FOR UPDATE
  USING     (organization_id = private.current_manager_org_id())
  WITH CHECK (organization_id = private.current_manager_org_id());

DROP POLICY IF EXISTS "Delete schedules in org" ON public.schedules;
CREATE POLICY "Delete schedules in org" ON public.schedules
  FOR DELETE USING (organization_id = private.current_manager_org_id());

DROP POLICY IF EXISTS "employees can read published schedules" ON public.schedules;
CREATE POLICY "employees can read published schedules" ON public.schedules
  FOR SELECT USING (
    organization_id = private.current_employee_org_id()
    AND status = 'published'
  );

-- ── employee_availability ────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Select availability in org" ON public.employee_availability;
CREATE POLICY "Select availability in org" ON public.employee_availability
  FOR SELECT USING (organization_id = private.current_manager_org_id());

DROP POLICY IF EXISTS "Insert availability in org" ON public.employee_availability;
CREATE POLICY "Insert availability in org" ON public.employee_availability
  FOR INSERT WITH CHECK (organization_id = private.current_manager_org_id());

DROP POLICY IF EXISTS "Update availability in org" ON public.employee_availability;
CREATE POLICY "Update availability in org" ON public.employee_availability
  FOR UPDATE
  USING     (organization_id = private.current_manager_org_id())
  WITH CHECK (organization_id = private.current_manager_org_id());

DROP POLICY IF EXISTS "Delete availability in org" ON public.employee_availability;
CREATE POLICY "Delete availability in org" ON public.employee_availability
  FOR DELETE USING (organization_id = private.current_manager_org_id());

-- ── employee_unavailability ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "Select unavailability in org" ON public.employee_unavailability;
CREATE POLICY "Select unavailability in org" ON public.employee_unavailability
  FOR SELECT USING (organization_id = private.current_manager_org_id());

DROP POLICY IF EXISTS "Insert unavailability in org" ON public.employee_unavailability;
CREATE POLICY "Insert unavailability in org" ON public.employee_unavailability
  FOR INSERT WITH CHECK (organization_id = private.current_manager_org_id());

DROP POLICY IF EXISTS "Update unavailability in org" ON public.employee_unavailability;
CREATE POLICY "Update unavailability in org" ON public.employee_unavailability
  FOR UPDATE
  USING     (organization_id = private.current_manager_org_id())
  WITH CHECK (organization_id = private.current_manager_org_id());

DROP POLICY IF EXISTS "Delete unavailability in org" ON public.employee_unavailability;
CREATE POLICY "Delete unavailability in org" ON public.employee_unavailability
  FOR DELETE USING (organization_id = private.current_manager_org_id());

-- ── coverage_requirements ────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Managers can view coverage requirements for their organization"
  ON public.coverage_requirements;
CREATE POLICY "Managers can view coverage requirements for their organization"
  ON public.coverage_requirements FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.locations
      WHERE locations.id = coverage_requirements.location_id
        AND locations.organization_id = private.current_manager_org_id()
    )
  );

DROP POLICY IF EXISTS "Managers can insert coverage requirements for their organization"
  ON public.coverage_requirements;
CREATE POLICY "Managers can insert coverage requirements for their organization"
  ON public.coverage_requirements FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.locations
      WHERE locations.id = coverage_requirements.location_id
        AND locations.organization_id = private.current_manager_org_id()
    )
  );

DROP POLICY IF EXISTS "Managers can update coverage requirements for their organization"
  ON public.coverage_requirements;
CREATE POLICY "Managers can update coverage requirements for their organization"
  ON public.coverage_requirements FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.locations
      WHERE locations.id = coverage_requirements.location_id
        AND locations.organization_id = private.current_manager_org_id()
    )
  );

DROP POLICY IF EXISTS "Managers can delete coverage requirements for their organization"
  ON public.coverage_requirements;
CREATE POLICY "Managers can delete coverage requirements for their organization"
  ON public.coverage_requirements FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.locations
      WHERE locations.id = coverage_requirements.location_id
        AND locations.organization_id = private.current_manager_org_id()
    )
  );

-- ── time_off_requests ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "managers can manage time_off_requests" ON public.time_off_requests;
CREATE POLICY "managers can manage time_off_requests" ON public.time_off_requests
  FOR ALL
  USING     (organization_id = private.current_manager_org_id())
  WITH CHECK (organization_id = private.current_manager_org_id());

DROP POLICY IF EXISTS "employees can select own time_off_requests" ON public.time_off_requests;
CREATE POLICY "employees can select own time_off_requests" ON public.time_off_requests
  FOR SELECT USING (employee_id = private.current_employee_id());

DROP POLICY IF EXISTS "employees can insert own time_off_requests" ON public.time_off_requests;
CREATE POLICY "employees can insert own time_off_requests" ON public.time_off_requests
  FOR INSERT WITH CHECK (
    employee_id     = private.current_employee_id()
    AND organization_id = private.current_employee_org_id()
  );

DROP POLICY IF EXISTS "employees can delete own pending time_off_requests" ON public.time_off_requests;
CREATE POLICY "employees can delete own pending time_off_requests" ON public.time_off_requests
  FOR DELETE USING (
    employee_id = private.current_employee_id()
    AND status = 'pending'
  );

-- ── shift_trade_requests ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS "managers can manage shift_trade_requests" ON public.shift_trade_requests;
CREATE POLICY "managers can manage shift_trade_requests" ON public.shift_trade_requests
  FOR ALL
  USING     (organization_id = private.current_manager_org_id())
  WITH CHECK (organization_id = private.current_manager_org_id());

DROP POLICY IF EXISTS "employees can select own shift_trade_requests" ON public.shift_trade_requests;
CREATE POLICY "employees can select own shift_trade_requests" ON public.shift_trade_requests
  FOR SELECT USING (
    requesting_employee_id = private.current_employee_id()
    OR target_employee_id  = private.current_employee_id()
  );

DROP POLICY IF EXISTS "employees can insert shift_trade_requests" ON public.shift_trade_requests;
CREATE POLICY "employees can insert shift_trade_requests" ON public.shift_trade_requests
  FOR INSERT WITH CHECK (
    requesting_employee_id = private.current_employee_id()
    AND organization_id    = private.current_employee_org_id()
    AND (
      requesting_shift_id IS NULL
      OR (SELECT employee_id FROM public.shifts WHERE id = requesting_shift_id)
           = private.current_employee_id()
    )
  );

DROP POLICY IF EXISTS "employees can delete own pending shift_trade_requests" ON public.shift_trade_requests;
CREATE POLICY "employees can delete own pending shift_trade_requests" ON public.shift_trade_requests
  FOR DELETE USING (
    requesting_employee_id = private.current_employee_id()
    AND status = 'pending'
  );

-- Required so respond_to_shift_trade (now SECURITY INVOKER) can UPDATE via RLS.
DROP POLICY IF EXISTS "employees can respond to targeted shift_trade_requests" ON public.shift_trade_requests;
CREATE POLICY "employees can respond to targeted shift_trade_requests" ON public.shift_trade_requests
  FOR UPDATE
  USING     (target_employee_id = private.current_employee_id() AND status = 'pending')
  WITH CHECK (target_employee_id = private.current_employee_id());

-- ═════════════════════════════════════════════════════════════════════════════
-- 4. Update employee_public_profiles view
-- ═════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW public.employee_public_profiles
  WITH (security_invoker = true)
AS
  SELECT id, organization_id, name, home_location_id, is_floating, is_active
  FROM public.employees
  WHERE organization_id = private.current_employee_org_id()
     OR organization_id = private.current_manager_org_id();

GRANT SELECT ON public.employee_public_profiles TO authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- 5. Drop the old public-schema helper functions
--    (policies and view above now reference private.xxx instead)
-- ═════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.current_manager_org_id();
DROP FUNCTION IF EXISTS public.current_employee_id();
DROP FUNCTION IF EXISTS public.current_employee_org_id();

-- ═════════════════════════════════════════════════════════════════════════════
-- 6. Action RPCs: switch to SECURITY INVOKER
--    Eliminates authenticated_security_definer_function_executable warnings.
--    Internal authorization checks are preserved; RLS enforces table access.
-- ═════════════════════════════════════════════════════════════════════════════

-- respond_to_shift_trade: target employee accepts or declines a pending trade
CREATE OR REPLACE FUNCTION public.respond_to_shift_trade(
  p_request_id uuid,
  p_response   text  -- 'accepted' or 'declined'
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  _req shift_trade_requests;
BEGIN
  IF p_response NOT IN ('accepted', 'declined') THEN
    RAISE EXCEPTION 'response must be ''accepted'' or ''declined''';
  END IF;

  SELECT * INTO _req FROM shift_trade_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'request not found';
  END IF;

  IF _req.target_employee_id != private.current_employee_id() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  IF _req.status != 'pending' THEN
    RAISE EXCEPTION 'request is no longer pending';
  END IF;

  UPDATE shift_trade_requests
    SET status = p_response, updated_at = now()
    WHERE id = p_request_id;
END;
$$;

-- approve_reject_time_off: manager approves or denies a time-off request
CREATE OR REPLACE FUNCTION public.approve_reject_time_off(
  p_request_id uuid,
  p_decision   text,  -- 'approved' or 'denied'
  p_note       text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  _req time_off_requests;
  _tz  text;
BEGIN
  IF p_decision NOT IN ('approved', 'denied') THEN
    RAISE EXCEPTION 'decision must be ''approved'' or ''denied''';
  END IF;

  SELECT * INTO _req FROM time_off_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'request not found';
  END IF;

  IF _req.organization_id != private.current_manager_org_id() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  IF _req.status != 'pending' THEN
    RAISE EXCEPTION 'request is no longer pending';
  END IF;

  UPDATE time_off_requests
    SET status = p_decision, manager_note = p_note, updated_at = now()
    WHERE id = p_request_id;

  IF p_decision = 'approved' THEN
    SELECT COALESCE(settings->>'timezone', 'UTC')
      INTO _tz
      FROM organizations
      WHERE id = _req.organization_id;

    INSERT INTO employee_unavailability (
      organization_id, employee_id, start_datetime, end_datetime
    ) VALUES (
      _req.organization_id,
      _req.employee_id,
      (_req.start_date::text || ' 00:00:00')::timestamptz AT TIME ZONE COALESCE(_tz, 'UTC'),
      (_req.end_date::text   || ' 23:59:59')::timestamptz AT TIME ZONE COALESCE(_tz, 'UTC')
    );
  END IF;
END;
$$;

-- approve_reject_shift_trade: manager approves or denies an accepted shift trade
CREATE OR REPLACE FUNCTION public.approve_reject_shift_trade(
  p_request_id uuid,
  p_decision   text,  -- 'approved' or 'denied'
  p_note       text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  _req           shift_trade_requests;
  _req_shift_emp uuid;
  _tgt_shift_emp uuid;
BEGIN
  IF p_decision NOT IN ('approved', 'denied') THEN
    RAISE EXCEPTION 'decision must be ''approved'' or ''denied''';
  END IF;

  SELECT * INTO _req FROM shift_trade_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'request not found';
  END IF;

  IF _req.organization_id != private.current_manager_org_id() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  IF _req.status != 'accepted' THEN
    RAISE EXCEPTION 'request must be accepted by the target employee before manager approval';
  END IF;

  IF p_decision = 'approved' THEN
    IF _req.requesting_shift_id IS NULL THEN
      RAISE EXCEPTION 'requesting shift no longer exists';
    END IF;

    SELECT employee_id INTO _req_shift_emp
      FROM shifts WHERE id = _req.requesting_shift_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'requesting shift no longer exists';
    END IF;
    IF _req_shift_emp IS DISTINCT FROM _req.requesting_employee_id THEN
      RAISE EXCEPTION 'requesting shift no longer belongs to the requesting employee';
    END IF;

    IF _req.target_shift_id IS NOT NULL THEN
      SELECT employee_id INTO _tgt_shift_emp
        FROM shifts WHERE id = _req.target_shift_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'target shift no longer exists';
      END IF;
      IF _tgt_shift_emp IS DISTINCT FROM _req.target_employee_id THEN
        RAISE EXCEPTION 'target shift no longer belongs to the target employee';
      END IF;

      UPDATE shifts SET employee_id = _req.target_employee_id
        WHERE id = _req.requesting_shift_id;
      UPDATE shifts SET employee_id = _req.requesting_employee_id
        WHERE id = _req.target_shift_id;
    ELSE
      UPDATE shifts SET employee_id = _req.target_employee_id
        WHERE id = _req.requesting_shift_id;
    END IF;
  END IF;

  UPDATE shift_trade_requests
    SET status = p_decision, manager_note = p_note, updated_at = now()
    WHERE id = p_request_id;
END;
$$;

-- create_org_and_manager: onboarding RPC, runs as the calling authenticated user
CREATE OR REPLACE FUNCTION public.create_org_and_manager(org_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING errcode = '42501';
  END IF;

  INSERT INTO public.organizations (name)
    VALUES (org_name)
    RETURNING id INTO v_org_id;

  INSERT INTO public.managers (id, organization_id, email)
    VALUES (auth.uid(), v_org_id, COALESCE(auth.jwt() ->> 'email', ''))
    ON CONFLICT (id) DO UPDATE
      SET organization_id = EXCLUDED.organization_id,
          email           = EXCLUDED.email;

  RETURN v_org_id;
END;
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 7. Lock down EXECUTE grants on all public-facing functions
-- ═════════════════════════════════════════════════════════════════════════════

-- Action RPCs: revoke default PUBLIC grant, allow only authenticated users
REVOKE EXECUTE ON FUNCTION public.respond_to_shift_trade(uuid, text)      FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.approve_reject_time_off(uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.approve_reject_shift_trade(uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_org_and_manager(text)             FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.respond_to_shift_trade(uuid, text)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_reject_time_off(uuid, text, text)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_reject_shift_trade(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_org_and_manager(text)               TO authenticated;

-- Trigger functions: revoke from all roles — PostgreSQL trigger machinery
-- doesn't require user-level EXECUTE; direct calls by users are never valid.
REVOKE EXECUTE ON FUNCTION public.handle_employee_invitation()                    FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_employee_invitation()                    FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.prevent_location_delete_with_future_shifts()    FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.prevent_location_delete_with_future_shifts()    FROM authenticated;

COMMIT;
