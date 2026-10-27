-- B5. Review and run ONLY on an isolated database first. No production apply.
begin;
create schema if not exists mixora_private;
revoke all on schema mixora_private from public;
grant usage on schema mixora_private to authenticated;

alter table public.stock add column revision integer not null default 0;
alter table public.stock add constraint stock_nonnegative_b5 check (wh >= 0);
alter table public.moves add column operation_id uuid;
alter table public.moves add column stock_revision integer;
alter table public.moves add column next_state jsonb;
create unique index moves_operation_item_b5 on public.moves(operation_id, flavor_id);

create table mixora_private.stock_requests (
  venue_id uuid not null,
  request_id uuid not null,
  actor bigint not null,
  payload jsonb not null,
  result jsonb,
  primary key (venue_id, request_id)
);
alter table mixora_private.stock_requests enable row level security;
revoke all on mixora_private.stock_requests from public, anon, authenticated;

-- Legacy policies must not allow clients to bypass the journal or forge movements.
revoke insert, update, delete, truncate on public.stock, public.moves from public, anon, authenticated;
-- Table-level REVOKE does not remove independently granted column privileges.
do $$ declare rel text; cols text; begin
  foreach rel in array array['stock','moves'] loop
    select string_agg(quote_ident(attname),',') into cols from pg_catalog.pg_attribute
      where attrelid=('public.'||rel)::regclass and attnum>0 and not attisdropped;
    execute format('revoke insert (%s), update (%s), references (%s) on public.%I from public, anon, authenticated',cols,cols,cols,rel);
  end loop;
end $$;
-- The old direction-insensitive guard is superseded by the RPC checks below.
drop trigger if exists stock_master_guard on public.stock;

