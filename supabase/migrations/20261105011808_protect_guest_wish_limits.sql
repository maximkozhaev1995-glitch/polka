begin;

-- Guest cards send only these five fields. Keep identifiers, status and time server-owned.
revoke insert on public.wishes from public, anon;
revoke insert (id, venue_id, flavor_id, brand, flavor, device, state, created_at)
  on public.wishes from public, anon;
grant insert (venue_id, flavor_id, brand, flavor, device) on public.wishes to anon;

create or replace function public.wishes_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  cutoff timestamptz;
begin
  if current_setting('role', true) <> 'anon' then
    return new;
  end if;

  if new.flavor_id is not null and not exists (
    select 1 from public.flavors f where f.id = new.flavor_id
      and (f.venue_id is null or f.venue_id = new.venue_id)
  ) then
    raise exception 'wish_flavor_scope' using errcode = '42501';
  end if;

  -- Serialize the guest budget for this venue, including simultaneous requests.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mixora:wishes:' || new.venue_id::text, 0));
  new.created_at := pg_catalog.clock_timestamp();
  cutoff := new.created_at - interval '1 day';

  if (select count(*) from public.wishes w
      where w.venue_id = new.venue_id and w.created_at > cutoff) >= 100
    or (select count(*) from public.wishes w
        where w.venue_id = new.venue_id and w.device = new.device and w.created_at > cutoff) >= 10
  then
    raise exception 'wish_limit';
  end if;
  return new;
end $$;

commit;
