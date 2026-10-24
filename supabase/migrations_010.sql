-- Контрагенты: расширяем существующих «поставщиков» до трёх типов
-- (кальян/бар/хозы) с юр. данными и ссылками на файлы.
alter table suppliers add column if not exists ctype text not null default 'kalyan';
alter table suppliers add column if not exists legal_address text;
alter table suppliers add column if not exists requisites text;
alter table suppliers add column if not exists items text;
alter table suppliers add column if not exists files jsonb not null default '[]'::jsonb;
