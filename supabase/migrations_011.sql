-- Хранилище файлов для Контрагентов (и дальше — для регламентов/устава).
-- Бакет создаётся отдельно (storage.buckets не всегда доступен через
-- обычную миграцию в управляемых проектах) — см. README раздела «Секреты»
-- или просто: insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
-- values ('files','files', false, 15728640, array['application/pdf','image/jpeg','image/png','image/webp','image/heic']);
drop policy if exists files_manager on storage.objects;
create policy files_manager on storage.objects for all
  using (bucket_id='files' and (storage.foldername(name))[1] = me_venue()::text and me_role()='manager')
  with check (bucket_id='files' and (storage.foldername(name))[1] = me_venue()::text and me_role()='manager');
