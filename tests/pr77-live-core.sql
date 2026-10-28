-- Run only against mixora-b5-test (qnohynnwasoyjakrrrhb).
-- Synthetic fixtures and results are always rolled back. No production access.
begin;
set local statement_timeout='25s';
create temporary table pr77_core_result(result jsonb);
do $$
declare
 v uuid:=gen_random_uuid(); other uuid:=gen_random_uuid();
 actor bigint:=(9000000000000+floor(random()*1000000000))::bigint;
 fid text:='pr77-'||v; foreign_id text:='pr77-'||other;
 req uuid; input jsonb; output jsonb; v_revision integer:=0; n integer; blocked boolean;
 passed text[]:='{}'; legacy text; identity bigint; remaining integer:=4;
begin
 if not exists(select 1 from public.users where tg_id=700001 and name='B5 Test Manager') then
  raise exception 'Wrong project: isolated B5 fixture required';
 end if;
 insert into public.venues(id) values(v),(other);
 insert into public.users(tg_id,venue_id,name,role) values(actor,v,'PR77 temporary master','master'),(actor+1,v,'PR77 temporary manager','manager'),(actor+2,other,'PR77 temporary foreign','master');
 insert into public.flavors(id,brand,name,strength,pack_g,custom,venue_id) values(fid,'PR77','Shared',5,50,false,null),(foreign_id,'PR77','Foreign',4,100,true,other);
 insert into public.stock(venue_id,flavor_id,wh,bar,stop,stop_auto,slow) values(v,fid,4,false,true,true,true);
 foreach identity in array array[actor,actor+1] loop
  legacy:=case when identity=actor then 'master' else 'manager' end;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',identity::text,'tg_id',identity,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  if public.me_role() is distinct from 'staff' or public.me_venue() is distinct from v then raise exception 'capability mismatch';end if;
  passed:=array_append(passed,legacy||': full staff membership');
  req:=gen_random_uuid();remaining:=remaining-1;
  input:=jsonb_build_array(jsonb_build_object('id',fid,'revision',v_revision,'kind','tobar','doc',jsonb_build_object('wh',remaining,'bar',true,'stop',true,'stopAuto',true,'slow',true)));
  output:=public.apply_stock(req,input);
  if output is distinct from public.apply_stock(req,input) then raise exception 'retry changed result';end if;
  v_revision:=v_revision+1;
  if not exists(select 1 from public.stock where flavor_id=fid and venue_id=v and wh=remaining and stop and stop_auto and slow and bar and stock.revision=v_revision) then raise exception 'state not preserved';end if;
  select count(*) into n from public.moves where operation_id=req and by_tg=identity;
  if n<>1 then raise exception 'duplicate movement or incorrect attribution';end if;
  passed:=array_append(passed,legacy||': atomic RPC, exact retry, stop and slow preserved');
  blocked:=false;
  begin perform public.apply_stock(gen_random_uuid(),input);exception when others then if sqlerrm not like '%stock_stale_revision%' then raise;end if;blocked:=true;end;
  if not blocked then raise exception 'stale revision accepted';end if;
  passed:=array_append(passed,legacy||': stale revision rejected');
  update public.flavors set name='Hacked' where id=fid;get diagnostics n=row_count;
  if n<>0 then raise exception 'shared catalog writable';end if;
  passed:=array_append(passed,legacy||': shared catalog update blocked');
  insert into public.flavor_strengths(venue_id,flavor_id,strength) values(v,fid,8) on conflict(venue_id,flavor_id) do update set strength=excluded.strength;
  insert into public.flavor_packs(venue_id,flavor_id,pack_g) values(v,fid,100) on conflict(venue_id,flavor_id) do update set pack_g=excluded.pack_g;
  if not exists(select 1 from public.flavors where id=fid and strength=5 and pack_g=50) then raise exception 'shared defaults changed';end if;
  passed:=array_append(passed,legacy||': local overrides preserve catalog defaults');
  blocked:=false;
  begin insert into public.flavor_packs values(other,fid,100);exception when insufficient_privilege then blocked:=true;end;
  if not blocked then raise exception 'cross-venue override accepted';end if;
  blocked:=false;
  begin insert into public.flavor_packs values(v,foreign_id,100);exception when insufficient_privilege then blocked:=true;end;
  if not blocked then raise exception 'foreign flavor override accepted';end if;
  passed:=array_append(passed,legacy||': foreign venue and custom flavor rejected');
  execute 'reset role';
 end loop;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',(actor+2)::text,'tg_id',actor+2,'role','authenticated','venue_id',v)::text,true);
 execute 'set local role authenticated';
 if exists(select 1 from public.flavor_packs where flavor_id=fid) or exists(select 1 from public.flavor_strengths where flavor_id=fid) then raise exception 'foreign private settings visible';end if;
 if public.me_venue() is distinct from other then raise exception 'forged venue expanded access';end if;
 passed:=array_append(passed,'foreign venue: private settings hidden and forged claim ignored');
 execute 'reset role';
 if has_table_privilege('authenticated','public.stock','UPDATE') or has_table_privilege('authenticated','public.moves','DELETE') then raise exception 'direct stock or journal privilege restored';end if;
 if has_function_privilege('anon','public.apply_stock(uuid,jsonb)','EXECUTE') then raise exception 'anonymous RPC exposed';end if;
 passed:=array_append(passed,'ACL: direct stock update, journal deletion and anonymous RPC denied');
 perform set_config('request.jwt.claims','{}',true);
 execute 'set local role anon';
 if not exists(select 1 from public.flavor_strengths where venue_id=v and flavor_id=fid and strength=8) then raise exception 'guest strength missing';end if;
 if exists(select 1 from public.flavors where id=foreign_id) then raise exception 'private flavor exposed to guest';end if;
 passed:=array_append(passed,'guest: public strength available and private custom flavor hidden');
 execute 'reset role';
 insert into pr77_core_result values(jsonb_build_object('project','qnohynnwasoyjakrrrhb','engine',version(),'passed',cardinality(passed),'tests',passed,'cleanup','ROLLBACK'));
end$$;
select result from pr77_core_result;
rollback;
