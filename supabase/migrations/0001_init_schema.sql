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
  to public
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
