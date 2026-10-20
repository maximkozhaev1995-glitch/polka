-- Команда: приглашения, права мастеров и защита на сервере
drop policy if exists invites_mgr on invites;
create policy invites_mgr on invites for all
  using (me_role()='manager' and venue_id = me_venue())
  with check (me_role()='manager' and venue_id = me_venue());

-- мастер может записывать остатки (upsert), но менять только то, что ему разрешено (см. триггер ниже)
drop policy if exists stock_master_insert on stock;
create policy stock_master_insert on stock for insert
  with check (me_role()='master' and venue_id = me_venue());

create or replace function enforce_master_stock() returns trigger language plpgsql security definer set search_path=public as $$
declare r text; p text[];
begin
  select role, perms into r, p from users where tg_id = me_tg();
  if r is distinct from 'master' then return new; end if;
  if new.wh is distinct from old.wh and not ('take' = any(p) or 'add' = any(p)) then raise exception 'нет права менять склад'; end if;
  if new.bar is distinct from old.bar and not ('take' = any(p) or 'offbar' = any(p)) then raise exception 'нет права менять стойку'; end if;
  if new.slow is distinct from old.slow and not ('slow' = any(p)) then raise exception 'нет права менять неликвид'; end if;
  if new.retired is distinct from old.retired then raise exception 'нет права выводить вкус'; end if;
  if old.stop and not new.stop and not ('unstop' = any(p)) then raise exception 'нет права снимать стоп'; end if;
  return new;
end $$;
drop trigger if exists stock_master_guard on stock;
create trigger stock_master_guard before update on stock for each row execute function enforce_master_stock();
