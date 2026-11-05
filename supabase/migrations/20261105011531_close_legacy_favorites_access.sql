begin;

-- The web client keeps favorites on the device. The legacy table is retained for recovery.
drop policy if exists fav_all on public.favorites;
revoke all privileges on table public.favorites from public, anon, authenticated;

do $$
declare
  columns text;
begin
  select string_agg(quote_ident(attname), ', ' order by attnum) into columns
  from pg_attribute
  where attrelid = 'public.favorites'::regclass and attnum > 0 and not attisdropped;

  execute format('revoke all privileges (%s) on table public.favorites from public, anon, authenticated', columns);
end;
$$;

commit;
