-- Owner-approved 2026-10-31; target tool project_id qnohynnwasoyjakrrrhb ONLY.
-- Removes exactly six mutation-related privileges. SELECT, MAINTAIN, definitions,
-- ownership, service_role, base tables and functions remain unchanged.
BEGIN;
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='3s';
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.public_stock, public.public_mixes
  FROM PUBLIC, anon, authenticated;
DO $$
DECLARE r text; obj text; privilege text;
BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
  FOREACH obj IN ARRAY ARRAY['public.public_stock','public.public_mixes'] LOOP
   IF NOT has_table_privilege(r,obj,'SELECT') THEN RAISE EXCEPTION 'Guest SELECT missing for % on %',r,obj; END IF;
   FOREACH privilege IN ARRAY ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
    IF has_table_privilege(r,obj,privilege) THEN RAISE EXCEPTION 'Mutation privilege % remains for % on %',privilege,r,obj; END IF;
   END LOOP;
  END LOOP;
 END LOOP;
END $$;
COMMIT;
