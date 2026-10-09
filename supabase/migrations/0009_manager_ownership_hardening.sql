-- 0009_manager_ownership_hardening.sql
-- Managers can only join organizations they created; shift trades stay
-- inside the requester's organization.
-- Apply in the Supabase dashboard SQL editor. Runs as a single transaction and
-- is safe to run more than once (if not exists / drop if exists / or replace).
--
-- The holes:
--   a. "Insert own manager record" (0001) only checked id = auth.uid(), so any
--      signed-in user without a managers row could insert one for ANY
--      organization id and become a manager of someone else's business.
--   b. "Update own manager record" (0001) let a manager rewrite
--      organization_id on their own row and move into any organization.
--   c. create_org_and_manager (SECURITY INVOKER since 0004) ended with
--      ON CONFLICT (id) DO UPDATE SET organization_id, so an existing manager
--      calling it again was silently moved. It also used INSERT ... RETURNING
--      on organizations, which fails the "Select own org" policy for a new
--      user (no managers row yet), so onboarding was broken.
--   d. "employees can insert shift_trade_requests" (0004) never checked that
--      target_employee_id or target_shift_id are in the requester's
--      organization, and "employees can respond to targeted
--      shift_trade_requests" (0004) let the target employee rewrite any column,
--      including organization_id and status = 'approved'.
--
-- Changes:
--   1. organizations.created_by (default auth.uid()), backfilled from the
--      oldest managers row of each org; a trigger pins it for API roles
--   2. private helpers (SECURITY DEFINER, not exposed through the REST API)
--   3. organizations "Insert org": created_by must be the caller
--   4. managers: insert only into an org the caller created; update only the
--      email column of the caller's own row (policy + column privilege)
--   5. create_org_and_manager: refuses callers that already manage an org,
--      no RETURNING on organizations, no ON CONFLICT
--   6. shift_trade_requests: employee insert and respond policies check that
--      every employee and shift on the request is in the requester's org
--
-- Unchanged: service_role and postgres (private.reset_demo) bypass RLS; the
-- demo org keeps whatever created_by the backfill gives it and reset_demo
-- never writes the column.

BEGIN;

-- =============================================================================
-- 1. organizations.created_by
--
--    Nullable: legacy orgs with no manager keep NULL, and NULL never equals
--    auth.uid(), so nobody can join them.
-- =============================================================================

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS created_by uuid DEFAULT auth.uid();

-- Backfill from the oldest managers row of each org (ties broken by id).
UPDATE public.organizations o
SET created_by = m.id
FROM (
  SELECT DISTINCT ON (organization_id) organization_id, id
  FROM public.managers
  ORDER BY organization_id, created_at, id
) m
WHERE o.id = m.organization_id
  AND o.created_by IS NULL;

CREATE SCHEMA IF NOT EXISTS private;

-- For the API roles (anon, authenticated) created_by is always the caller on
-- INSERT and can never change on UPDATE. Other roles (postgres, service_role,
-- SECURITY DEFINER functions such as private.reset_demo) are left alone.
-- SECURITY INVOKER on purpose: current_user must be the calling role.
CREATE OR REPLACE FUNCTION private.organizations_pin_created_by()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.created_by := auth.uid();
    ELSIF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
      RAISE EXCEPTION 'organizations.created_by cannot be changed'
        USING errcode = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Trigger machinery does not need EXECUTE; nobody should call it directly.
REVOKE EXECUTE ON FUNCTION private.organizations_pin_created_by() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_organizations_pin_created_by ON public.organizations;
CREATE TRIGGER trg_organizations_pin_created_by
  BEFORE INSERT OR UPDATE ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION private.organizations_pin_created_by();

-- =============================================================================
-- 2. Private helpers
--
--    SECURITY DEFINER (owned by postgres) so policy checks can read past the
--    RLS on organizations, employees and shifts. They return only a uuid or a
--    boolean about the ids they are given. The private schema is not exposed
--    through the REST API; anon has no EXECUTE.
-- =============================================================================

