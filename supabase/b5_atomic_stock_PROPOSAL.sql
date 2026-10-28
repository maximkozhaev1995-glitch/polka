-- B5 DRAFT ONLY. Review and test in an isolated database; NEVER run directly on production.
-- One PostgreSQL transaction covers all stock updates and movement records.
begin;
create schema if not exists mixora_internal;
revoke all on schema mixora_internal from public;
create table if not exists mixora_internal.stock_operations(
 operation_id uuid primary key, venue_id uuid not null, tg_id bigint not null,
 payload_hash text not null, result jsonb, created_at timestamptz not null default now()
);
revoke all on mixora_internal.stock_operations from public, anon, authenticated;
-- Monotonic versions detect intervening changes, including change-and-change-back.
create sequence if not exists mixora_internal.stock_revision_seq;
alter table public.stock add column if not exists revision bigint not null default 0;
alter table public.moves add column if not exists operation_id uuid;
alter table public.moves add column if not exists reversal_of uuid;
create table if not exists mixora_internal.stock_effects(
 operation_id uuid not null, flavor_id text not null, before_state jsonb not null,
 after_revision bigint not null, primary key(operation_id,flavor_id)
);
create table if not exists mixora_internal.stock_reversals(
 original_id uuid primary key, reversal_id uuid unique not null
);
revoke all on all tables in schema mixora_internal from public,anon,authenticated;
revoke all on all sequences in schema mixora_internal from public,anon,authenticated;
create or replace function mixora_internal.bump_stock_revision()
returns trigger language plpgsql security definer set search_path='' as $rev$
begin new.revision:=nextval('mixora_internal.stock_revision_seq');return new;end;
$rev$;
revoke all on function mixora_internal.bump_stock_revision() from public,anon,authenticated;
drop trigger if exists mixora_stock_revision on public.stock;
create trigger mixora_stock_revision before insert or update on public.stock
 for each row execute function mixora_internal.bump_stock_revision();
