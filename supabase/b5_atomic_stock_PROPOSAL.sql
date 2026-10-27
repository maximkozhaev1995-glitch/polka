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
create or replace function mixora_internal.commit_stock_batch(p_operation_id uuid,p_items jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $body$
declare
 v_tg bigint; v_venue uuid; v_role text; v_perms text[];
 v_hash text; v_prior mixora_internal.stock_operations%rowtype;
 v_item jsonb; v_id text; v_delta integer; v_expected integer;
 v_wh integer; v_old_bar boolean; v_auto boolean; v_next integer;
 v_has_bar boolean; v_bar boolean; v_kind text; v_rows jsonb:='[]'::jsonb; v_result jsonb;
begin
 v_tg:=public.me_tg();
 if v_tg is null then raise exception 'Unauthorized' using errcode='42501'; end if;
 select venue_id,role,perms into v_venue,v_role,v_perms from public.users where tg_id=v_tg;
 if v_venue is null or v_role not in ('manager','master') then raise exception 'Forbidden' using errcode='42501'; end if;
 if p_operation_id is null or p_items is null or jsonb_typeof(p_items)<>'array'
    or jsonb_array_length(p_items) not between 1 and 100 then
   raise exception 'Invalid batch' using errcode='22023';
 end if;
 if exists(select 1 from jsonb_array_elements(p_items) a where jsonb_typeof(a)<>'object'
     or nullif(a->>'id','') is null)
    or exists(select 1 from jsonb_array_elements(p_items) a group by a->>'id' having count(*)>1) then
   raise exception 'Invalid or duplicate flavor' using errcode='22023';
 end if;
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
   v_has_bar:=v_item ? 'bar';
   if v_has_bar and (jsonb_typeof(v_item->'bar')<>'boolean'
      or jsonb_typeof(v_item->'expected_bar')<>'boolean') then
     raise exception 'Invalid bar comparison' using errcode='22023';
   end if;
   v_bar:=case when v_has_bar then (v_item->>'bar')::boolean else null end;
   if v_delta=0 and not v_has_bar then raise exception 'Empty change' using errcode='22023'; end if;
   if v_delta<0 and v_role<>'manager' and not ('take'=any(v_perms)) then
     raise exception 'Take forbidden' using errcode='42501'; end if;
   if v_delta>0 and v_role<>'manager' and not ('add'=any(v_perms)) then
     raise exception 'Add forbidden' using errcode='42501'; end if;
   if v_bar is true and v_role<>'manager' and not ('take'=any(v_perms)) then
     raise exception 'Bar forbidden' using errcode='42501'; end if;
   if v_bar is false and v_role<>'manager' and not ('offbar'=any(v_perms)) then
     raise exception 'Offbar forbidden' using errcode='42501'; end if;
   if not exists(select 1 from public.flavors where id=v_id and (venue_id=v_venue or venue_id is null)) then
     raise exception 'Flavor forbidden' using errcode='22023'; end if;
   select wh,bar,stop_auto into v_wh,v_old_bar,v_auto from public.stock
     where venue_id=v_venue and flavor_id=v_id for update;
   if not found then raise exception 'Missing stock row' using errcode='22023'; end if;
   if v_wh<>v_expected or (v_has_bar and v_old_bar is distinct from (v_item->>'expected_bar')::boolean) then
     raise exception 'Stock changed, refresh before retry' using errcode='40001';
   end if;
   v_next:=v_wh+v_delta;
   if v_next<0 then raise exception 'Insufficient stock' using errcode='23514'; end if;
   update public.stock set wh=v_next,bar=coalesce(v_bar,v_old_bar),
     stop=case when v_next>0 and v_auto then false else stop end,
     stop_auto=case when v_next>0 and v_auto then false else stop_auto end
     where venue_id=v_venue and flavor_id=v_id;
   v_kind:=case when v_delta>0 then 'in' when v_delta<0 and v_bar is true then 'tobar'
     when v_delta<0 then 'wo' when v_bar is true then 'tobar' else 'off' end;
   insert into public.moves(venue_id,flavor_id,kind,qty,left_after,prev,bar_to,by_tg,at)
     values(v_venue,v_id,v_kind,v_delta,v_next,
       jsonb_build_object('wh',v_wh,'bar',v_old_bar),v_bar,v_tg,now());
   v_rows:=v_rows||jsonb_build_array(jsonb_build_object('id',v_id,'left',v_next,'delta',v_delta));
 end loop;
 v_result:=jsonb_build_object('applied',true,'rows',v_rows,'operation_id',p_operation_id);
 update mixora_internal.stock_operations set result=v_result where operation_id=p_operation_id;
 return v_result;
end;
$body$;
revoke all on function mixora_internal.commit_stock_batch(uuid,jsonb) from public,anon,authenticated;
grant usage on schema mixora_internal to authenticated;
grant execute on function mixora_internal.commit_stock_batch(uuid,jsonb) to authenticated;
create or replace function public.mixora_commit_stock_batch(p_operation_id uuid,p_items jsonb)
returns jsonb language sql security invoker set search_path=''
as $body$ select mixora_internal.commit_stock_batch(p_operation_id,p_items); $body$;
revoke all on function public.mixora_commit_stock_batch(uuid,jsonb) from public,anon;
grant execute on function public.mixora_commit_stock_batch(uuid,jsonb) to authenticated;
commit;
