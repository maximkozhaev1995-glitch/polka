-- PR #77: shared catalog is read-only to staff; settings belong to a venue.
-- Run after uniform_staff_access. Production rollout requires separate approval.
begin;
create table public.flavor_strengths (
  venue_id uuid not null references public.venues(id) on delete cascade,
  flavor_id text not null references public.flavors(id) on delete cascade,
  strength smallint check (strength between 1 and 10),
  primary key (venue_id, flavor_id)
);
create table public.flavor_packs (
  venue_id uuid not null references public.venues(id) on delete cascade,
  flavor_id text not null references public.flavors(id) on delete cascade,
  pack_g integer check (pack_g between 5 and 2000),
  primary key (venue_id, flavor_id)
);
create index flavor_strengths_flavor_id_idx on public.flavor_strengths(flavor_id);
create index flavor_packs_flavor_id_idx on public.flavor_packs(flavor_id);
alter table public.flavor_strengths enable row level security;
alter table public.flavor_packs enable row level security;
revoke all on public.flavor_strengths, public.flavor_packs from public, anon, authenticated;
grant select, insert, update, delete on public.flavor_strengths, public.flavor_packs to authenticated;
-- Guest cards display the venue's strength of shared catalog flavors.
-- No employee identity, private flavor or pack setting is exposed.
grant select on public.flavor_strengths to anon;
grant select on public.flavors to anon;
create policy flavor_strengths_guest on public.flavor_strengths for select to anon
 using (exists (select 1 from public.flavors f where f.id=flavor_id and f.venue_id is null));
create policy flavor_strengths_staff on public.flavor_strengths for all to authenticated
 using (public.is_staff() and venue_id=(select public.me_venue()))
 with check (public.is_staff() and venue_id=(select public.me_venue()) and exists (
   select 1 from public.flavors f where f.id=flavor_id and (f.venue_id is null or f.venue_id=(select public.me_venue()))));
create policy flavor_packs_staff on public.flavor_packs for all to authenticated
 using (public.is_staff() and venue_id=(select public.me_venue()))
 with check (public.is_staff() and venue_id=(select public.me_venue()) and exists (
   select 1 from public.flavors f where f.id=flavor_id and (f.venue_id is null or f.venue_id=(select public.me_venue()))));

drop policy if exists flavors_staff_write on public.flavors;
create policy flavors_staff_write on public.flavors for all to authenticated
 using (public.is_staff() and custom is true and venue_id=(select public.me_venue()))
 with check (public.is_staff() and custom is true and venue_id=(select public.me_venue()));
-- Restrictive guards also constrain any older permissive policies still present.
create policy flavors_venue_read_guard on public.flavors as restrictive for select to public
 using (venue_id is null or (public.is_staff() and venue_id=(select public.me_venue())));
create policy flavors_venue_insert_guard on public.flavors as restrictive for insert to public
 with check (public.is_staff() and custom is true and venue_id=(select public.me_venue()));
create policy flavors_venue_update_guard on public.flavors as restrictive for update to public
 using (public.is_staff() and custom is true and venue_id=(select public.me_venue()))
 with check (public.is_staff() and custom is true and venue_id=(select public.me_venue()));
create policy flavors_venue_delete_guard on public.flavors as restrictive for delete to public
 using (public.is_staff() and custom is true and venue_id=(select public.me_venue()));
notify pgrst, 'reload schema';
commit;
