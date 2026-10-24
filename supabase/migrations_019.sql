-- ИИ на компьютере Максима без туннеля: компьютер сам забирает запросы из очереди (tools/local-ai/polka_ai.py).
-- Туннель Cloudflare рвался из-за VPN; исходящие запросы к Supabase через VPN проходят. Читает и пишет только функция ai.
create table if not exists ai_jobs (
  id uuid primary key default gen_random_uuid(),
  req jsonb not null,           -- запрос в формате OpenAI
  res jsonb,                    -- ответ компьютера (или {"error": ...})
  taken_at timestamptz,
  created_at timestamptz not null default now()
);
alter table ai_jobs enable row level security;  -- политик нет

-- Взять самый старый свежий запрос, не отдавая его двум опросам сразу
create or replace function ai_take_job() returns setof ai_jobs language sql as $$
  update ai_jobs set taken_at = now()
  where id = (select id from ai_jobs where taken_at is null and created_at > now() - interval '90 seconds'
              order by created_at limit 1 for update skip locked)
  returning *;
$$;
revoke execute on function ai_take_job() from public, anon, authenticated;
