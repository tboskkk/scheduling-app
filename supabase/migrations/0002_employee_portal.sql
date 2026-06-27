-- Employee Portal Migration
-- Adds: employee auth linking, time off requests, shift trade requests,
--        RLS policies for employee-scoped access, and RPCs for state transitions.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Link employees to auth users
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE employees
  ADD COLUMN user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL UNIQUE;

CREATE INDEX IF NOT EXISTS employees_user_id_idx ON employees(user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Helper functions for employee-scoped RLS (mirrors current_manager_org_id)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION current_employee_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM employees WHERE user_id = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION current_employee_org_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id FROM employees WHERE user_id = auth.uid() LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION current_employee_id() TO authenticated;
GRANT EXECUTE ON FUNCTION current_employee_org_id() TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Trigger: auto-link employee record when invite is accepted
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION handle_employee_invitation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _employee_id uuid;
BEGIN
  _employee_id := (NEW.raw_user_meta_data->>'employee_id')::uuid;
  IF _employee_id IS NOT NULL THEN
    UPDATE employees
      SET user_id = NEW.id
      WHERE id = _employee_id
        AND user_id IS NULL; -- only link if not already linked
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_link_invited_employee
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_employee_invitation();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. New tables: time_off_requests and shift_trade_requests
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE time_off_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id     uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  start_date      date NOT NULL,
  end_date        date NOT NULL,
  reason          text,
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','approved','denied')),
  manager_note    text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tor_date_order CHECK (end_date >= start_date)
);

