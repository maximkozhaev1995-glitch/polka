-- ИИ на компьютере Максима: адрес туннеля, который компьютер сам сообщает при запуске
-- (tools/local-ai). Адрес меняется при каждом перезапуске туннеля, поэтому хранится в базе, а не в секретах.
create table if not exists ai_local (
  id integer primary key default 1 check (id = 1),
  url text not null,
  model text,
  updated_at timestamptz not null default now()
);
alter table ai_local enable row level security;  -- политик нет: читает и пишет только серверная функция ai
