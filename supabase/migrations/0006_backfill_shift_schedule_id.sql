-- Backfill schedule_id on shifts that were published before the publish flow
-- was fixed to set schedule_id.  Previously handlePublish created the schedules
-- row but never updated shifts.schedule_id, so employees could not see any shifts
-- (the employee RLS requires schedule_id IN (SELECT id FROM published schedules)).
--
-- This update links every shift whose start_datetime falls within a published
-- schedule's week to that schedule, matching on location_id and week boundary.

UPDATE public.shifts s
SET schedule_id = sch.id
FROM public.schedules sch
WHERE s.schedule_id IS NULL
  AND s.location_id = sch.location_id
  AND s.organization_id = sch.organization_id
  AND s.start_datetime >= (sch.week_start_date::timestamptz AT TIME ZONE 'UTC')
  AND s.start_datetime <  (sch.week_start_date::timestamptz AT TIME ZONE 'UTC' + INTERVAL '7 days')
  AND sch.status = 'published';
