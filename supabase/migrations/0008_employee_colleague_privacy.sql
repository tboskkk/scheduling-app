-- 0008_employee_colleague_privacy.sql
-- Employees can no longer read colleagues' pay and contact details.
-- Apply in the Supabase dashboard SQL editor. Runs as a single transaction and
-- is safe to run more than once (drop if exists / or replace).
--
-- The leak: policy "employees can view org colleagues" on public.employees
-- (0002, rebuilt in 0004) let any employee SELECT every colleague's full row,
-- including hourly_rate, email and phone. employee_public_profiles was
-- security_invoker, so it relied on that same policy for its rows.
--
-- Changes:
--   1. private.employee_public_profiles(): SECURITY DEFINER function that returns
--      the public columns (no hourly_rate, email or phone) for the caller's org
--   2. Rebuild public.employee_public_profiles on top of it (same columns), so
--      it no longer depends on the employees RLS; SELECT for authenticated only
--   3. Drop the "employees can view org colleagues" policy. Employees keep
--      "employees can read own employee record" (0002: user_id = auth.uid()),
--      re-created here unchanged so the own-row read cannot go missing.
--      Manager policies are unchanged.
--
-- Side effect: "employees can read employee_roles" (0004) filters through
-- public.employees, so employees now see only their own role assignments.
-- The employee portal only reads its own (App.tsx).
--
-- App change in the same commit: ShiftTradeRequestsPage reads colleague names
-- from employee_public_profiles instead of embedding employees.

BEGIN;

-- =============================================================================
-- 1. private.employee_public_profiles()
--
--    SECURITY DEFINER (owned by postgres, the owner of public.employees) so it
--    reads past the employees RLS. The org filter below is the only row filter:
--    the caller's employee org, or the caller's manager org. anon has no org,
--    and has no EXECUTE anyway.
--    The private schema is not exposed through the REST API.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.employee_public_profiles()
RETURNS TABLE (
  id               uuid,
  organization_id  uuid,
  name             text,
  home_location_id uuid,
  is_floating      boolean,
  is_active        boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.id, e.organization_id, e.name, e.home_location_id, e.is_floating, e.is_active
  FROM public.employees e
  WHERE e.organization_id = private.current_employee_org_id()
     OR e.organization_id = private.current_manager_org_id();
$$;

REVOKE EXECUTE ON FUNCTION private.employee_public_profiles() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION private.employee_public_profiles() TO authenticated, service_role;

-- =============================================================================
-- 2. public.employee_public_profiles
--
--    Same name and columns as before, so every app query keeps working.
--    security_invoker stays on: the view only calls the function above, and
--    the caller needs EXECUTE on it (authenticated only).
-- =============================================================================

CREATE OR REPLACE VIEW public.employee_public_profiles
  WITH (security_invoker = true)
AS
  SELECT id, organization_id, name, home_location_id, is_floating, is_active
  FROM private.employee_public_profiles();

REVOKE ALL ON public.employee_public_profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.employee_public_profiles TO authenticated;

-- =============================================================================
-- 3. Employees: own row only
-- =============================================================================

DROP POLICY IF EXISTS "employees can view org colleagues" ON public.employees;

DROP POLICY IF EXISTS "employees can read own employee record" ON public.employees;
CREATE POLICY "employees can read own employee record" ON public.employees
  FOR SELECT USING (user_id = auth.uid());

COMMIT;
