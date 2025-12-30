-- Employee availability and unavailability tables
create table if not exists public.employee_availability (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete cascade,
  day_of_week integer not null check (day_of_week >= 0 and day_of_week <= 6),
  start_time time not null,
  end_time time not null,
  created_at timestamptz not null default now(),
  constraint employee_availability_time_order check (end_time > start_time)
);

create index if not exists employee_availability_org_idx on public.employee_availability (organization_id);
create index if not exists employee_availability_employee_idx on public.employee_availability (employee_id);
create index if not exists employee_availability_day_idx on public.employee_availability (day_of_week);

create table if not exists public.employee_unavailability (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete cascade,
  start_datetime timestamptz not null,
  end_datetime timestamptz not null,
  created_at timestamptz not null default now(),
  constraint employee_unavailability_time_order check (end_datetime > start_datetime)
);

create index if not exists employee_unavailability_org_idx on public.employee_unavailability (organization_id);
create index if not exists employee_unavailability_employee_idx on public.employee_unavailability (employee_id);
create index if not exists employee_unavailability_start_idx on public.employee_unavailability (start_datetime);

alter table public.employee_availability enable row level security;
alter table public.employee_unavailability enable row level security;

create policy "Select availability in org" on public.employee_availability
  for select using (organization_id = current_manager_org_id());

create policy "Insert availability in org" on public.employee_availability
  for insert with check (organization_id = current_manager_org_id());

create policy "Update availability in org" on public.employee_availability
  for update using (organization_id = current_manager_org_id())
  with check (organization_id = current_manager_org_id());

create policy "Delete availability in org" on public.employee_availability
  for delete using (organization_id = current_manager_org_id());

create policy "Select unavailability in org" on public.employee_unavailability
  for select using (organization_id = current_manager_org_id());

create policy "Insert unavailability in org" on public.employee_unavailability
  for insert with check (organization_id = current_manager_org_id());

create policy "Update unavailability in org" on public.employee_unavailability
  for update using (organization_id = current_manager_org_id())
  with check (organization_id = current_manager_org_id());

create policy "Delete unavailability in org" on public.employee_unavailability
  for delete using (organization_id = current_manager_org_id());

grant select, insert, update, delete on public.employee_availability to authenticated;
grant select, insert, update, delete on public.employee_unavailability to authenticated;
