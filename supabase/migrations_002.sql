-- id поставщиков создаёт приложение, поэтому текстовый
alter table suppliers alter column id drop default;
alter table suppliers alter column id type text using id::text;
alter table suppliers alter column id set default gen_random_uuid()::text;
-- отмена взятия: управляющий может удалить запись журнала своего заведения
drop policy if exists moves_delete on moves;
create policy moves_delete on moves for delete using (venue_id = me_venue() and me_role()='manager');
