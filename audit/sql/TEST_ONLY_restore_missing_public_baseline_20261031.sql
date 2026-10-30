-- TEST-ONLY: Mixora missing public baseline objects. Generated against production metadata 2026-10-31.
-- Apply ONLY to Supabase project qnohynnwasoyjakrrrhb, never to production.
-- Adds schema objects and synthetic test-venue labels; does NOT import or change stock/venue inventory data.
-- Existing archive mixora_restorecheck_1793190662565 remains immutable.
-- All statements run as ONE migration transaction; external migration tool must handle rollback on failure.
SET search_path = public, pg_catalog;
DO $guard$ BEGIN
 IF to_regclass('mixora_restorecheck_1793190662565.stock') IS NULL THEN RAISE EXCEPTION 'Not isolated mixora-b5-test'; END IF;
 IF to_regclass('public.orders') IS NOT NULL THEN RAISE EXCEPTION 'Baseline already exists: review before retry'; END IF;
 IF (SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE') <> 8 THEN RAISE EXCEPTION 'Unexpected test table count'; END IF;
END $guard$;

-- Reconcile pre-existing synthetic venue fixture shape without replacing rows.
ALTER TABLE public.venues ADD COLUMN name text;
UPDATE public.venues SET name = 'Test venue ' || left(id::text, 8) WHERE name IS NULL;
ALTER TABLE public.venues ALTER COLUMN name SET NOT NULL;
ALTER TABLE public.venues ADD COLUMN created_at timestamptz DEFAULT now();
ALTER TABLE public.venues ALTER COLUMN id SET DEFAULT gen_random_uuid();

-- Restore 17 missing table definitions from immutable archived schema, without source data.
CREATE TABLE public."ai_jobs" (LIKE mixora_restorecheck_1793190662565."ai_jobs" INCLUDING ALL);
ALTER TABLE public."ai_jobs" ENABLE ROW LEVEL SECURITY;
CREATE TABLE public."ai_local" (LIKE mixora_restorecheck_1793190662565."ai_local" INCLUDING ALL);
ALTER TABLE public."ai_local" ENABLE ROW LEVEL SECURITY;
CREATE TABLE public."ai_usage" (LIKE mixora_restorecheck_1793190662565."ai_usage" INCLUDING ALL);
ALTER TABLE public."ai_usage" ENABLE ROW LEVEL SECURITY;
CREATE TABLE public."codes" (LIKE mixora_restorecheck_1793190662565."codes" INCLUDING ALL);
ALTER TABLE public."codes" ENABLE ROW LEVEL SECURITY;
CREATE TABLE public."favorites" (LIKE mixora_restorecheck_1793190662565."favorites" INCLUDING ALL);
ALTER TABLE public."favorites" ENABLE ROW LEVEL SECURITY;
CREATE TABLE public."guest_mixes" (LIKE mixora_restorecheck_1793190662565."guest_mixes" INCLUDING ALL);
ALTER TABLE public."guest_mixes" ENABLE ROW LEVEL SECURITY;
CREATE TABLE public."inv_log" (LIKE mixora_restorecheck_1793190662565."inv_log" INCLUDING ALL);
ALTER TABLE public."inv_log" ENABLE ROW LEVEL SECURITY;
CREATE TABLE public."invites" (LIKE mixora_restorecheck_1793190662565."invites" INCLUDING ALL);
ALTER TABLE public."invites" ENABLE ROW LEVEL SECURITY;
CREATE TABLE public."knowledge" (LIKE mixora_restorecheck_1793190662565."knowledge" INCLUDING ALL);
ALTER TABLE public."knowledge" ENABLE ROW LEVEL SECURITY;
CREATE TABLE public."knowledge_cat" (LIKE mixora_restorecheck_1793190662565."knowledge_cat" INCLUDING ALL);
ALTER TABLE public."knowledge_cat" ENABLE ROW LEVEL SECURITY;
CREATE TABLE public."mixes" (LIKE mixora_restorecheck_1793190662565."mixes" INCLUDING ALL);
ALTER TABLE public."mixes" ENABLE ROW LEVEL SECURITY;
CREATE TABLE public."orders" (LIKE mixora_restorecheck_1793190662565."orders" INCLUDING ALL);
ALTER TABLE public."orders" ENABLE ROW LEVEL SECURITY;
CREATE TABLE public."pack_sizes" (LIKE mixora_restorecheck_1793190662565."pack_sizes" INCLUDING ALL);
ALTER TABLE public."pack_sizes" ENABLE ROW LEVEL SECURITY;
CREATE TABLE public."suppliers" (LIKE mixora_restorecheck_1793190662565."suppliers" INCLUDING ALL);
ALTER TABLE public."suppliers" ENABLE ROW LEVEL SECURITY;
CREATE TABLE public."task_log" (LIKE mixora_restorecheck_1793190662565."task_log" INCLUDING ALL);
ALTER TABLE public."task_log" ENABLE ROW LEVEL SECURITY;
CREATE TABLE public."tasks" (LIKE mixora_restorecheck_1793190662565."tasks" INCLUDING ALL);
ALTER TABLE public."tasks" ENABLE ROW LEVEL SECURITY;
CREATE TABLE public."wishes" (LIKE mixora_restorecheck_1793190662565."wishes" INCLUDING ALL);
ALTER TABLE public."wishes" ENABLE ROW LEVEL SECURITY;

-- LIKE omits foreign keys: rebuild production FK definitions against public.
ALTER TABLE public."codes" ADD CONSTRAINT "codes_flavor_id_fkey" FOREIGN KEY (flavor_id) REFERENCES flavors(id) ON DELETE CASCADE;
ALTER TABLE public."favorites" ADD CONSTRAINT "favorites_flavor_id_fkey" FOREIGN KEY (flavor_id) REFERENCES flavors(id) ON DELETE CASCADE;
ALTER TABLE public."guest_mixes" ADD CONSTRAINT "guest_mixes_venue_id_fkey" FOREIGN KEY (venue_id) REFERENCES venues(id);
ALTER TABLE public."invites" ADD CONSTRAINT "invites_venue_id_fkey" FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE;
ALTER TABLE public."knowledge" ADD CONSTRAINT "knowledge_cat_id_fkey" FOREIGN KEY (cat_id) REFERENCES knowledge_cat(id) ON DELETE CASCADE;
ALTER TABLE public."mixes" ADD CONSTRAINT "mixes_venue_id_fkey" FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE;
ALTER TABLE public."orders" ADD CONSTRAINT "orders_venue_id_fkey" FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE;
ALTER TABLE public."suppliers" ADD CONSTRAINT "suppliers_venue_id_fkey" FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE;
ALTER TABLE public."task_log" ADD CONSTRAINT "task_log_task_id_fkey" FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE;
ALTER TABLE public."wishes" ADD CONSTRAINT "wishes_venue_id_fkey" FOREIGN KEY (venue_id) REFERENCES venues(id);

-- Restore required backend RPCs and trigger helpers.
CREATE OR REPLACE FUNCTION public.ai_hit(p bigint)
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  insert into ai_usage(tg_id, day, n) values (p, current_date, 1)
  on conflict (tg_id, day) do update set n = ai_usage.n + 1
  returning n
$function$
;
CREATE OR REPLACE FUNCTION public.ai_take_job()
 RETURNS SETOF public.ai_jobs
 LANGUAGE sql
AS $function$
  update ai_jobs set taken_at = now()
  where id = (select id from ai_jobs where taken_at is null and created_at > now() - interval '90 seconds'
              order by created_at limit 1 for update skip locked)
  returning *;
$function$
;
CREATE OR REPLACE FUNCTION public.claim_guest_mix(p_id uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  update guest_mixes set taken = true where id = p_id and taken = false
$function$
;
CREATE OR REPLACE FUNCTION public.enforce_master_stock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r text; p text[];
begin
  select role, perms into r, p from users where tg_id = me_tg();
  if r is distinct from 'master' then return new; end if;
  if new.wh is distinct from old.wh and not ('take' = any(p) or 'add' = any(p)) then raise exception 'нет права менять склад'; end if;
  if new.bar is distinct from old.bar and not ('take' = any(p) or 'offbar' = any(p)) then raise exception 'нет права менять стойку'; end if;
  if new.slow is distinct from old.slow and not ('slow' = any(p)) then raise exception 'нет права менять неликвид'; end if;
  if new.retired is distinct from old.retired then raise exception 'нет права выводить вкус'; end if;
  if old.stop and not new.stop and not ('unstop' = any(p)) then raise exception 'нет права снимать стоп'; end if;
  return new;
end $function$
;
CREATE OR REPLACE FUNCTION public.users_default_manager()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.role := 'manager';
  return new;
end $function$
;
CREATE OR REPLACE FUNCTION public.wishes_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if (select count(*) from wishes where device = new.device and created_at > now() - interval '1 day') >= 10 then
    raise exception 'wish_limit';
  end if;
  return new;
end $function$
;

-- Restore production policy names/expressions for new public tables.
CREATE POLICY "codes_read" ON public."codes" AS PERMISSIVE FOR SELECT TO PUBLIC USING (true);
CREATE POLICY "fav_all" ON public."favorites" AS PERMISSIVE FOR ALL TO PUBLIC USING (true) WITH CHECK (true);
CREATE POLICY "guest_mixes_guest_read" ON public."guest_mixes" AS PERMISSIVE FOR SELECT TO "anon" USING ((taken = false));
CREATE POLICY "guest_mixes_staff_insert" ON public."guest_mixes" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((venue_id = me_venue()));
CREATE POLICY "guest_mixes_staff_read" ON public."guest_mixes" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((venue_id = me_venue()));
CREATE POLICY "inv_log_read" ON public."inv_log" AS PERMISSIVE FOR SELECT TO PUBLIC USING ((venue_id = me_venue()));
CREATE POLICY "inv_log_write" ON public."inv_log" AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK ((venue_id = me_venue()));
CREATE POLICY "invites_mgr" ON public."invites" AS PERMISSIVE FOR ALL TO PUBLIC USING ((is_staff() AND (venue_id = me_venue()))) WITH CHECK ((is_staff() AND (venue_id = me_venue())));
CREATE POLICY "knowledge_delete" ON public."knowledge" AS PERMISSIVE FOR DELETE TO PUBLIC USING (((venue_id = me_venue()) AND is_staff() AND (NOT (EXISTS ( SELECT 1
   FROM knowledge_cat c
  WHERE ((c.id = knowledge.cat_id) AND c.protected))))));
CREATE POLICY "knowledge_read" ON public."knowledge" AS PERMISSIVE FOR SELECT TO PUBLIC USING ((venue_id = me_venue()));
CREATE POLICY "knowledge_write" ON public."knowledge" AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK (((venue_id = me_venue()) AND is_staff()));
CREATE POLICY "knowledge_cat_delete" ON public."knowledge_cat" AS PERMISSIVE FOR DELETE TO PUBLIC USING (((venue_id = me_venue()) AND is_staff() AND (NOT protected)));
CREATE POLICY "knowledge_cat_read" ON public."knowledge_cat" AS PERMISSIVE FOR SELECT TO PUBLIC USING ((venue_id = me_venue()));
CREATE POLICY "knowledge_cat_write" ON public."knowledge_cat" AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK (((venue_id = me_venue()) AND is_staff()));
CREATE POLICY "mixes_delete" ON public."mixes" AS PERMISSIVE FOR DELETE TO PUBLIC USING (((venue_id = me_venue()) AND (is_staff() OR (by_tg = me_tg()))));
CREATE POLICY "mixes_insert" ON public."mixes" AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK ((venue_id = me_venue()));
CREATE POLICY "mixes_read" ON public."mixes" AS PERMISSIVE FOR SELECT TO PUBLIC USING (((venue_id = me_venue()) OR (in_karta AND (NOT hidden))));
CREATE POLICY "mixes_update" ON public."mixes" AS PERMISSIVE FOR UPDATE TO PUBLIC USING (((venue_id = me_venue()) AND (is_staff() OR (by_tg = me_tg()))));
CREATE POLICY "orders_manager" ON public."orders" AS PERMISSIVE FOR ALL TO PUBLIC USING ((is_staff() AND (venue_id = me_venue()))) WITH CHECK ((venue_id = me_venue()));
CREATE POLICY "pack_sizes_read" ON public."pack_sizes" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);
CREATE POLICY "suppliers_manager" ON public."suppliers" AS PERMISSIVE FOR ALL TO PUBLIC USING ((is_staff() AND (venue_id = me_venue()))) WITH CHECK ((venue_id = me_venue()));
CREATE POLICY "task_log_delete" ON public."task_log" AS PERMISSIVE FOR DELETE TO PUBLIC USING ((venue_id = me_venue()));
CREATE POLICY "task_log_read" ON public."task_log" AS PERMISSIVE FOR SELECT TO PUBLIC USING ((venue_id = me_venue()));
CREATE POLICY "task_log_write" ON public."task_log" AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK ((venue_id = me_venue()));
CREATE POLICY "tasks_delete" ON public."tasks" AS PERMISSIVE FOR DELETE TO PUBLIC USING (((venue_id = me_venue()) AND is_staff()));
CREATE POLICY "tasks_insert" ON public."tasks" AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK (((venue_id = me_venue()) AND is_staff()));
CREATE POLICY "tasks_read" ON public."tasks" AS PERMISSIVE FOR SELECT TO PUBLIC USING ((venue_id = me_venue()));
CREATE POLICY "tasks_update" ON public."tasks" AS PERMISSIVE FOR UPDATE TO PUBLIC USING (((venue_id = me_venue()) AND is_staff()));
CREATE POLICY "wishes_guest_add" ON public."wishes" AS PERMISSIVE FOR INSERT TO "anon" WITH CHECK ((state = 'new'::text));
CREATE POLICY "wishes_mgr" ON public."wishes" AS PERMISSIVE FOR ALL TO PUBLIC USING ((is_staff() AND (venue_id = me_venue()))) WITH CHECK ((is_staff() AND (venue_id = me_venue())));
-- Replace test-only venue read fixture policy with production-equivalent venue scope.
DROP POLICY venue_read_test ON public.venues;
CREATE POLICY venues_own_read ON public.venues FOR SELECT TO authenticated USING (id = me_venue());

-- Enable table REST access where RLS explicitly permits, but never grant TRUNCATE.
GRANT SELECT, INSERT, UPDATE, DELETE ON public."ai_jobs" TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."ai_local" TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."ai_usage" TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."codes" TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."favorites" TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."guest_mixes" TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."inv_log" TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."invites" TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."knowledge" TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."knowledge_cat" TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."mixes" TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."orders" TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."pack_sizes" TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."suppliers" TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."task_log" TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."tasks" TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."wishes" TO anon, authenticated;

-- Production-restricted internal AI RPCs should not gain default PUBLIC EXECUTE.
REVOKE EXECUTE ON FUNCTION public.ai_hit(bigint) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ai_take_job() FROM PUBLIC, anon, authenticated;

-- Restore triggers; no rows are inserted into existing tables.
CREATE TRIGGER users_default_manager BEFORE INSERT ON public.users FOR EACH ROW EXECUTE FUNCTION users_default_manager();
CREATE TRIGGER wishes_limit_t BEFORE INSERT ON public.wishes FOR EACH ROW EXECUTE FUNCTION wishes_limit();

-- Views reproduce live behavior on isolated synthetic fixtures only; security-definer risk tracked separately.
CREATE VIEW public."public_mixes" AS SELECT id,
    venue_id,
    title,
    kind,
    note,
    tags,
    parts,
    by_name,
    created_at
   FROM mixes
  WHERE (in_karta AND (NOT hidden));
GRANT SELECT ON public."public_mixes" TO anon, authenticated;
CREATE VIEW public."public_stock" AS SELECT venue_id,
    flavor_id,
    slow
   FROM stock s
  WHERE (bar AND (NOT stop) AND (NOT retired));
GRANT SELECT ON public."public_stock" TO anon, authenticated;

-- Audit assertions: fail transaction if structural baseline remains incomplete.
DO $assert$ DECLARE nt int; np int; nf int; ng int; nv int; BEGIN
 SELECT count(*) INTO nt FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';
 SELECT count(*) INTO np FROM pg_policies WHERE schemaname='public';
 SELECT count(*) INTO nf FROM pg_proc WHERE pronamespace='public'::regnamespace;
 SELECT count(*) INTO ng FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relnamespace='public'::regnamespace AND NOT t.tgisinternal;
 SELECT count(*) INTO nv FROM pg_views WHERE schemaname='public';
 IF nt<>25 OR np<>52 OR nf<>11 OR ng<>2 OR nv<>2 THEN RAISE EXCEPTION 'Parity FAILED tables %, policies %, funcs %, triggers %, views %',nt,np,nf,ng,nv; END IF;
END $assert$;
