-- D2: a compensation movement cannot itself be undone.
begin;

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
  if coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role','') <> 'authenticated' then raise exception 'stock_forbidden' using errcode='42501'; end if;
  select * into actor from public.users
    where tg_id = public.me_tg()
    for share;
  if actor.tg_id is null or actor.venue_id is null then
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
    if not exists(select 1 from public.flavors where id=fid and (venue_id is null or venue_id=actor.venue_id)) then raise exception 'stock_unknown_item'; end if;
    insert into public.stock(venue_id,flavor_id,wh) values(actor.venue_id,fid,0) on conflict(venue_id,flavor_id) do nothing;
    select * into strict cur from public.stock where venue_id=actor.venue_id and flavor_id=fid for update;
    if jsonb_typeof(entry->'revision') is distinct from 'number' or (entry->>'revision') !~ '^[0-9]+$'
      or (entry->>'revision')::integer <> cur.revision then raise exception 'stock_stale_revision'; end if;
    before_doc := jsonb_build_object('wh',cur.wh,'bar',cur.bar,'stop',coalesce(cur.stop,false),
      'stopAuto',coalesce(cur.stop_auto,false),'slow',coalesce(cur.slow,false),'retired',coalesce(cur.retired,false));
    kind := coalesce(entry->>'kind','in'); reason := entry->>'reason';
    if entry ? 'undo' then
      select * into prior from public.moves where venue_id=actor.venue_id and flavor_id=fid and operation_id=(entry->>'undo')::uuid;
      if prior.operation_id is null or prior.stock_revision <> cur.revision then raise exception 'stock_undo_not_latest'; end if;
      -- The receipt records the operation per item. Movement reason is free-form text.
      if exists (
        select 1
        from mixora_private.stock_requests as source_request
        cross join lateral jsonb_array_elements(source_request.payload) as item(value)
        where source_request.venue_id = actor.venue_id
          and source_request.request_id = prior.operation_id
          and item.value->>'id' = fid
          and item.value ? 'undo'
      ) then
        raise exception 'stock_undo_compensation';
      end if;
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
    next_bar := coalesce((desired->>'bar')::boolean,cur.bar,false);
    next_stop := coalesce((desired->>'stop')::boolean,false);
    next_auto := coalesce((desired->>'stopAuto')::boolean,false);
    next_slow := coalesce((desired->>'slow')::boolean,false);
    next_retired := coalesce((desired->>'retired')::boolean,false);
    qty := next_wh-cur.wh;
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

commit;
