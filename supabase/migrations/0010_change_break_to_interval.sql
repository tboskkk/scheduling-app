ALTER TABLE shifts
DROP COLUMN unpaid_break_minutes;

ALTER TABLE shifts
ADD COLUMN break_start_datetime TIMESTAMPTZ,
ADD COLUMN break_end_datetime TIMESTAMPTZ;
