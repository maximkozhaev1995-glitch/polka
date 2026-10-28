-- Откат данных к снимку. Подставьте имя схемы снимка вместо SNAP (например snap_20261020_2212).
-- Команда (users) и приглашения (invites) НЕ откатываются, чтобы никто не потерял доступ.
begin;
-- A legacy partial snapshot must never leave successful idempotency receipts
-- whose stock effects have been erased. Use a coordinated full DB backup instead.
do $guard$ begin
 if to_regclass('mixora_internal.stock_operations') is not null then
  raise exception 'B5 ledger exists: legacy partial restore is unsafe; use a coordinated full database restore';
 end if;
end; $guard$;
truncate public.moves, public.stock, public.suppliers, public.orders, public.mixes, public.favorites, public.codes;
delete from public.flavors where custom;
insert into public.flavors select * from SNAP.flavors where custom on conflict (id) do nothing;
update public.flavors f set strength = s.strength, descr = s.descr, tags = s.tags from SNAP.flavors s where s.id = f.id and not f.custom;
insert into public.stock select * from SNAP.stock;
insert into public.moves overriding system value select * from SNAP.moves;
insert into public.suppliers select * from SNAP.suppliers;
insert into public.orders select * from SNAP.orders;
insert into public.mixes select * from SNAP.mixes;
insert into public.favorites select * from SNAP.favorites;
insert into public.codes select * from SNAP.codes;
commit;