create or replace function mixora_internal.commit_stock_batch(p_operation_id uuid,p_items jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $body$
declare
 v_tg bigint; v_venue uuid; v_role text; v_perms text[];
 v_before jsonb; v_revision bigint; v_hash text; v_prior mixora_internal.stock_operations%rowtype;
 v_item jsonb; v_id text; v_delta integer; v_expected integer;
 v_wh integer; v_old_bar boolean; v_auto boolean; v_next integer;
 v_has_bar boolean; v_bar boolean; v_kind text; v_rows jsonb:='[]'::jsonb; v_result jsonb;
begin
 v_tg:=public.me_tg();
 if v_tg is null then raise exception 'Unauthorized' using errcode='42501'; end if;
 select venue_id,role,array_remove(coalesce(perms,'{}'::text[]),null) into v_venue,v_role,v_perms from public.users where tg_id=v_tg for share;
 if v_venue is null or v_role is null or v_role not in ('manager','master') then raise exception 'Forbidden' using errcode='42501'; end if;
 if p_operation_id is null or p_items is null or jsonb_typeof(p_items)<>'array'
    or jsonb_array_length(p_items) not between 1 and 100 then
   raise exception 'Invalid batch' using errcode='22023';
 end if;
 if exists(select 1 from jsonb_array_elements(p_items) a where jsonb_typeof(a)<>'object'
     or nullif(a->>'id','') is null)
    or exists(select 1 from jsonb_array_elements(p_items) a group by a->>'id' having count(*)>1) then
   raise exception 'Invalid or duplicate flavor' using errcode='22023';
 end if;
 select jsonb_agg(value order by value->>'id') into p_items from jsonb_array_elements(p_items);
 v_hash:=md5(p_items::text);
 insert into mixora_internal.stock_operations(operation_id,venue_id,tg_id,payload_hash)
 values(p_operation_id,v_venue,v_tg,v_hash) on conflict(operation_id) do nothing;
 select * into v_prior from mixora_internal.stock_operations where operation_id=p_operation_id for update;
 if v_prior.venue_id is distinct from v_venue or v_prior.tg_id is distinct from v_tg
    or v_prior.payload_hash is distinct from v_hash then
   raise exception 'Idempotency key reused' using errcode='23505';
 end if;
 if v_prior.result is not null then return v_prior.result; end if;
 for v_item in select value from jsonb_array_elements(p_items) order by value->>'id' loop
   v_id:=v_item->>'id';
   if (v_item->>'delta') is null or (v_item->>'delta') !~ '^-?[0-9]{1,9}$'
      or (v_item->>'expected_wh') is null or (v_item->>'expected_wh') !~ '^[0-9]{1,9}$' then
     raise exception 'Invalid quantity' using errcode='22023';
   end if;
   v_delta:=(v_item->>'delta')::integer; v_expected:=(v_item->>'expected_wh')::integer;
   if (v_item ? 'bar') <> (v_item ? 'expected_bar') then
     raise exception 'Invalid bar comparison' using errcode='22023'; end if;
   if exists(select 1 from jsonb_object_keys(v_item) k
       where k not in ('id','delta','expected_wh','bar','expected_bar')) then
     raise exception 'Invalid item payload' using errcode='22023'; end if;
   v_has_bar:=v_item ? 'bar';
   if v_has_bar and (jsonb_typeof(v_item->'bar') is distinct from 'boolean'
      or jsonb_typeof(v_item->'expected_bar') is distinct from 'boolean') then
     raise exception 'Invalid bar comparison' using errcode='22023';
   end if;
   v_bar:=case when v_has_bar then (v_item->>'bar')::boolean else null end;
   if v_delta<0 and v_role<>'manager' and not ('take'=any(v_perms)) then
     raise exception 'Take forbidden' using errcode='42501'; end if;
   if v_delta>0 and v_role<>'manager' and not ('add'=any(v_perms)) then
     raise exception 'Add forbidden' using errcode='42501'; end if;
   -- SHARE also blocks non-key venue_id updates, unlike KEY SHARE alone.
   perform 1 from public.flavors where id=v_id and (venue_id=v_venue or venue_id is null) for share;
   if not found then raise exception 'Flavor forbidden' using errcode='22023'; end if;
   insert into public.stock(venue_id,flavor_id,wh,bar,stop,stop_auto)
     values(v_venue,v_id,0,false,false,false)
     on conflict(venue_id,flavor_id) do nothing;
   select wh,coalesce(bar,false),coalesce(stop_auto,false) into v_wh,v_old_bar,v_auto from public.stock
     where venue_id=v_venue and flavor_id=v_id for update;
   if not found then raise exception 'Missing stock row' using errcode='22023'; end if;
   if v_wh is distinct from v_expected or (v_has_bar and v_old_bar is distinct from (v_item->>'expected_bar')::boolean) then
     raise exception 'Stock changed, refresh before retry' using errcode='40001';
   end if;
   if v_delta=0 and (not v_has_bar or v_bar is not distinct from v_old_bar) then
     raise exception 'Empty change' using errcode='22023'; end if;
   if v_has_bar and v_bar is distinct from v_old_bar then
     if v_bar is true and v_role<>'manager' and not ('take'=any(v_perms)) then
       raise exception 'Bar forbidden' using errcode='42501'; end if;
     if v_bar is false and v_role<>'manager' and not ('offbar'=any(v_perms)) then
       raise exception 'Offbar forbidden' using errcode='42501'; end if;
   end if;
   select to_jsonb(s) into v_before from public.stock s where venue_id=v_venue and flavor_id=v_id;
   if v_delta<0 and not coalesce(v_bar,v_old_bar) and v_role<>'manager' then
     raise exception 'Write-off requires manager' using errcode='42501';end if;
   v_next:=v_wh+v_delta;
   if v_next<0 then raise exception 'Insufficient stock' using errcode='23514'; end if;
   update public.stock set wh=v_next,bar=coalesce(v_bar,v_old_bar),
     stop=case when v_next>0 and v_auto then false else stop end,
     stop_auto=case when v_next>0 and v_auto then false else stop_auto end
     where venue_id=v_venue and flavor_id=v_id;
   select revision into v_revision from public.stock where venue_id=v_venue and flavor_id=v_id;
   insert into mixora_internal.stock_effects values(p_operation_id,v_id,v_before,v_revision);
   v_kind:=case when v_delta>0 then 'in' when v_delta<0 and coalesce(v_bar,v_old_bar) then 'tobar'
     when v_delta<0 then 'wo' when v_bar is true then 'tobar' else 'off' end;
   insert into public.moves(venue_id,flavor_id,kind,qty,left_after,prev,bar_to,by_tg,at,operation_id)
     values(v_venue,v_id,v_kind,v_delta,v_next,
       jsonb_build_object('wh',v_wh,'bar',v_old_bar),v_bar,v_tg,now(),p_operation_id);
   v_rows:=v_rows||jsonb_build_array(jsonb_build_object('id',v_id,'left',v_next,'delta',v_delta));
 end loop;
 v_result:=jsonb_build_object('applied',true,'rows',v_rows,'operation_id',p_operation_id);
 update mixora_internal.stock_operations set result=v_result where operation_id=p_operation_id;
 return v_result;
end;
$body$;
revoke all on function mixora_internal.commit_stock_batch(uuid,jsonb) from public,anon,authenticated;
revoke all on schema mixora_internal from authenticated;
revoke all on function mixora_internal.commit_stock_batch(uuid,jsonb) from authenticated;
create or replace function public.mixora_commit_stock_batch(p_operation_id uuid,p_items jsonb)
returns jsonb language sql security definer set search_path=''
as $body$ select mixora_internal.commit_stock_batch(p_operation_id,p_items); $body$;
revoke all on function public.mixora_commit_stock_batch(uuid,jsonb) from public,anon;
grant execute on function public.mixora_commit_stock_batch(uuid,jsonb) to authenticated;
-- Preserve the legacy trigger guard, but allow the RPC's automatic stop removal.
-- Direct table DML remains revoked below. Manual stop removal still requires unstop.
create or replace function public.enforce_master_stock()
returns trigger language plpgsql security definer set search_path=''
as $guard$
declare r text; p text[];
begin
 select role,array_remove(coalesce(perms,'{}'::text[]),null) into r,p
   from public.users where tg_id=public.me_tg();
 if r is distinct from 'master' then return new; end if;
 if new.wh is distinct from old.wh and not ('take'=any(p) or 'add'=any(p)) then
   raise exception 'Stock forbidden' using errcode='42501'; end if;
 if coalesce(new.bar,false) is distinct from coalesce(old.bar,false) and not ('take'=any(p) or 'offbar'=any(p)) then
   raise exception 'Bar forbidden' using errcode='42501'; end if;
 if new.slow is distinct from old.slow and not ('slow'=any(p)) then
   raise exception 'Slow forbidden' using errcode='42501'; end if;
 if new.retired is distinct from old.retired then
   raise exception 'Retire forbidden' using errcode='42501'; end if;
 if old.stop is true and new.stop is not true and not ('unstop'=any(p))
    and not (old.stop_auto is true and new.wh>0 and new.stop_auto is false) then
   raise exception 'Unstop forbidden' using errcode='42501'; end if;
 return new;
end;
$guard$;
revoke all on function public.enforce_master_stock() from public,anon,authenticated;
-- Close Data API writes even when legacy permissive RLS policies exist.
-- Preserve SELECT policies/grants; service_role is not changed.
alter table public.stock enable row level security;
alter table public.moves enable row level security;
alter table mixora_internal.stock_operations enable row level security;
revoke insert,update,delete,truncate,references,trigger on public.stock,public.moves from public,anon,authenticated;
-- Column grants survive table-level REVOKE: remove them too.
do $grants$
declare t text; cols text;
begin
 foreach t in array array['stock','moves'] loop
  select string_agg(quote_ident(column_name),',') into cols
    from information_schema.columns where table_schema='public' and table_name=t;
  execute format('revoke insert (%s), update (%s), references (%s) on public.%I from public,anon,authenticated',cols,cols,cols,t);
 end loop;
end;
$grants$;
-- Explicit business operations. No client-supplied actor, venue, automatic stop or time.
alter table public.inv_log add column if not exists unknown_weight_items integer not null default 0;
alter table public.inv_log add column if not exists operation_id uuid;
alter table public.inv_log add column if not exists reversal_of uuid;
create or replace function public.mixora_stock_action(p_operation_id uuid,p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $action$
declare
 tg bigint; venue uuid; role_name text; permissions text[]; action_name text;
 prior mixora_internal.stock_operations%rowtype; original mixora_internal.stock_operations%rowtype;
 payload_hash text; items jsonb; item jsonb; ident text; before_row public.stock%rowtype;
 desired jsonb; next_wh integer; next_bar boolean; next_stop boolean; next_auto boolean;
 next_slow boolean; next_retired boolean; delta integer; rev bigint; inserted boolean;
 kind_name text; reason_text text; undo_id uuid; result_rows jsonb:='[]'; result_value jsonb;
 unknown_weights integer:=0; shortage integer:=0; grams numeric:=0; price numeric; group_name text; flavor public.flavors%rowtype;
begin
 tg:=public.me_tg();
 if tg is null then raise exception 'Unauthorized' using errcode='42501';end if;
 select u.venue_id,u.role,array_remove(coalesce(u.perms,'{}'::text[]),null)
 into venue,role_name,permissions from public.users u where u.tg_id=tg for share;
 if venue is null or role_name is null or role_name not in ('manager','master') then
 raise exception 'Forbidden' using errcode='42501';end if;
 if p_operation_id is null or jsonb_typeof(p_request) is distinct from 'object' then
 raise exception 'Invalid request' using errcode='22023';end if;
 action_name:=p_request->>'action';
 if action_name is null or action_name not in ('change','finish','inventory','create','undo')
 or exists(select 1 from jsonb_object_keys(p_request) k where k not in ('action','items','original_id','flavor','ig','price')) then
 raise exception 'Invalid action' using errcode='22023';end if;
 if action_name in ('inventory','create','undo') and role_name<>'manager' then
 raise exception 'Manager required' using errcode='42501';end if;
 -- Undo is deliberately manager-only; original actor permissions are not reused.
 items:=p_request->'items';
 if action_name<>'undo' then
 if jsonb_typeof(items) is distinct from 'array' or jsonb_array_length(items) not between 1 and 100 then
 raise exception 'Invalid items' using errcode='22023';end if;
 if exists(select 1 from jsonb_array_elements(items) i where jsonb_typeof(i)<>'object' or nullif(i->>'id','') is null)
 or exists(select 1 from jsonb_array_elements(items) i group by i->>'id' having count(*)>1) then
 raise exception 'Duplicate or invalid item' using errcode='22023';end if;
 select jsonb_agg(value order by value->>'id') into items from jsonb_array_elements(items);
 p_request:=jsonb_set(p_request,'{items}',items);
 end if;
 payload_hash:=md5('action:'||p_request::text);
 insert into mixora_internal.stock_operations(operation_id,venue_id,tg_id,payload_hash)
 values(p_operation_id,venue,tg,payload_hash) on conflict do nothing;
 select * into prior from mixora_internal.stock_operations o where o.operation_id=p_operation_id for update;
 if prior.venue_id is distinct from venue or prior.tg_id is distinct from tg or prior.payload_hash is distinct from payload_hash then
 raise exception 'Idempotency key reused' using errcode='23505';end if;
 if prior.result is not null then return prior.result;end if;
 if action_name='undo' then
 undo_id:=(p_request->>'original_id')::uuid;
 if undo_id is null or undo_id=p_operation_id then raise exception 'Invalid original' using errcode='22023';end if;
 select * into original from mixora_internal.stock_operations o where o.operation_id=undo_id for update;
 if not found or original.venue_id<>venue or original.result is null then raise exception 'Original unavailable' using errcode='42501';end if;
 if exists(select 1 from mixora_internal.stock_reversals where reversal_id=undo_id) then
 raise exception 'Cannot undo a compensation' using errcode='22023';end if;
 if exists(select 1 from mixora_internal.stock_reversals where stock_reversals.original_id=original.operation_id) then
 raise exception 'Already compensated' using errcode='23505';end if;
 select jsonb_agg(jsonb_build_object('id',flavor_id,'revision',after_revision::text,'state',before_state) order by flavor_id)
 into items from mixora_internal.stock_effects e where e.operation_id=undo_id;
 if items is null then raise exception 'Legacy operation cannot be undone' using errcode='22023';end if;
 insert into mixora_internal.stock_reversals values(undo_id,p_operation_id);
 end if;
 if action_name='create' then
 if jsonb_array_length(items)<>1 or jsonb_typeof(p_request->'flavor') is distinct from 'object'
 or nullif(trim(p_request->'flavor'->>'brand'),'') is null or nullif(trim(p_request->'flavor'->>'name'),'') is null
 or exists(select 1 from jsonb_object_keys(p_request->'flavor') k where k not in ('brand','line','name','descr')) then
 raise exception 'Invalid flavor' using errcode='22023';end if;
 insert into public.flavors(id,venue_id,brand,line,name,descr,custom)
 values(items->0->>'id',venue,trim(p_request->'flavor'->>'brand'),coalesce(p_request->'flavor'->>'line',''),
 trim(p_request->'flavor'->>'name'),coalesce(p_request->'flavor'->>'descr',''),true);
 end if;
 if action_name='inventory' then
 group_name:=p_request->>'ig';
 if group_name is null or group_name not in ('main','cigar','perfume') or coalesce(p_request->>'price','0') !~ '^[0-9]{1,7}(\.[0-9]{1,4})?$' then
 raise exception 'Invalid inventory' using errcode='22023';end if;
 price:=coalesce(p_request->>'price','0')::numeric;
 end if;
 for item in select value from jsonb_array_elements(items) order by value->>'id' loop
 ident:=item->>'id';desired:=item->'state';
 if jsonb_typeof(desired) is distinct from 'object' or (item->>'revision') is null or item->>'revision' !~ '^[0-9]{1,19}$' then
 raise exception 'Expected revision required' using errcode='22023';end if;
 if action_name<>'undo' and (exists(select 1 from jsonb_object_keys(item) k where k not in ('id','revision','state','kind','reason'))
 or exists(select 1 from jsonb_object_keys(desired) k where k not in ('wh','bar','stop','slow','retired'))) then
 raise exception 'Invalid state patch' using errcode='22023';end if;
 select * into flavor from public.flavors f where f.id=ident and (f.venue_id=venue or f.venue_id is null) for share;
 if not found then raise exception 'Flavor forbidden' using errcode='22023';end if;
 if action_name='inventory' and group_name is distinct from
 (case when flavor.brand='Kraken' and coalesce(flavor.line,'') not in ('Medium Seco','Strong Ligero') then 'cigar'
 when flavor.brand='Deus' and flavor.line='Perfume' then 'perfume' else 'main' end) then
 raise exception 'Inventory group mismatch' using errcode='22023';end if;
 insert into public.stock(venue_id,flavor_id,wh,bar,stop,stop_auto,slow,retired)
 values(venue,ident,0,false,false,false,false,false) on conflict do nothing;
 inserted:=found;
 select * into before_row from public.stock s where s.venue_id=venue and s.flavor_id=ident for update;
 if (not inserted and before_row.revision<>(item->>'revision')::bigint) or (inserted and (item->>'revision')::bigint<>0) then
 raise exception 'Stock changed' using errcode='40001';end if;
 if desired ? 'wh' and (desired->>'wh' is null or desired->>'wh' !~ '^[0-9]{1,9}$') then
 raise exception 'Invalid quantity' using errcode='22023';end if;
 if action_name<>'undo' and exists(select 1 from jsonb_each(desired) e where e.key in ('bar','stop','slow','retired') and jsonb_typeof(e.value)<>'boolean') then
 raise exception 'Invalid flag' using errcode='22023';end if;
 next_wh:=coalesce((desired->>'wh')::integer,before_row.wh,0);
 next_bar:=coalesce((desired->>'bar')::boolean,before_row.bar,false);
 next_stop:=coalesce((desired->>'stop')::boolean,before_row.stop,false);
 next_slow:=coalesce((desired->>'slow')::boolean,before_row.slow,false);
 next_retired:=coalesce((desired->>'retired')::boolean,before_row.retired,false);
 if action_name='undo' then
 next_bar:=coalesce((desired->>'bar')::boolean,false);next_stop:=coalesce((desired->>'stop')::boolean,false);
 next_slow:=coalesce((desired->>'slow')::boolean,false);next_retired:=coalesce((desired->>'retired')::boolean,false);
 end if;
 next_auto:=coalesce(before_row.stop_auto,false);
 if action_name='undo' and original.result->>'action'='create' then next_retired:=true;end if;
 if action_name='undo' then next_auto:=coalesce((desired->>'stop_auto')::boolean,false);
 elsif desired ? 'stop' then next_auto:=false;end if;
 if action_name='finish' then
 if jsonb_array_length(items)<>1 or desired<>'{}'::jsonb then raise exception 'Invalid finish' using errcode='22023';end if;
 if before_row.wh>0 then next_wh:=before_row.wh-1;
 else next_bar:=false;next_stop:=true;next_auto:=true;end if;
 end if;
 delta:=next_wh-coalesce(before_row.wh,0);
 kind_name:=case when action_name='inventory' then 'inv' when action_name='finish' then 'fin'
 when delta>0 then 'in' when delta<0 and next_bar then 'tobar' when delta<0 then 'wo' when next_bar then 'tobar' else 'off' end;
 reason_text:=nullif(item->>'reason','');
 if item ? 'kind' and (action_name<>'change' or item->>'kind' is distinct from 'wo' or delta>=0) then
 raise exception 'Invalid movement kind' using errcode='22023';end if;
 if (item->>'kind'='wo' or kind_name='wo') and action_name<>'undo' then
 if role_name<>'manager' or (reason_text is null and action_name not in ('inventory','finish')) then raise exception 'Write-off needs manager and reason' using errcode='42501';end if;
 kind_name:='wo';end if;
 if item ? 'kind' and item->>'kind' not in ('wo','in','off','tobar') then raise exception 'Invalid kind' using errcode='22023';end if;
 if role_name<>'manager' then
 if delta>0 and not ('add'=any(permissions)) or delta<0 and not ('take'=any(permissions))
 or next_bar and not coalesce(before_row.bar,false) and not ('take'=any(permissions))
 or not next_bar and coalesce(before_row.bar,false) and not ('offbar'=any(permissions))
 or next_slow is distinct from coalesce(before_row.slow,false) and not ('slow'=any(permissions))
 or next_retired is distinct from coalesce(before_row.retired,false)
 or coalesce(before_row.stop,false) and not next_stop and not ('unstop'=any(permissions))
 and not (before_row.stop_auto is true and delta>0 and next_wh>0) then
 raise exception 'Transition forbidden' using errcode='42501';end if;
 end if;
 if action_name<>'undo' and delta>0 and next_wh>0 and next_auto then next_stop:=false;next_auto:=false;end if;
 if action_name not in ('create','undo') and
 (next_wh,next_bar,next_stop,next_auto,next_slow,next_retired) is not distinct from
 (coalesce(before_row.wh,0),coalesce(before_row.bar,false),coalesce(before_row.stop,false),coalesce(before_row.stop_auto,false),coalesce(before_row.slow,false),coalesce(before_row.retired,false)) then
 raise exception 'Empty change' using errcode='22023';end if;
 if action_name in ('inventory','create') and exists(select 1 from jsonb_object_keys(desired) k where k<>'wh') then
 raise exception 'Quantity-only operation' using errcode='22023';end if;
 if action_name='inventory' and delta<0 then shortage:=shortage-delta;grams:=grams-delta*coalesce(flavor.pack_g,0);if flavor.pack_g is null then unknown_weights:=unknown_weights+1;end if;end if;
 update public.stock set wh=next_wh,bar=next_bar,stop=next_stop,stop_auto=next_auto,slow=next_slow,retired=next_retired
 where venue_id=venue and flavor_id=ident returning revision into rev;
 insert into mixora_internal.stock_effects values(p_operation_id,ident,to_jsonb(before_row),rev);
 insert into public.moves(venue_id,flavor_id,kind,qty,left_after,prev,bar_to,by_tg,at,reason,operation_id,reversal_of)
 values(venue,ident,kind_name,delta,next_wh,to_jsonb(before_row),next_bar,tg,now(),
 case when action_name='undo' then 'Отмена операции '||undo_id else reason_text end,p_operation_id,undo_id);
 result_rows:=result_rows||jsonb_build_array(jsonb_build_object('id',ident,'left',next_wh,'revision',rev::text));
 end loop;
 if action_name='inventory' then
 insert into public.inv_log(venue_id,ig,items,shortage_units,shortage_g,price_per_g,shortage_rub,by_tg,operation_id,unknown_weight_items)
 values(venue,group_name,jsonb_array_length(items),shortage,grams,price,round(grams*price),tg,p_operation_id,unknown_weights);
 elsif action_name='undo' then
 insert into public.inv_log(venue_id,ig,items,shortage_units,shortage_g,price_per_g,shortage_rub,by_tg,operation_id,reversal_of,unknown_weight_items)
 select venue,l.ig,l.items,-l.shortage_units,-l.shortage_g,l.price_per_g,-l.shortage_rub,tg,p_operation_id,undo_id,l.unknown_weight_items
 from public.inv_log l where l.operation_id=undo_id;
 end if;
 result_value:=jsonb_build_object('action',action_name,'applied',true,'operation_id',p_operation_id,'rows',result_rows);
 update mixora_internal.stock_operations set result=result_value where operation_id=p_operation_id;
 return result_value;
end;
$action$;
revoke all on function public.mixora_stock_action(uuid,jsonb) from public,anon;
grant execute on function public.mixora_stock_action(uuid,jsonb) to authenticated;
revoke insert,update,delete,truncate,references,trigger on public.inv_log from public,anon,authenticated;
do $acl$ declare cols text;begin
 select string_agg(quote_ident(column_name),',') into cols from information_schema.columns where table_schema='public' and table_name='inv_log';
 execute format('revoke insert (%s),update (%s),references (%s) on public.inv_log from public,anon,authenticated',cols,cols,cols);
end;$acl$;

-- Prevent catalog deletes/key/venue changes from cascading into stock outside RPCs.
revoke insert,update,delete,truncate,references,trigger on public.flavors from public,anon,authenticated;
do $catalog_acl$ declare cols text;begin
 select string_agg(quote_ident(column_name),',') into cols from information_schema.columns where table_schema='public' and table_name='flavors';
 execute format('revoke insert (%s),update (%s),references (%s) on public.flavors from public,anon,authenticated',cols,cols,cols);
end;$catalog_acl$;
grant update(strength,pack_g) on public.flavors to authenticated;
-- Invoker rights preserve the underlying movement RLS; no private ledger exposure.
create or replace view public.mixora_stock_moves with (security_invoker=true) as
 select m.*,exists(select 1 from public.moves r where r.venue_id=m.venue_id and r.reversal_of=m.operation_id) as compensated
 from public.moves m;
grant select on public.mixora_stock_moves to authenticated;
commit;
