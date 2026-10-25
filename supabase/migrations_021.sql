-- Все новые сотрудники сразу получают роль управляющего (решение Максима 25.10.2026),
-- какой бы ролью ни было создано приглашение. Действует только при первом входе:
-- позже роль можно поменять вручную.
create or replace function users_default_manager() returns trigger
language plpgsql as $$
begin
  new.role := 'manager';
  return new;
end $$;
drop trigger if exists users_default_manager on users;
create trigger users_default_manager before insert on users
  for each row execute function users_default_manager();
