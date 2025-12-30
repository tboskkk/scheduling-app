
-- Create schedules table
create table if not exists public.schedules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  location_id uuid not null references public.locations (id) on delete cascade,
  week_start_date date not null,
  status text not null default 'draft' check (status in ('draft', 'published')),
  published_at timestamptz,
  published_by uuid references auth.users (id),
  version integer not null default 1,
  snapshot jsonb,
  created_at timestamptz not null default now(),
  unique (location_id, week_start_date, version)
);

create index if not exists schedules_organization_id_idx on public.schedules (organization_id);
create index if not exists schedules_location_id_idx on public.schedules (location_id);
create index if not exists schedules_week_start_date_idx on public.schedules (week_start_date);

-- Add schedule_id to shifts
alter table public.shifts
add column if not exists schedule_id uuid references public.schedules (id) on delete cascade;

create index if not exists shifts_schedule_id_idx on public.shifts (schedule_id);

-- RLS for schedules
alter table public.schedules enable row level security;

drop policy if exists "Select schedules in org" on public.schedules;
create policy "Select schedules in org" on public.schedules
  for select using (organization_id = current_manager_org_id());

drop policy if exists "Insert schedules in org" on public.schedules;
create policy "Insert schedules in org" on public.schedules
  for insert with check (organization_id = current_manager_org_id());

drop policy if exists "Update schedules in org" on public.schedules;
create policy "Update schedules in org" on public.schedules
  for update using (organization_id = current_manager_org_id())
  with check (organization_id = current_manager_org_id());

drop policy if exists "Delete schedules in org" on public.schedules;
create policy "Delete schedules in org" on public.schedules
  for delete using (organization_id = current_manager_org_id());

grant select, insert, update, delete on public.schedules to authenticated;
