do $$ begin if not exists(select from pg_roles where rolname='anon') then create role anon; end if; if not exists(select from pg_roles where rolname='authenticated') then create role authenticated; end if; end $$;
create table public.users(tg_id bigint primary key,venue_id uuid,role text,perms text[]);
create table public.flavors(id text primary key,venue_id uuid);
create table public.stock(venue_id uuid,flavor_id text,wh integer,bar boolean,stop boolean,stop_auto boolean,slow boolean default false,retired boolean default false,primary key(venue_id,flavor_id));
create table public.moves(id bigint generated always as identity primary key,venue_id uuid,flavor_id text,kind text,qty integer,left_after integer,prev jsonb,bar_to boolean,by_tg bigint,at timestamptz);
create function public.me_tg() returns bigint language sql stable as $$ select nullif(current_setting('test.tg',true),'')::bigint $$;
grant usage on schema public to authenticated,anon;
grant all on public.stock,public.moves to authenticated,anon;

-- Seed independent column ACLs: table-level REVOKE alone would leave these behind.
grant update(wh),insert(flavor_id) on public.stock to authenticated;
grant update(qty),insert(flavor_id) on public.moves to authenticated;
