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
