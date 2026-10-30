-- Mixora: repeatable read-only schema health snapshot.
-- Run independently on production and isolated TEST Supabase.
-- Does not select application row data, change access grants or write anything.
WITH base AS (
  SELECT c.oid, c.relname AS name, c.relrowsecurity AS rls
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind IN ('r','p')
), v AS (
  SELECT c.oid, c.relname AS name,
         COALESCE((SELECT option_value FROM pg_options_to_table(c.reloptions)
                   WHERE option_name='security_invoker'),'false')::boolean AS security_invoker,
         has_table_privilege('anon',c.oid,'SELECT') AS anon_select
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind='v'
), fn AS (
  SELECT p.oid, p.proname AS name,
         pg_get_function_identity_arguments(p.oid) AS args, p.prosecdef AS security_definer,
         has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute
  FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
), tr AS (
  SELECT t.tgname name, c.relname table_name
  FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
  JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND NOT t.tgisinternal
), archive AS (
  SELECT n.nspname AS schema_name, count(*) AS table_count
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname LIKE 'mixora_restorecheck_%' AND c.relkind IN ('r','p')
  GROUP BY n.nspname
)
SELECT jsonb_pretty(jsonb_build_object(
  'public_tables', (SELECT count(*) FROM base),
  'public_table_names', (SELECT coalesce(jsonb_agg(name ORDER BY name),'[]'::jsonb) FROM base),
  'public_tables_without_rls', (SELECT coalesce(jsonb_agg(name ORDER BY name),'[]'::jsonb) FROM base WHERE NOT rls),
  'public_policies', (SELECT count(*) FROM pg_policies WHERE schemaname='public'),
  'public_policy_names', (SELECT coalesce(jsonb_agg(tablename||'.'||policyname ORDER BY tablename,policyname),'[]'::jsonb)
                          FROM pg_policies WHERE schemaname='public'),
  'public_functions', (SELECT count(*) FROM fn),
  'function_signatures', (SELECT coalesce(jsonb_agg(name||'('||args||')' ORDER BY name,args),'[]'::jsonb) FROM fn),
  'anon_executable_definer_functions', (SELECT coalesce(jsonb_agg(name||'('||args||')' ORDER BY name,args),'[]'::jsonb)
                                       FROM fn WHERE security_definer AND anon_execute),
  'user_triggers', (SELECT count(*) FROM tr),
  'trigger_names', (SELECT coalesce(jsonb_agg(table_name||'.'||name ORDER BY table_name,name),'[]'::jsonb) FROM tr),
  'public_views', (SELECT count(*) FROM v),
  'anon_accessible_definer_views', (SELECT coalesce(jsonb_agg(name ORDER BY name),'[]'::jsonb)
                                    FROM v WHERE anon_select AND NOT security_invoker),
  'archived_restore_schemas', (SELECT coalesce(jsonb_agg(jsonb_build_object('schema',schema_name,'tables',table_count) ORDER BY schema_name),'[]'::jsonb) FROM archive)
)) AS mixora_schema_health;
