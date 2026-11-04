-- Deploy with the RPC-aware client. The old whole-document writer loses access.
begin;

alter table public.orders add column revision bigint not null default 0;

create table mixora_private.order_requests (
  venue_id uuid not null,
  request_id uuid not null,
  actor bigint not null,
  changes jsonb not null,
  result jsonb not null,
  primary key (venue_id, request_id)
);
alter table mixora_private.order_requests enable row level security;
revoke all on mixora_private.order_requests from public, anon, authenticated;

revoke insert, update, delete, truncate on public.orders from public, anon, authenticated;
do $$
declare cols text;
begin
  select string_agg(quote_ident(attname), ',') into cols
  from pg_catalog.pg_attribute where attrelid='public.orders'::regclass and attnum>0 and not attisdropped;
  execute format('revoke insert (%s), update (%s) on public.orders from public, anon, authenticated', cols, cols);
end $$;

create function mixora_private.apply_order(p_venue_id uuid, p_request_id uuid, p_changes jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor_id bigint := public.me_tg();
  venue uuid;
  saved public.orders%rowtype;
  receipt mixora_private.order_requests%rowtype;
  item jsonb;
  doc jsonb;
  current_value jsonb;
  target_path text[];
  conflicts jsonb := '[]'::jsonb;
  result jsonb;
begin
  select u.venue_id into venue from public.users u where u.tg_id = actor_id for share;
  if venue is null then raise exception 'order_forbidden' using errcode='42501'; end if;
  if venue is distinct from p_venue_id then raise exception 'order_scope_changed' using errcode='42501'; end if;
  if p_request_id is null or jsonb_typeof(p_changes) is distinct from 'array' then
    raise exception 'order_invalid_request';
  end if;
  if jsonb_array_length(p_changes) not between 1 and 4000 then
    raise exception 'order_invalid_request';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_changes) e
    where jsonb_typeof(e) <> 'object' or not (e ?& array['map','id','before','after'])
      or coalesce(e->>'map','') not in ('q','m') or jsonb_typeof(e->'id') <> 'string'
      or coalesce(length(e->>'id'),0) not between 1 and 256
      or e->>'id' in ('__proto__','constructor','prototype')
      or (e->>'map'='q' and jsonb_typeof(e->'after') not in ('null','number'))
      or (e->>'map'='q' and jsonb_typeof(e->'after')='number' and (e->>'after') !~ '^[1-9][0-9]*$')
      or (e->>'map'='m' and jsonb_typeof(e->'after') not in ('null','object'))
      or (e->>'map'='m' and jsonb_typeof(e->'after')='object' and (
        jsonb_typeof(e->'after'->'q') is distinct from 'number' or coalesce(e->'after'->>'q','') !~ '^[1-9][0-9]*$'
        or jsonb_typeof(e->'after'->'b') is distinct from 'string'
        or jsonb_typeof(e->'after'->'n') is distinct from 'string'
        or (e->'after' ? 'wids' and jsonb_typeof(e->'after'->'wids')<>'array')
      ))
  ) or exists (
    select 1 from jsonb_array_elements(p_changes) e group by e->>'map',e->>'id' having count(*)>1
  ) then raise exception 'order_invalid_request'; end if;

  insert into public.orders(venue_id,items) values (venue,'{"q":{},"m":{}}')
    on conflict(venue_id) do nothing;
  select * into strict saved from public.orders o where o.venue_id=venue for update;
  select * into receipt from mixora_private.order_requests r where r.venue_id=venue and r.request_id=p_request_id;
  if found then
    if receipt.actor<>actor_id or receipt.changes<>p_changes then raise exception 'order_idempotency_conflict'; end if;
    return receipt.result;
  end if;

  doc := case when jsonb_typeof(saved.items)='object' then saved.items else '{}'::jsonb end;
  doc := doc || jsonb_build_object(
    'q',case when jsonb_typeof(doc->'q')='object' then doc->'q' else '{}'::jsonb end,
    'm',case when jsonb_typeof(doc->'m')='object' then doc->'m' else '{}'::jsonb end
  );
  for item in select value from jsonb_array_elements(p_changes) loop
    target_path := array[item->>'map',item->>'id'];
    current_value := coalesce(doc #> target_path,'null'::jsonb);
    if current_value is distinct from item->'before' then
      conflicts := conflicts || jsonb_build_array(item || jsonb_build_object('current',current_value));
    end if;
  end loop;
  if conflicts = '[]'::jsonb then
    for item in select value from jsonb_array_elements(p_changes) loop
      target_path := array[item->>'map',item->>'id'];
      doc := case when item->'after'='null'::jsonb then doc #- target_path
                  else jsonb_set(doc,target_path,item->'after',true) end;
    end loop;
    update public.orders o set items=doc, revision=o.revision+1, updated_at=clock_timestamp()
      where o.venue_id=venue returning o.revision into saved.revision;
    result := jsonb_build_object('status','applied');
  else
    result := jsonb_build_object('status','conflict','conflicts',conflicts);
  end if;
  result := result || jsonb_build_object('order',jsonb_build_object('q',doc->'q','m',doc->'m','revision',saved.revision));
  insert into mixora_private.order_requests values (venue,p_request_id,actor_id,p_changes,result);
  return result;
end $$;
revoke all on function mixora_private.apply_order(uuid,uuid,jsonb) from public, anon;
grant execute on function mixora_private.apply_order(uuid,uuid,jsonb) to authenticated;

create function public.apply_order(p_venue_id uuid,p_request_id uuid,p_changes jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select mixora_private.apply_order(p_venue_id,p_request_id,p_changes)
$$;
revoke all on function public.apply_order(uuid,uuid,jsonb) from public, anon;
grant execute on function public.apply_order(uuid,uuid,jsonb) to authenticated;

commit;