-- Who created an organization (NULL for legacy orgs and the demo org seed).
CREATE OR REPLACE FUNCTION private.org_created_by(p_org uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT created_by FROM public.organizations WHERE id = p_org;
$$;

-- True when the employee exists and belongs to the organization.
CREATE OR REPLACE FUNCTION private.employee_in_org(p_employee uuid, p_org uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.employees
    WHERE id = p_employee
      AND organization_id = p_org
  );
$$;

-- True when the shift exists and belongs to the organization, and (when
-- p_employee is not NULL) is assigned to that employee.
CREATE OR REPLACE FUNCTION private.shift_in_org(p_shift uuid, p_org uuid, p_employee uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.shifts
    WHERE id = p_shift
      AND organization_id = p_org
      AND (p_employee IS NULL OR employee_id = p_employee)
  );
$$;

REVOKE EXECUTE ON FUNCTION private.org_created_by(uuid)             FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION private.employee_in_org(uuid, uuid)      FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION private.shift_in_org(uuid, uuid, uuid)   FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION private.org_created_by(uuid)              TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.employee_in_org(uuid, uuid)       TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.shift_in_org(uuid, uuid, uuid)    TO authenticated, service_role;

-- =============================================================================
-- 3. organizations: "Insert org"
--
--    Still needed: create_org_and_manager is SECURITY INVOKER. The trigger
--    above already sets created_by; the check makes the rule visible here too.
-- =============================================================================

DROP POLICY IF EXISTS "Insert org" ON public.organizations;
CREATE POLICY "Insert org" ON public.organizations
  FOR INSERT
  TO authenticated
  WITH CHECK (created_by = auth.uid());

-- =============================================================================
-- 4. managers
-- =============================================================================

-- A user may create their own managers row only for an org they created.
DROP POLICY IF EXISTS "Insert own manager record" ON public.managers;
CREATE POLICY "Insert own manager record" ON public.managers
  FOR INSERT
  WITH CHECK (
    id = auth.uid()
    AND private.org_created_by(organization_id) = auth.uid()
  );

-- A manager may update only their own row and may not move it to another org.
-- private.current_manager_org_id() reads the row as it was before the
-- statement, so a new organization_id never matches it.
DROP POLICY IF EXISTS "Update own manager record" ON public.managers;
CREATE POLICY "Update own manager record" ON public.managers
  FOR UPDATE
  USING      (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    AND organization_id = private.current_manager_org_id()
  );

-- Belt and braces: the API roles may only UPDATE the email column.
-- (The app never updates managers; private.reset_demo runs as postgres.)
REVOKE UPDATE ON public.managers FROM anon, authenticated;
GRANT UPDATE (email) ON public.managers TO authenticated;

-- =============================================================================
-- 5. create_org_and_manager: onboarding RPC, still SECURITY INVOKER
--
--    The org id is generated here so the INSERT needs no RETURNING (the new
--    org is not visible through "Select own org" until the managers row
--    exists). A caller who already manages an org gets an error instead of
--    being moved.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.create_org_and_manager(org_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid := gen_random_uuid();
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING errcode = '42501';
  END IF;

  IF EXISTS (SELECT 1 FROM public.managers WHERE id = auth.uid()) THEN
    RAISE EXCEPTION 'This account already manages an organization'
      USING errcode = '23505';
  END IF;

  INSERT INTO public.organizations (id, name)
    VALUES (v_org_id, org_name);

  INSERT INTO public.managers (id, organization_id, email)
    VALUES (auth.uid(), v_org_id, COALESCE(auth.jwt() ->> 'email', ''));

  RETURN v_org_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_org_and_manager(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.create_org_and_manager(text) TO authenticated;

-- =============================================================================
-- 6. shift_trade_requests: employee policies stay inside the org
-- =============================================================================

-- Insert: the requester is the caller, the org is the caller's org, the
-- target employee is in that org, and each shift given is in that org and
-- assigned to its side of the trade.
DROP POLICY IF EXISTS "employees can insert shift_trade_requests" ON public.shift_trade_requests;
CREATE POLICY "employees can insert shift_trade_requests" ON public.shift_trade_requests
  FOR INSERT WITH CHECK (
    requesting_employee_id = private.current_employee_id()
    AND organization_id    = private.current_employee_org_id()
    AND private.employee_in_org(target_employee_id, organization_id)
    AND (
      requesting_shift_id IS NULL
      OR private.shift_in_org(requesting_shift_id, organization_id, requesting_employee_id)
    )
    AND (
      target_shift_id IS NULL
      OR private.shift_in_org(target_shift_id, organization_id, target_employee_id)
    )
  );

-- Respond (used by respond_to_shift_trade, SECURITY INVOKER): the target may
-- only set accepted / declined, and the row must stay in the caller's org
-- with in-org employees and shifts. Shift ownership is not re-checked here,
-- so a stale request can still be declined; approve_reject_shift_trade
-- re-checks ownership before swapping.
DROP POLICY IF EXISTS "employees can respond to targeted shift_trade_requests" ON public.shift_trade_requests;
CREATE POLICY "employees can respond to targeted shift_trade_requests" ON public.shift_trade_requests
  FOR UPDATE
  USING (
    target_employee_id = private.current_employee_id()
    AND status = 'pending'
  )
  WITH CHECK (
    target_employee_id = private.current_employee_id()
    AND organization_id = private.current_employee_org_id()
    AND status IN ('accepted', 'declined')
    AND private.employee_in_org(requesting_employee_id, organization_id)
    AND (requesting_shift_id IS NULL OR private.shift_in_org(requesting_shift_id, organization_id, NULL))
    AND (target_shift_id     IS NULL OR private.shift_in_org(target_shift_id,     organization_id, NULL))
  );

COMMIT;
