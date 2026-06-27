-- Sprint 2: Past-date guard for time-off requests
-- Apply in the Supabase dashboard SQL editor.
-- Safe to run multiple times (IF NOT EXISTS guard).

BEGIN;

-- Prevent employees from submitting time-off requests with a start_date in the past.
-- The HTML `min` attribute already blocks this in the browser; this adds DB-level defence.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tor_start_date_not_past'
      AND conrelid = 'public.time_off_requests'::regclass
  ) THEN
    ALTER TABLE public.time_off_requests
      ADD CONSTRAINT tor_start_date_not_past
      CHECK (start_date >= CURRENT_DATE);
  END IF;
END
$$;

COMMIT;
