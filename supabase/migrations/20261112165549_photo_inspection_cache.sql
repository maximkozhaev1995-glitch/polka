-- Only the AI edge function may reuse a validated inspection. Keys bind the image to the
-- venue, staff member and membership epoch. Image bytes are never stored here.
create table public.photo_inspection_cache (
  image_key text primary key check (image_key ~ '^[0-9a-f]{64}$'),
  report jsonb not null,
  expires_at timestamptz not null
);
create index photo_inspection_cache_expiry on public.photo_inspection_cache (expires_at);
alter table public.photo_inspection_cache enable row level security;
revoke all on table public.photo_inspection_cache from public, anon, authenticated;
grant select, insert, update, delete on table public.photo_inspection_cache to service_role;
