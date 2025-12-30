
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
