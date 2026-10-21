-- Микс по QR гостя: мастер сканирует код из карты и вносит состав, микс попадает в избранное гостя.
create table if not exists guest_mixes (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues(id),
  gid text not null check (char_length(gid) between 4 and 40),
  name text,
  parts jsonb not null default '[]',
  note text,
  by_name text,
  taken boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists guest_mixes_gid on guest_mixes (gid, taken);
alter table guest_mixes enable row level security;

drop policy if exists guest_mixes_staff_insert on guest_mixes;
create policy guest_mixes_staff_insert on guest_mixes for insert to authenticated
  with check (venue_id = me_venue());
-- Нужно для Prefer: return=representation при вставке (иначе RLS блокирует саму RETURNING-строку).
drop policy if exists guest_mixes_staff_read on guest_mixes;
create policy guest_mixes_staff_read on guest_mixes for select to authenticated
  using (venue_id = me_venue());

-- Гость читает свои необработанные миксы по gid (случайный id браузера, не персональные данные).
drop policy if exists guest_mixes_guest_read on guest_mixes;
create policy guest_mixes_guest_read on guest_mixes for select to anon
  using (taken = false);
grant select on guest_mixes to anon;

-- Забрать микс гость не может напрямую UPDATE'ом (комбинация SELECT+UPDATE-политик для anon
-- ломает row security — воспроизведено на этом проекте), поэтому через SECURITY DEFINER-функцию.
drop function if exists claim_guest_mix(uuid);
create function claim_guest_mix(p_id uuid) returns void
language sql security definer set search_path = public as $$
  update guest_mixes set taken = true where id = p_id and taken = false
$$;
grant execute on function claim_guest_mix(uuid) to anon;