create or replace function mixora_private.apply_stock(p_request_id uuid, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor public.users%rowtype;
  req mixora_private.stock_requests%rowtype;
  cur public.stock%rowtype;
  entry jsonb; desired jsonb; before_doc jsonb; after_doc jsonb;
  fid text; kind text; reason text; qty integer; next_wh integer;
  next_bar boolean; next_stop boolean; next_auto boolean; next_slow boolean; next_retired boolean;
  v_result jsonb := '[]'::jsonb;
  prior public.moves%rowtype;
begin
  -- tg-auth signs sub as the Telegram numeric id (NOT a Supabase Auth UUID).
  -- Never use JWT venue/role/perms or user_metadata to authorize writes.
  select * into actor from public.users
    where tg_id = (nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub')::bigint
    for share;
  if actor.tg_id is null or actor.venue_id is null or actor.role not in ('manager','master') then
    raise exception 'stock_forbidden' using errcode = '42501';
  end if;
  if p_request_id is null or jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'stock_invalid_request';
  end if;
  if jsonb_array_length(p_items) not between 1 and 200 then raise exception 'stock_invalid_batch_size'; end if;
  if exists(select 1 from jsonb_array_elements(p_items) e
    where jsonb_typeof(e) <> 'object' or coalesce(e->>'id','') = '')
    or (select count(distinct e->>'id') from jsonb_array_elements(p_items) e) <> jsonb_array_length(p_items)
    then raise exception 'stock_duplicate_or_invalid_item'; end if;

  -- Unique-key conflict waits for an in-flight identical request to commit/rollback.
  insert into mixora_private.stock_requests values(actor.venue_id,p_request_id,actor.tg_id,p_items,null)
    on conflict do nothing;
  select * into strict req from mixora_private.stock_requests
    where venue_id=actor.venue_id and request_id=p_request_id for update;
  if req.actor <> actor.tg_id or req.payload <> p_items then raise exception 'stock_idempotency_conflict'; end if;
  if req.result is not null then return req.result; end if;

  -- Lock missing rows too, in deterministic order, before inserting initial stock.
  -- Advisory collisions only serialize unrelated operations, never compromise data.
  for entry in select value from jsonb_array_elements(p_items) order by value->>'id' loop
    fid := entry->>'id';
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor.venue_id::text || ':' || fid,0));
  end loop;
  for entry in select value from jsonb_array_elements(p_items) order by value->>'id' loop
    fid := entry->>'id';
    if not exists(select 1 from public.flavors where id=fid) then raise exception 'stock_unknown_item'; end if;
    insert into public.stock(venue_id,flavor_id,wh) values(actor.venue_id,fid,0) on conflict(venue_id,flavor_id) do nothing;
    select * into strict cur from public.stock where venue_id=actor.venue_id and flavor_id=fid for update;
    if jsonb_typeof(entry->'revision') is distinct from 'number' or (entry->>'revision') !~ '^[0-9]+$'
      or (entry->>'revision')::integer <> cur.revision then raise exception 'stock_stale_revision'; end if;
    before_doc := jsonb_build_object('wh',cur.wh,'bar',cur.bar,'stop',coalesce(cur.stop,false),
      'stopAuto',coalesce(cur.stop_auto,false),'slow',coalesce(cur.slow,false),'retired',coalesce(cur.retired,false));
    kind := coalesce(entry->>'kind','in'); reason := entry->>'reason';
    if entry ? 'undo' then
      if actor.role <> 'manager' then raise exception 'stock_forbidden' using errcode='42501'; end if;
      select * into prior from public.moves where venue_id=actor.venue_id and flavor_id=fid and operation_id=(entry->>'undo')::uuid;
      if prior.operation_id is null or prior.stock_revision <> cur.revision then raise exception 'stock_undo_not_latest'; end if;
      desired := prior.prev; kind := 'in'; reason := 'Отмена операции ' || (entry->>'undo');
    else
      desired := entry->'doc';
    end if;
    if jsonb_typeof(desired) is distinct from 'object' or jsonb_typeof(desired->'wh') is distinct from 'number'
      or (desired->>'wh') !~ '^[0-9]+$' then raise exception 'stock_invalid_quantity'; end if;
    next_wh := (desired->>'wh')::integer;
    if next_wh > 1000000 then raise exception 'stock_quantity_limit'; end if;
    if kind not in ('in','tobar','fin','off','wo','inv') or length(coalesce(reason,''))>1000 then raise exception 'stock_invalid_kind_or_reason'; end if;
    if exists(select 1 from jsonb_each(desired) kv where kv.key in ('bar','stop','stopAuto','slow','retired')
      and jsonb_typeof(kv.value) <> 'boolean' and not(kv.key='bar' and kv.value='null'::jsonb)) then raise exception 'stock_invalid_flag'; end if;
    next_bar := (desired->>'bar')::boolean;
    next_stop := coalesce((desired->>'stop')::boolean,false);
    next_auto := coalesce((desired->>'stopAuto')::boolean,false);
    next_slow := coalesce((desired->>'slow')::boolean,false);
    next_retired := coalesce((desired->>'retired')::boolean,false);
    qty := next_wh-cur.wh;
    if actor.role='master' then
      if (qty>0 and not coalesce('add'=any(actor.perms),false))
        or (qty<0 and (not coalesce('take'=any(actor.perms),false) or kind not in ('tobar','fin') or next_bar is distinct from true))
        or (coalesce(next_bar,false) is distinct from coalesce(cur.bar,false) and next_bar is true and not coalesce('take'=any(actor.perms),false))
        or (coalesce(next_bar,false) is distinct from coalesce(cur.bar,false) and next_bar is not true and not coalesce('offbar'=any(actor.perms),false)
          and not(kind='fin' and cur.wh=0 and next_wh=0 and coalesce('take'=any(actor.perms),false)))
        or (next_slow is distinct from coalesce(cur.slow,false) and not coalesce('slow'=any(actor.perms),false))
        or (next_retired is distinct from coalesce(cur.retired,false))
        or (coalesce(cur.stop,false) and not next_stop and not coalesce('unstop'=any(actor.perms),false)
          and not(coalesce(cur.stop_auto,false) and (qty>0 or (kind='tobar' and next_bar is true))))
        or kind in ('wo','inv')
        or (next_auto and not next_stop)
        or (next_auto and not coalesce(cur.stop_auto,false)
          and not(kind='fin' and cur.wh=0 and next_wh=0 and next_bar is false and coalesce('take'=any(actor.perms),false)))
        then raise exception 'stock_forbidden' using errcode='42501'; end if;
    end if;
    update public.stock set wh=next_wh,bar=next_bar,stop=next_stop,stop_auto=next_auto,
      slow=next_slow,retired=next_retired,revision=revision+1 where venue_id=actor.venue_id and flavor_id=fid;
    after_doc := jsonb_build_object('wh',next_wh,'bar',next_bar,'stop',next_stop,'stopAuto',next_auto,
      'slow',next_slow,'retired',next_retired,'revision',cur.revision+1);
    if reason is null and qty=0 then reason := 'Изменение состояния позиции'; end if;
    insert into public.moves(venue_id,flavor_id,kind,qty,left_after,reason,prev,bar_to,at,by_tg,operation_id,stock_revision,next_state)
      values(actor.venue_id,fid,kind,qty,next_wh,reason,before_doc,next_bar,pg_catalog.transaction_timestamp(),actor.tg_id,p_request_id,cur.revision+1,after_doc);
    v_result := v_result || jsonb_build_array(jsonb_build_object('id',fid,'doc',after_doc));
  end loop;
  update mixora_private.stock_requests set result=v_result where venue_id=actor.venue_id and request_id=p_request_id;
  return v_result;
end $$;
revoke all on function mixora_private.apply_stock(uuid,jsonb) from public,anon;
grant execute on function mixora_private.apply_stock(uuid,jsonb) to authenticated;

create or replace function public.apply_stock(p_request_id uuid,p_items jsonb)
returns jsonb language sql security invoker set search_path='' as $$
  select mixora_private.apply_stock(p_request_id,p_items);
$$;
revoke all on function public.apply_stock(uuid,jsonb) from public,anon;
grant execute on function public.apply_stock(uuid,jsonb) to authenticated;
commit;
