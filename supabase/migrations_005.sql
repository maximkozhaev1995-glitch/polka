-- Пожелания гостей: один голос на строку, гость только добавляет, читает и ведёт список управляющий.
create table if not exists wishes (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues(id),
  flavor_id text,
  brand text not null check (char_length(brand) between 1 and 60),
  flavor text not null check (char_length(flavor) between 1 and 60),
  device text not null check (char_length(device) between 8 and 64),
  state text not null default 'new' check (state in ('new','order','done')),
  created_at timestamptz not null default now()
);
create unique index if not exists wishes_one_vote on wishes (venue_id, device, lower(brand), lower(flavor));
create index if not exists wishes_venue on wishes (venue_id, created_at desc);
alter table wishes enable row level security;
drop policy if exists wishes_guest_add on wishes;
create policy wishes_guest_add on wishes for insert to anon with check (state = 'new');
drop policy if exists wishes_mgr on wishes;
create policy wishes_mgr on wishes for all
  using (me_role()='manager' and venue_id = me_venue())
  with check (me_role()='manager' and venue_id = me_venue());
create or replace function wishes_limit() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from wishes where device = new.device and created_at > now() - interval '1 day') >= 10 then
    raise exception 'wish_limit';
  end if;
  return new;
end $$;
drop trigger if exists wishes_limit_t on wishes;
create trigger wishes_limit_t before insert on wishes for each row execute function wishes_limit();
grant insert on wishes to anon;
grant select, insert, update, delete on wishes to authenticated;
