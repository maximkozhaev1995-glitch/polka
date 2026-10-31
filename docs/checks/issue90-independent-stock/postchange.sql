-- Independent post-change checks; execute only after approved author change confirmed.
-- TEST project qnohynnwasoyjakrrrhb only. Synthetic fixtures; no DELETE or DDL.
BEGIN;
SET LOCAL statement_timeout='25s';
SET LOCAL lock_timeout='3s';
DO $test$
DECLARE
 v uuid:=gen_random_uuid(); f text:='issue90-post-independent-'||v::text;
 actor bigint:=(9200000000000+floor(random()*1000000000))::bigint;
 mid uuid:=gen_random_uuid(); req uuid:=gen_random_uuid();
 api_role text; object_name text; col_name text;
 rejected boolean; visible_s integer; visible_m integer; changed integer;
 tests text[]:='{}'; rpc_result jsonb;
BEGIN
 INSERT INTO public.venues(id,name) VALUES(v,'issue90 independent post-change fixture');
 INSERT INTO public.users(tg_id,venue_id,name,role) VALUES(actor,v,'issue90 independent test manager','manager');
 INSERT INTO public.flavors(id,brand,name,custom,venue_id)
  VALUES(f,'ISSUE90 INDEPENDENT SYNTHETIC','Transaction-local test fixture',false,null);
 INSERT INTO public.stock(venue_id,flavor_id,wh,bar,stop,retired,slow)
  VALUES(v,f,2,true,false,false,false);
 INSERT INTO public.mixes(id,venue_id,title,note,tags,parts,in_karta,hidden)
  VALUES(mid,v,'Independent fixture mix','synthetic',ARRAY[]::text[],
   jsonb_build_array(jsonb_build_object('id',f,'pct',50),jsonb_build_object('id',f,'pct',50)),true,false);
 FOREACH api_role IN ARRAY ARRAY['anon','authenticated'] LOOP
  FOREACH object_name IN ARRAY ARRAY['public.public_stock','public.public_mixes'] LOOP
   IF NOT has_table_privilege(api_role,object_name,'SELECT') OR
      has_table_privilege(api_role,object_name,'INSERT') OR
      has_table_privilege(api_role,object_name,'UPDATE') OR
      has_table_privilege(api_role,object_name,'DELETE') THEN
      RAISE EXCEPTION 'Incorrect effective table privileges for % on %',api_role,object_name;
   END IF;
   FOR col_name IN SELECT attname FROM pg_attribute WHERE attrelid=object_name::regclass AND attnum>0 AND NOT attisdropped LOOP
    IF has_column_privilege(api_role,object_name,col_name,'INSERT') OR has_column_privilege(api_role,object_name,col_name,'UPDATE') THEN
      RAISE EXCEPTION 'Column mutation privilege remains for % on %.%',api_role,object_name,col_name;
    END IF;
   END LOOP;
  END LOOP;
  PERFORM set_config('request.jwt.claims',CASE WHEN api_role='anon' THEN '{}' ELSE
   jsonb_build_object('sub',actor::text,'tg_id',actor,'role','authenticated')::text END,true);
  EXECUTE format('SET LOCAL ROLE %I',api_role);
  IF current_user<>api_role THEN RAISE EXCEPTION 'Wrong role'; END IF;
  SELECT count(*) INTO visible_s FROM public.public_stock WHERE venue_id=v AND flavor_id=f;
  SELECT count(*) INTO visible_m FROM public.public_mixes WHERE id=mid;
  IF visible_s<>1 OR visible_m<>1 THEN RAISE EXCEPTION 'Published menu invisible to %',api_role; END IF;
  rejected:=false;
  BEGIN UPDATE public.public_stock SET slow=true WHERE venue_id=v AND flavor_id=f;
  EXCEPTION WHEN insufficient_privilege THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Stock view UPDATE accepted for %',api_role; END IF;
  rejected:=false;
  BEGIN UPDATE public.public_mixes SET title='Forbidden change' WHERE id=mid;
  EXCEPTION WHEN insufficient_privilege THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Mix view UPDATE accepted for %',api_role; END IF;
  rejected:=false;
  BEGIN INSERT INTO public.public_stock(venue_id,flavor_id,slow) VALUES(v,f,true);
  EXCEPTION WHEN insufficient_privilege THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Stock view INSERT accepted for %',api_role; END IF;
  rejected:=false;
  BEGIN INSERT INTO public.public_mixes(id,title) VALUES(mid,'Forbidden insert');
  EXCEPTION WHEN insufficient_privilege THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Mix view INSERT accepted for %',api_role; END IF;
  EXECUTE 'RESET ROLE';
  tests:=array_append(tests,api_role||': SELECT both views preserved; INSERT/UPDATE both views denied 42501; DELETE denied by effective privilege check without executing DELETE');
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM public.stock WHERE venue_id=v AND flavor_id=f AND wh=2 AND revision=0 AND NOT slow) OR
    NOT EXISTS(SELECT 1 FROM public.mixes WHERE id=mid AND title='Independent fixture mix') OR
    EXISTS(SELECT 1 FROM public.moves WHERE venue_id=v) THEN
   RAISE EXCEPTION 'Rejected view mutations altered fixture state';
 END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor::text,'tg_id',actor,'role','authenticated')::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 IF NOT public.is_staff() THEN RAISE EXCEPTION 'Staff fixture invalid'; END IF;
 rpc_result:=public.apply_stock(req,jsonb_build_array(jsonb_build_object('id',f,'revision',0,'doc',jsonb_build_object('wh',1,'bar',true))));
 UPDATE public.mixes SET title='Allowed own-venue staff edit' WHERE id=mid AND venue_id=v;
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed<>1 THEN RAISE EXCEPTION 'Staff base mix update blocked'; END IF;
 EXECUTE 'RESET ROLE';
 IF NOT EXISTS(SELECT 1 FROM public.stock WHERE venue_id=v AND flavor_id=f AND wh=1 AND revision=1) THEN
   RAISE EXCEPTION 'Staff apply_stock failed correct quantity/revision';
 END IF;
 IF (SELECT count(*) FROM public.moves WHERE venue_id=v)<>1 OR
    NOT EXISTS(SELECT 1 FROM public.moves WHERE operation_id=req AND venue_id=v AND by_tg=actor AND stock_revision=1 AND left_after=1 AND prev->>'wh'='2' AND next_state->>'wh'='1') THEN
   RAISE EXCEPTION 'Staff movement log incorrect';
 END IF;
 IF (SELECT count(*) FROM mixora_private.stock_requests WHERE venue_id=v AND request_id=req)<>1 THEN
   RAISE EXCEPTION 'Staff idempotency record missing';
 END IF;
 tests:=array_append(tests,'Authenticated own-venue apply_stock updates quantity 2 to 1, revision 0 to 1, creates one attributed movement');
 tests:=array_append(tests,'Authenticated own-venue base mixes edit remains allowed');
 PERFORM set_config('issue90.independent_postchange',jsonb_build_object(
  'project','qnohynnwasoyjakrrrhb','tests',tests,'level','independent SQL roles, not HTTP',
  'cleanup','ROLLBACK; one movement identity allocation may remain as sequence gap')::text,true);
END $test$;
SELECT current_setting('issue90.independent_postchange')::jsonb AS result;
ROLLBACK;
