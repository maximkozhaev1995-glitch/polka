-- TEST ONLY. Preserve strict warning/label validation while matching production constraint naming.
DO $guard$ BEGIN
 IF to_regclass('mixora_restorecheck_1793190662565.stock') IS NULL THEN
   RAISE EXCEPTION 'This migration is only for the isolated test project';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.photo_corrections'::regclass AND conname='photo_corrections_warning_guard') THEN
   RAISE EXCEPTION 'Strict photo warning guard missing, abort';
 END IF;
END $guard$;
ALTER TABLE public.photo_corrections DROP CONSTRAINT photo_corrections_raw_label_check;
ALTER TABLE public.photo_corrections RENAME CONSTRAINT photo_corrections_warning_guard TO photo_corrections_raw_label_check;