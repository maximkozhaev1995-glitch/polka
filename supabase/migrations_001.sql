-- Доработки схемы для приложения
alter table moves add column if not exists prev jsonb;
alter table moves add column if not exists bar_to boolean;
create table if not exists invites (
  code text primary key,
  venue_id uuid references venues(id) on delete cascade,
  role text not null check (role in ('master','manager')),
  used_by bigint,
  created_at timestamptz default now()
);
alter table invites enable row level security;  -- политик нет: читает только серверная функция
