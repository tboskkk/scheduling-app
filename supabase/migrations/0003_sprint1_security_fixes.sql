-- Sprint 1 Security & Data Integrity Fixes
-- Apply this in the Supabase dashboard: https://supabase.com/dashboard/project/hnbylxktshvqyhyxpmrg/sql
-- Run as a single transaction — if anything fails the whole block rolls back.

BEGIN;

-- ─── 1. Fix org INSERT policy scope (TO public → TO authenticated) ───────────
-- Prevents the anonymous role from ever reaching the INSERT policy.
DROP POLICY IF EXISTS "Insert org" ON public.organizations;
CREATE POLICY "Insert org" ON public.organizations
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.role() IN ('authenticated', 'service_role'));

-- ─── 2. Add missing GRANT for coverage_requirements ──────────────────────────
-- This table had RLS policies but no GRANT, so every query failed silently
-- with "permission denied", breaking the entire Coverage Rules feature.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.coverage_requirements TO authenticated;

-- ─── 3. Fix schedules unique constraint ──────────────────────────────────────
-- The old constraint included `version`, so publishing the same week twice
-- created multiple rows. Any query using .single() would then crash.
-- New constraint: one schedule row per location per week (version still tracked).
ALTER TABLE public.schedules
  DROP CONSTRAINT IF EXISTS schedules_location_id_week_start_date_version_key;
ALTER TABLE public.schedules
  DROP CONSTRAINT IF EXISTS schedules_location_id_week_start_date_key;
ALTER TABLE public.schedules
  ADD CONSTRAINT schedules_location_id_week_start_date_key
  UNIQUE (location_id, week_start_date);

-- ─── 4. Add employee org-colleague viewing policy ────────────────────────────
-- Employees had no policy to see colleagues — shift trades require seeing
-- other employees in the same org. This policy is scoped to same-org only.
DROP POLICY IF EXISTS "employees can view org colleagues" ON public.employees;
CREATE POLICY "employees can view org colleagues"
  ON public.employees
  FOR SELECT
  USING (organization_id = current_employee_org_id());

-- ─── 5. Fix employee_public_profiles view — add org filter ───────────────────
-- Defense-in-depth: the view now explicitly scopes to the caller's org,
-- regardless of which RLS policies are active on the underlying table.
CREATE OR REPLACE VIEW public.employee_public_profiles
  WITH (security_invoker = true)
AS
  SELECT id, organization_id, name, home_location_id, is_floating, is_active
  FROM public.employees
  WHERE organization_id = current_employee_org_id()
     OR organization_id = current_manager_org_id();

GRANT SELECT ON public.employee_public_profiles TO authenticated;

-- ─── 6. Fix shift trade INSERT — add requesting_shift_id ownership check ─────
-- Previously an employee could initiate a trade using any shift UUID they knew,
-- even if it belonged to someone else. This closes that auth bypass.
DROP POLICY IF EXISTS "employees can insert shift_trade_requests" ON public.shift_trade_requests;
CREATE POLICY "employees can insert shift_trade_requests"
  ON public.shift_trade_requests
  FOR INSERT
  WITH CHECK (
    requesting_employee_id = current_employee_id()
    AND organization_id = current_employee_org_id()
    AND (
      requesting_shift_id IS NULL
      OR (SELECT employee_id FROM public.shifts WHERE id = requesting_shift_id) = current_employee_id()
    )
  );

-- ─── 7. Add explicit WITH CHECK to manager FOR ALL policies ──────────────────
-- PostgreSQL uses USING as WITH CHECK for FOR ALL when WITH CHECK is absent,
-- but making it explicit prevents any future ambiguity on INSERT paths.
DROP POLICY IF EXISTS "managers can manage time_off_requests" ON public.time_off_requests;
CREATE POLICY "managers can manage time_off_requests"
  ON public.time_off_requests
  FOR ALL
  USING (organization_id = current_manager_org_id())
  WITH CHECK (organization_id = current_manager_org_id());

DROP POLICY IF EXISTS "managers can manage shift_trade_requests" ON public.shift_trade_requests;
CREATE POLICY "managers can manage shift_trade_requests"
  ON public.shift_trade_requests
  FOR ALL
  USING (organization_id = current_manager_org_id())
  WITH CHECK (organization_id = current_manager_org_id());

COMMIT;
