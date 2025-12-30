-- Expand shifts table to support assignments and roles
alter table public.shifts
  add column if not exists employee_id uuid references public.employees (id) on delete set null,
  add column if not exists role_id uuid references public.roles (id) on delete set null;

create index if not exists shifts_employee_id_idx on public.shifts (employee_id);
create index if not exists shifts_role_id_idx on public.shifts (role_id);