CREATE TABLE shift_trade_requests (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  requesting_employee_id  uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  target_employee_id      uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  requesting_shift_id     uuid REFERENCES shifts(id) ON DELETE SET NULL,
  target_shift_id         uuid REFERENCES shifts(id) ON DELETE SET NULL,
  status                  text NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending','accepted','declined','approved','denied')),
  requester_note          text,
  manager_note            text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS tor_org_status_idx ON time_off_requests(organization_id, status);
CREATE INDEX IF NOT EXISTS tor_employee_idx ON time_off_requests(employee_id);
CREATE INDEX IF NOT EXISTS str_org_status_idx ON shift_trade_requests(organization_id, status);
CREATE INDEX IF NOT EXISTS str_requesting_employee_idx ON shift_trade_requests(requesting_employee_id);
CREATE INDEX IF NOT EXISTS str_target_employee_idx ON shift_trade_requests(target_employee_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Public view for employees (colleagues can see names but not pay/contact)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW employee_public_profiles
  WITH (security_invoker = true)
AS
  SELECT id, organization_id, name, home_location_id, is_floating, is_active
  FROM employees
  WHERE organization_id = current_employee_org_id()
     OR organization_id = current_manager_org_id();

GRANT SELECT ON employee_public_profiles TO authenticated;

-- Allow employees to see colleagues in their org (required for shift trades).
-- The view above restricts columns (no email/phone/pay); this policy restricts rows.
CREATE POLICY "employees can view org colleagues"
  ON employees
  FOR SELECT
  USING (organization_id = current_employee_org_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. RLS: enable on new tables
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE time_off_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_trade_requests ENABLE ROW LEVEL SECURITY;

-- time_off_requests: manager sees all in org; employee sees own
CREATE POLICY "managers can manage time_off_requests"
  ON time_off_requests
  FOR ALL
  USING (organization_id = current_manager_org_id())
  WITH CHECK (organization_id = current_manager_org_id());

CREATE POLICY "employees can select own time_off_requests"
  ON time_off_requests
  FOR SELECT
  USING (employee_id = current_employee_id());

CREATE POLICY "employees can insert own time_off_requests"
  ON time_off_requests
  FOR INSERT
  WITH CHECK (
    employee_id = current_employee_id()
    AND organization_id = current_employee_org_id()
  );

CREATE POLICY "employees can delete own pending time_off_requests"
  ON time_off_requests
  FOR DELETE
  USING (
    employee_id = current_employee_id()
    AND status = 'pending'
  );

-- shift_trade_requests: manager sees all in org; employee sees own (as requester or target)
CREATE POLICY "managers can manage shift_trade_requests"
  ON shift_trade_requests
  FOR ALL
  USING (organization_id = current_manager_org_id())
  WITH CHECK (organization_id = current_manager_org_id());

CREATE POLICY "employees can select own shift_trade_requests"
  ON shift_trade_requests
  FOR SELECT
  USING (
    requesting_employee_id = current_employee_id()
    OR target_employee_id = current_employee_id()
  );

CREATE POLICY "employees can insert shift_trade_requests"
  ON shift_trade_requests
  FOR INSERT
  WITH CHECK (
    requesting_employee_id = current_employee_id()
    AND organization_id = current_employee_org_id()
    AND (
      requesting_shift_id IS NULL
      OR (SELECT employee_id FROM shifts WHERE id = requesting_shift_id) = current_employee_id()
    )
  );

CREATE POLICY "employees can delete own pending shift_trade_requests"
  ON shift_trade_requests
  FOR DELETE
  USING (
    requesting_employee_id = current_employee_id()
    AND status = 'pending'
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. RLS: additive SELECT policies on existing tables for employee-role users
-- ─────────────────────────────────────────────────────────────────────────────

-- employees: only current employee can read their own full record (for profile display)
CREATE POLICY "employees can read own employee record"
  ON employees
  FOR SELECT
  USING (user_id = auth.uid());

-- schedules: employees can read published schedules in their org
CREATE POLICY "employees can read published schedules"
  ON schedules
  FOR SELECT
  USING (
    organization_id = current_employee_org_id()
    AND status = 'published'
  );

-- shifts: employees can read shifts on published schedules in their org
CREATE POLICY "employees can read published shifts"
  ON shifts
  FOR SELECT
  USING (
    organization_id = current_employee_org_id()
    AND schedule_id IN (
      SELECT id FROM schedules
      WHERE organization_id = current_employee_org_id()
        AND status = 'published'
    )
  );

-- locations: employees can read locations in their org
CREATE POLICY "employees can read locations"
  ON locations
  FOR SELECT
  USING (organization_id = current_employee_org_id());

-- roles: employees can read roles in their org
CREATE POLICY "employees can read roles"
  ON roles
  FOR SELECT
  USING (organization_id = current_employee_org_id());

-- employee_roles: employees can read role assignments in their org
CREATE POLICY "employees can read employee_roles"
  ON employee_roles
  FOR SELECT
  USING (
    employee_id IN (
      SELECT id FROM employees
      WHERE organization_id = current_employee_org_id()
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. RPCs for controlled state transitions (security definer)
-- ─────────────────────────────────────────────────────────────────────────────

-- respond_to_shift_trade: called by the TARGET employee to accept/decline
CREATE OR REPLACE FUNCTION respond_to_shift_trade(
  p_request_id uuid,
  p_response    text  -- 'accepted' or 'declined'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
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

  -- Only the target employee may respond
  IF _req.target_employee_id != current_employee_id() THEN
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

-- approve_reject_time_off: called by the manager
CREATE OR REPLACE FUNCTION approve_reject_time_off(
  p_request_id uuid,
  p_decision   text,  -- 'approved' or 'denied'
  p_note       text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _req    time_off_requests;
  _tz     text;
BEGIN
  IF p_decision NOT IN ('approved', 'denied') THEN
    RAISE EXCEPTION 'decision must be ''approved'' or ''denied''';
  END IF;

  SELECT * INTO _req FROM time_off_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'request not found';
  END IF;

  -- Only a manager of the same org may act
  IF _req.organization_id != current_manager_org_id() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  IF _req.status != 'pending' THEN
    RAISE EXCEPTION 'request is no longer pending';
  END IF;

  UPDATE time_off_requests
    SET status = p_decision, manager_note = p_note, updated_at = now()
    WHERE id = p_request_id;

  -- Auto-block availability when approved
  IF p_decision = 'approved' THEN
    -- Get org timezone from settings (default UTC)
    SELECT COALESCE(settings->>'timezone', 'UTC')
      INTO _tz
      FROM organizations
      WHERE id = _req.organization_id;

    INSERT INTO employee_unavailability (
      organization_id,
      employee_id,
      start_datetime,
      end_datetime
    ) VALUES (
      _req.organization_id,
      _req.employee_id,
      (_req.start_date::text || ' 00:00:00')::timestamptz AT TIME ZONE COALESCE(_tz, 'UTC'),
      (_req.end_date::text   || ' 23:59:59')::timestamptz AT TIME ZONE COALESCE(_tz, 'UTC')
    );
  END IF;
END;
$$;

-- approve_reject_shift_trade: called by the manager after employee acceptance
CREATE OR REPLACE FUNCTION approve_reject_shift_trade(
  p_request_id uuid,
  p_decision   text,  -- 'approved' or 'denied'
  p_note       text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _req              shift_trade_requests;
  _req_shift_emp    uuid;
  _tgt_shift_emp    uuid;
BEGIN
  IF p_decision NOT IN ('approved', 'denied') THEN
    RAISE EXCEPTION 'decision must be ''approved'' or ''denied''';
  END IF;

  SELECT * INTO _req FROM shift_trade_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'request not found';
  END IF;

  IF _req.organization_id != current_manager_org_id() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  IF _req.status != 'accepted' THEN
    RAISE EXCEPTION 'request must be accepted by the target employee before manager approval';
  END IF;

  IF p_decision = 'approved' THEN
    -- Validate requesting shift still exists and belongs to requesting employee
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
      -- True swap: validate target shift and swap both
      SELECT employee_id INTO _tgt_shift_emp
        FROM shifts WHERE id = _req.target_shift_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'target shift no longer exists';
      END IF;
      IF _tgt_shift_emp IS DISTINCT FROM _req.target_employee_id THEN
        RAISE EXCEPTION 'target shift no longer belongs to the target employee';
      END IF;

      -- Swap employee_id on both shifts
      UPDATE shifts SET employee_id = _req.target_employee_id
        WHERE id = _req.requesting_shift_id;
      UPDATE shifts SET employee_id = _req.requesting_employee_id
        WHERE id = _req.target_shift_id;
    ELSE
      -- Give-away: reassign requesting shift to target employee
      UPDATE shifts SET employee_id = _req.target_employee_id
        WHERE id = _req.requesting_shift_id;
    END IF;
  END IF;

  UPDATE shift_trade_requests
    SET status = p_decision, manager_note = p_note, updated_at = now()
    WHERE id = p_request_id;
END;
$$;

GRANT EXECUTE ON FUNCTION respond_to_shift_trade(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION approve_reject_time_off(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION approve_reject_shift_trade(uuid, text, text) TO authenticated;

-- Grant authenticated role access to new tables
GRANT SELECT, INSERT, UPDATE, DELETE ON time_off_requests TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON shift_trade_requests TO authenticated;
