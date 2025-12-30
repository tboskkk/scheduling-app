-- Add display_order to employees table
alter table public.employees
add column display_order integer default 0;

-- Create an index for performance
create index if not exists employees_display_order_idx on public.employees (display_order);
