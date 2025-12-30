-- Add shifts table to support future-shift deletion guard
create table if not exists public.shifts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  location_id uuid not null references public.locations (id) on delete cascade,
  start_datetime timestamptz not null,
  end_datetime timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists shifts_organization_id_idx on public.shifts (organization_id);
create index if not exists shifts_location_id_idx on public.shifts (location_id);
create index if not exists shifts_start_datetime_idx on public.shifts (start_datetime);

alter table public.shifts enable row level security;

drop policy if exists "Select shifts in org" on public.shifts;
create policy "Select shifts in org" on public.shifts
  for select using (organization_id = current_manager_org_id());

drop policy if exists "Insert shifts in org" on public.shifts;
create policy "Insert shifts in org" on public.shifts
  for insert with check (organization_id = current_manager_org_id());

drop policy if exists "Update shifts in org" on public.shifts;
create policy "Update shifts in org" on public.shifts
  for update using (organization_id = current_manager_org_id())
  with check (organization_id = current_manager_org_id());

drop policy if exists "Delete shifts in org" on public.shifts;
create policy "Delete shifts in org" on public.shifts
  for delete using (organization_id = current_manager_org_id());

grant select, insert, update, delete on public.shifts to authenticated;

-- Prevent deleting locations that still have future-dated shifts
create or replace function public.prevent_location_delete_with_future_shifts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.shifts s
    where s.location_id = old.id
      and s.start_datetime >= now()
  ) then
    raise exception 'Cannot delete location with future shifts' using errcode = 'P0001';
  end if;
  return old;
end;
$$;

drop trigger if exists trg_prevent_location_delete on public.locations;
create trigger trg_prevent_location_delete
before delete on public.locations
for each row
execute function public.prevent_location_delete_with_future_shifts();

-- Keep delete policy scoped to the manager's org
drop policy if exists "Delete locations in org" on public.locations;
create policy "Delete locations in org" on public.locations
  for delete using (organization_id = current_manager_org_id());
