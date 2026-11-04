-- Guest capabilities are bearer credentials: never expose gid via anonymous table reads.
begin;
drop policy if exists guest_mixes_guest_read on public.guest_mixes;
revoke select on public.guest_mixes from public, anon;
-- Column grants can survive a table-level revoke.
do $$ declare cols text; begin
 select string_agg(quote_ident(attname),',') into cols from pg_catalog.pg_attribute
 where attrelid='public.guest_mixes'::regclass and attnum>0 and not attisdropped;
 execute format('revoke select (%s) on public.guest_mixes from public, anon',cols);
end $$;
drop function if exists public.claim_guest_mix(uuid);
create or replace function public.list_guest_mixes(p_gid text)
returns table(id uuid,name text,parts jsonb,note text,created_at timestamptz)
language plpgsql security definer set search_path='' as $$
begin
 if p_gid is null or p_gid !~ '^g[0-9a-f]{32}$' then
  raise exception 'guest_capability_required' using errcode='42501';
 end if;
 return query select g.id,g.name,g.parts,g.note,g.created_at
 from public.guest_mixes g where g.gid=p_gid and not g.taken order by g.created_at,g.id;
end $$;
create or replace function public.claim_guest_mix(p_id uuid,p_gid text)
returns boolean language plpgsql security definer set search_path='' as $$
declare changed integer;
begin
 if p_gid is null or p_gid !~ '^g[0-9a-f]{32}$' then
  raise exception 'guest_capability_required' using errcode='42501';
 end if;
 update public.guest_mixes set taken=true where id=p_id and gid=p_gid and not taken;
 get diagnostics changed=row_count;
 return changed=1;
end $$;
revoke all on function public.list_guest_mixes(text) from public;
revoke all on function public.claim_guest_mix(uuid,text) from public;
grant execute on function public.list_guest_mixes(text),public.claim_guest_mix(uuid,text) to anon,authenticated;
commit;

