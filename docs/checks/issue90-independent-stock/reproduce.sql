-- Independent issue90 critical reproduction. TEST qnohynnwasoyjakrrrhb ONLY.
-- No DELETE, DDL, identity allocation, credentials or external calls.
BEGIN;
SET LOCAL statement_timeout='20s';
SET LOCAL lock_timeout='3s';
DO $test$
DECLARE
  v uuid := gen_random_uuid();
  f text := 'issue90-independent-' || v::text;
  direct_error text;
  changed integer;
  r0 bigint;
  r1 bigint;
  m0 bigint;
  m1 bigint;
  slow1 boolean;
  executing_role text;
  staff boolean;
BEGIN
  INSERT INTO public.venues(id,name) VALUES(v,'issue90 independent synthetic fixture');
  INSERT INTO public.flavors(id,brand,name,custom,venue_id)
    VALUES(f,'ISSUE90 INDEPENDENT SYNTHETIC','Not a catalogue addition',false,NULL);
  INSERT INTO public.stock(venue_id,flavor_id,wh,bar,stop,retired,slow)
    VALUES(v,f,1,true,false,false,false);
  SELECT revision INTO r0 FROM public.stock WHERE venue_id=v AND flavor_id=f;
  SELECT count(*) INTO m0 FROM public.moves WHERE venue_id=v;
  PERFORM set_config('request.jwt.claims','{}',true);
  EXECUTE 'SET LOCAL ROLE anon';
  SELECT current_user,public.is_staff() INTO executing_role,staff;
  IF executing_role <> 'anon' OR staff IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Invalid anonymous execution context';
  END IF;
  BEGIN
    UPDATE public.stock SET slow=true WHERE venue_id=v AND flavor_id=f;
  EXCEPTION WHEN insufficient_privilege THEN direct_error:=SQLSTATE;
  END;
  IF direct_error IS DISTINCT FROM '42501' THEN
    RAISE EXCEPTION 'Direct stock UPDATE was not denied as expected';
  END IF;
  UPDATE public.public_stock SET slow=true WHERE venue_id=v AND flavor_id=f;
  GET DIAGNOSTICS changed=ROW_COUNT;
  EXECUTE 'RESET ROLE';
  SELECT revision,slow INTO r1,slow1 FROM public.stock WHERE venue_id=v AND flavor_id=f;
  SELECT count(*) INTO m1 FROM public.moves WHERE venue_id=v;
  IF changed<>1 OR slow1 IS DISTINCT FROM true OR r1 IS DISTINCT FROM r0 OR m1<>m0 THEN
    RAISE EXCEPTION 'Expected bypass not reproduced: rows %, slow %, rev % -> %, moves % -> %',changed,slow1,r0,r1,m0,m1;
  END IF;
  PERFORM set_config('issue90.independent_result',jsonb_build_object(
    'project','qnohynnwasoyjakrrrhb','scope','independent SQL-role reproduction, not HTTP',
    'execution_role',executing_role,'is_staff',staff,'claims','empty',
    'direct_stock_update_sqlstate',direct_error,'public_view_changed_rows',changed,
    'stock_slow_after',slow1,'revision_before',r0,'revision_after',r1,
    'moves_before',m0,'moves_after',m1,'fixture_venue',v,'fixture_flavor',f,
    'cleanup','ROLLBACK, no identity allocation')::text,true);
END $test$;
SELECT current_setting('issue90.independent_result')::jsonb AS result;
ROLLBACK;
