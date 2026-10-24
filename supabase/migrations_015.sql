-- Защищённые базы знаний: нельзя удалить ни управляющему, ни кому-либо
-- ещё — проверка на уровне базы, а не только скрытая кнопка в интерфейсе.
alter table knowledge_cat add column if not exists protected boolean not null default false;
drop policy if exists knowledge_cat_delete on knowledge_cat;
create policy knowledge_cat_delete on knowledge_cat for delete
  using (venue_id = me_venue() and me_role()='manager' and not protected);

drop policy if exists knowledge_delete on knowledge;
create policy knowledge_delete on knowledge for delete
  using (venue_id = me_venue() and me_role()='manager'
    and not exists (select 1 from knowledge_cat c where c.id = knowledge.cat_id and c.protected));
