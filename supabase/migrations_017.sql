-- База знаний: разрешить загрузку видео в бакет files (раньше только
-- PDF/изображения, см. migrations_011.sql) и увеличить лимит размера файла,
-- т.к. видео с телефона обычно крупнее фото.
update storage.buckets
set file_size_limit = 104857600, -- 100 МБ
    allowed_mime_types = array['application/pdf','image/jpeg','image/png','image/webp','image/heic','image/gif',
      'video/mp4','video/webm','video/quicktime']
where id = 'files';
