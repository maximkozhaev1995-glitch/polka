-- Лимит запросов к ИИ-ассистенту
create table if not exists ai_usage (
  tg_id bigint not null,
  day date not null default current_date,
  n integer not null default 0,
  primary key (tg_id, day)
);
alter table ai_usage enable row level security;  -- политик нет: пишет только серверная функция
create or replace function ai_hit(p bigint) returns integer language sql security definer set search_path=public as $$
  insert into ai_usage(tg_id, day, n) values (p, current_date, 1)
  on conflict (tg_id, day) do update set n = ai_usage.n + 1
  returning n
$$;
revoke all on function ai_hit(bigint) from public, anon, authenticated;
