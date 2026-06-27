-- Consolidated schema, RLS, and onboarding RPC
create extension if not exists "pgcrypto";
create extension if not exists "citext";

-- Organizations
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  settings jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Managers
create table if not exists public.managers (
  id uuid primary key references auth.users (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  email citext not null,
  created_at timestamptz not null default now(),
  constraint managers_email_unique unique (organization_id, email)
);
create index if not exists managers_organization_id_idx on public.managers (organization_id);

-- Locations
create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  address text,
  timezone text not null,
  created_at timestamptz not null default now()
);
create index if not exists locations_organization_id_idx on public.locations (organization_id);

-- Roles
create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  color text,
  created_at timestamptz not null default now(),
  constraint roles_unique_per_org unique (organization_id, name)
);
create index if not exists roles_organization_id_idx on public.roles (organization_id);

-- Employees
create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  home_location_id uuid references public.locations (id) on delete set null,
  name text not null,
  email text,
  phone text,
  hourly_rate numeric(10,2),
  is_floating boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists employees_organization_id_idx on public.employees (organization_id);
create index if not exists employees_home_location_id_idx on public.employees (home_location_id);

-- Employee role assignments
create table if not exists public.employee_roles (
  employee_id uuid references public.employees (id) on delete cascade,
  role_id uuid references public.roles (id) on delete cascade,
  primary key (employee_id, role_id)
);
create index if not exists employee_roles_employee_id_idx on public.employee_roles (employee_id);
create index if not exists employee_roles_role_id_idx on public.employee_roles (role_id);

-- Helper: current manager org
create or replace function public.current_manager_org_id()
returns uuid
language sql
security definer
set search_path = public
as $$
  select organization_id from public.managers where id = auth.uid();
$$;

-- RLS on
alter table public.organizations enable row level security;
alter table public.managers enable row level security;
alter table public.locations enable row level security;
alter table public.roles enable row level security;
alter table public.employees enable row level security;
alter table public.employee_roles enable row level security;

-- Policies
create policy "Select own org" on public.organizations
  for select using (id = current_manager_org_id());

drop policy if exists "Insert org" on public.organizations;
create policy "Insert org" on public.organizations
  for insert
  to authenticated
  with check (auth.role() in ('authenticated', 'service_role'));

create policy "Update own org" on public.organizations
  for update using (id = current_manager_org_id())
  with check (id = current_manager_org_id());

create policy "Select own manager record" on public.managers
  for select using (id = auth.uid());

create policy "Insert own manager record" on public.managers
  for insert with check (id = auth.uid());

create policy "Update own manager record" on public.managers
  for update using (id = auth.uid())
  with check (id = auth.uid());

create policy "Select locations in org" on public.locations
  for select using (organization_id = current_manager_org_id());

create policy "Insert locations in org" on public.locations
  for insert with check (organization_id = current_manager_org_id());

create policy "Update locations in org" on public.locations
  for update using (organization_id = current_manager_org_id())
  with check (organization_id = current_manager_org_id());

create policy "Delete locations in org" on public.locations
  for delete using (organization_id = current_manager_org_id());

create policy "Select roles in org" on public.roles
  for select using (organization_id = current_manager_org_id());

create policy "Insert roles in org" on public.roles
  for insert with check (organization_id = current_manager_org_id());

create policy "Update roles in org" on public.roles
  for update using (organization_id = current_manager_org_id())
  with check (organization_id = current_manager_org_id());

create policy "Delete roles in org" on public.roles
  for delete using (organization_id = current_manager_org_id());

create policy "Select employees in org" on public.employees
  for select using (organization_id = current_manager_org_id());

create policy "Insert employees in org" on public.employees
  for insert with check (organization_id = current_manager_org_id());

create policy "Update employees in org" on public.employees
  for update using (organization_id = current_manager_org_id())
  with check (organization_id = current_manager_org_id());

create policy "Delete employees in org" on public.employees
  for delete using (organization_id = current_manager_org_id());

create policy "Select employee_roles in org" on public.employee_roles
  for select using (exists (
    select 1 from public.employees e where e.id = employee_roles.employee_id and e.organization_id = current_manager_org_id()
  ));

