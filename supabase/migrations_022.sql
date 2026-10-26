-- Закрыта запись через гостевые представления и в venues/codes (аудит 26.10.2026, применено к базе 26.10 18:30 UTC по решению Максима).
-- Карта по-прежнему читает public_stock/public_mixes; приложение venues и codes не читает.
revoke insert, update, delete, truncate on public.public_stock, public.public_mixes from anon, authenticated;
revoke insert, update, delete, truncate on public.venues, public.codes from anon, authenticated;
alter table public.venues enable row level security;
alter table public.codes enable row level security;
drop policy if exists venues_own_read on public.venues;
create policy venues_own_read on public.venues for select to authenticated using (id = me_venue());
drop policy if exists codes_read on public.codes;
create policy codes_read on public.codes for select using (true);
