-- Metadata-only reconstruction of the inspected public schema (2026-10-27).
-- No production rows, credentials, or auth secrets. Unrelated columns/tables
-- and storage policies are intentionally outside this focused fixture.
create role anon; create role authenticated;
create table venues(id uuid primary key);
create table users(tg_id bigint primary key,venue_id uuid references venues(id) on delete cascade,
  name text not null,role text not null check(role in ('master','manager')),perms text[] not null default '{}',created_at timestamptz default now());
create table flavors(id text primary key,brand text not null,line text default '',name text not null,descr text default '',
  strength smallint check(strength between 1 and 10),sectors text[] default '{}',tags text[] default '{}',cats text[] default '{}',
  custom boolean default false,venue_id uuid references venues(id),pack_g integer check(pack_g is null or pack_g between 5 and 2000));
create table stock(venue_id uuid references venues(id) on delete cascade,flavor_id text references flavors(id) on delete cascade,
  wh integer not null default 0 check(wh>=0),bar boolean not null default false,stop boolean not null default false,
  stop_auto boolean not null default false,slow boolean not null default false,retired boolean not null default false,primary key(venue_id,flavor_id));
create table moves(id bigint generated always as identity primary key,venue_id uuid references venues(id) on delete cascade,
  flavor_id text references flavors(id),kind text not null check(kind in ('tobar','in','wo','inv','off')),qty integer not null default 0,
  left_after integer,reason text,by_tg bigint references users(tg_id),at timestamptz default now(),prev jsonb,bar_to boolean);
create function me_tg() returns bigint language sql stable as $$select nullif(current_setting('request.jwt.claims',true)::json->>'tg_id','')::bigint$$;
create function me_venue() returns uuid language sql stable security definer set search_path=public as $$select venue_id from users where tg_id=me_tg()$$;
create function me_role() returns text language sql stable security definer set search_path=public as $$select role from users where tg_id=me_tg()$$;
alter table users enable row level security;alter table flavors enable row level security;
alter table stock enable row level security;alter table moves enable row level security;
create policy users_self on users for select using(venue_id=me_venue());
create policy users_manage on users for all using(me_role()='manager' and venue_id=me_venue()) with check(venue_id=me_venue());
create policy flavors_read on flavors for select using(true);
create policy flavors_write on flavors for all using(me_role()='manager') with check(me_role()='manager');
create policy stock_read on stock for select using(venue_id=me_venue());
create policy stock_manager on stock for all using(me_role()='manager' and venue_id=me_venue()) with check(venue_id=me_venue());
create policy stock_master_insert on stock for insert with check(me_role()='master' and venue_id=me_venue());
create policy stock_master_stop on stock for update using(me_role()='master' and venue_id=me_venue()) with check(venue_id=me_venue());
create policy moves_read on moves for select using(venue_id=me_venue());
create policy moves_write on moves for insert with check(venue_id=me_venue());
create policy moves_delete on moves for delete using(venue_id=me_venue() and me_role()='manager');
grant all on venues,users,flavors,stock,moves to authenticated;
grant usage,select on all sequences in schema public to authenticated;