create policy "Insert employee_roles in org" on public.employee_roles
  for insert with check (exists (
    select 1 from public.employees e where e.id = employee_roles.employee_id and e.organization_id = current_manager_org_id()
  ));

create policy "Delete employee_roles in org" on public.employee_roles
  for delete using (exists (
    select 1 from public.employees e where e.id = employee_roles.employee_id and e.organization_id = current_manager_org_id()
  ));

-- Grants
revoke all on schema public from anon, authenticated;
grant usage on schema public to authenticated;

grant select, insert, update, delete on public.organizations to authenticated;
grant select, insert, update, delete on public.managers to authenticated;
grant select, insert, update, delete on public.locations to authenticated;
grant select, insert, update, delete on public.roles to authenticated;
grant select, insert, update, delete on public.employees to authenticated;
grant select, insert, update, delete on public.employee_roles to authenticated;

-- Onboarding RPC
create or replace function public.create_org_and_manager(org_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  insert into public.organizations (name)
  values (org_name)
  returning id into v_org_id;

  insert into public.managers (id, organization_id, email)
  values (auth.uid(), v_org_id, coalesce(auth.jwt() ->> 'email', ''))
  on conflict (id) do update set organization_id = excluded.organization_id, email = excluded.email;

  return v_org_id;
end;
$$;

grant execute on function public.create_org_and_manager(text) to authenticated;

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

-- Expand shifts table to support assignments and roles
alter table public.shifts
  add column if not exists employee_id uuid references public.employees (id) on delete set null,
  add column if not exists role_id uuid references public.roles (id) on delete set null;

create index if not exists shifts_employee_id_idx on public.shifts (employee_id);
create index if not exists shifts_role_id_idx on public.shifts (role_id);

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

create table coverage_requirements (
  id uuid default gen_random_uuid() primary key,
  location_id uuid references locations(id) on delete cascade not null,
  role_id uuid references roles(id) on delete cascade not null,
  day_of_week integer not null check (day_of_week between 0 and 6),
  start_time time not null,
  end_time time not null,
  min_employees integer not null default 1,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  
  constraint valid_time_range check (start_time < end_time)
);

alter table coverage_requirements enable row level security;

create policy "Managers can view coverage requirements for their organization"
  on coverage_requirements for select
  using (
    exists (
      select 1 from locations
      where locations.id = coverage_requirements.location_id
      and locations.organization_id = current_manager_org_id()
    )
  );

create policy "Managers can insert coverage requirements for their organization"
  on coverage_requirements for insert
  with check (
    exists (
      select 1 from locations
      where locations.id = coverage_requirements.location_id
      and locations.organization_id = current_manager_org_id()
    )
  );

create policy "Managers can update coverage requirements for their organization"
  on coverage_requirements for update
  using (
    exists (
      select 1 from locations
      where locations.id = coverage_requirements.location_id
      and locations.organization_id = current_manager_org_id()
    )
  );

create policy "Managers can delete coverage requirements for their organization"
  on coverage_requirements for delete
  using (
    exists (
      select 1 from locations
      where locations.id = coverage_requirements.location_id
      and locations.organization_id = current_manager_org_id()
    )
  );


grant select, insert, update, delete on public.coverage_requirements to authenticated;

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
  unique (location_id, week_start_date)
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

-- Add display_order to employees table
alter table public.employees
add column display_order integer default 0;

-- Create an index for performance
create index if not exists employees_display_order_idx on public.employees (display_order);

ALTER TABLE shifts
ADD COLUMN unpaid_break_minutes INTEGER DEFAULT 0;

ALTER TABLE shifts
DROP COLUMN unpaid_break_minutes;

ALTER TABLE shifts
ADD COLUMN break_start_datetime TIMESTAMPTZ,
ADD COLUMN break_end_datetime TIMESTAMPTZ;


alter table public.shifts replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_rel pr
    join pg_class pc on pr.prrelid = pc.oid
    join pg_publication pp on pr.prpubid = pp.oid
    where pp.pubname = 'supabase_realtime'
    and pc.relname = 'shifts'
  ) then
    alter publication supabase_realtime add table public.shifts;
  end if;
end;
$$;
