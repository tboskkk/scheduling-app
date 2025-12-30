-- Enforce 15-minute increments and positive durations for shifts
-- 1) Drop existing constraint if present.
alter table public.shifts drop constraint if exists shifts_15_minute_granularity;

-- 2) Normalize every row to 15-minute boundaries and zero seconds (no WHERE to ensure full coverage).
update public.shifts
set
  start_datetime = date_trunc('hour', start_datetime)
    + make_interval(mins => 15 * floor(extract(minute from start_datetime) / 15)::int),
  end_datetime = date_trunc('hour', end_datetime)
    + make_interval(mins => 15 * ceil(extract(minute from end_datetime) / 15)::int);

-- 3) Ensure every shift ends after it starts (minimum duration 15 minutes after rounding).
update public.shifts
set end_datetime = start_datetime + interval '15 minutes'
where end_datetime <= start_datetime;

-- 4) Apply the check constraint.
alter table public.shifts
  add constraint shifts_15_minute_granularity
  check (
    (date_part('minute', start_datetime)::int % 15 = 0)
    and (date_part('minute', end_datetime)::int % 15 = 0)
    and (date_part('second', start_datetime)::int = 0)
    and (date_part('second', end_datetime)::int = 0)
    and end_datetime > start_datetime
  );
