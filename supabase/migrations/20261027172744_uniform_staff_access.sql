-- Draft: apply ONLY to an isolated Supabase project after explicit approval.
-- Depends on 20261027065742_stock_rpc.sql. No production apply is authorized.
begin;
-- Identity is the signed Telegram subject. Legacy role/perms/venue claims do not
-- authorize anything. PostgREST verifies signature and expiration before SQL.
create or replace function public.me_tg() returns bigint
language sql stable set search_path='' as $$
 select case when c->>'role'='authenticated' and c->>'sub' ~ '^[0-9]{1,18}$'
   and (not(c ? 'tg_id') or c->>'tg_id'=c->>'sub') then (c->>'sub')::bigint end
 from (select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb c) q
$$;
create or replace function public.me_venue() returns uuid
language sql stable security definer set search_path='' as $$
 select venue_id from public.users where tg_id=public.me_tg()
$$;
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.users where tg_id=public.me_tg() and venue_id is not null)
$$;
-- Compatibility for old callers, not a capability distinction: every member is staff.
create or replace function public.me_role() returns text
language sql stable security definer set search_path='' as $$
 select case when public.is_staff() then 'staff'::text end
$$;
-- Guest views already call these helpers. They return null/false to guests;
-- leaving EXECUTE does not give guests table, RPC or storage write privileges.
grant execute on function public.me_tg(), public.me_venue(), public.me_role(), public.is_staff() to anon,authenticated;

-- Preserve existing venue, protected-knowledge and storage-path predicates;
-- replace ONLY legacy capability terms in the policies inspected in the audit.
do $$ declare p record; u text; c text; q text; begin
 for p in select n.nspname,t.relname,pol.polname,pg_get_expr(pol.polqual,pol.polrelid) as qual,
   pg_get_expr(pol.polwithcheck,pol.polrelid) as check_expr
   from pg_policy pol join pg_class t on t.oid=pol.polrelid join pg_namespace n on n.oid=t.relnamespace
   where n.nspname in ('public','storage') loop
  u:=p.qual; c:=p.check_expr;
  u:=regexp_replace(u,'(public\.)?me_role\(\)\s*=\s*''manager''(::text)?','public.is_staff()','g');
  c:=regexp_replace(c,'(public\.)?me_role\(\)\s*=\s*''manager''(::text)?','public.is_staff()','g');
  u:=regexp_replace(u,'(public\.)?me_role\(\)\s*=\s*''master''(::text)?','false','g');
  c:=regexp_replace(c,'(public\.)?me_role\(\)\s*=\s*''master''(::text)?','false','g');
  if u is distinct from p.qual or c is distinct from p.check_expr then
   q:=format('alter policy %I on %I.%I',p.polname,p.nspname,p.relname);
   if u is not null then q:=q||' using ('||u||')'; end if;
   if c is not null then q:=q||' with check ('||c||')'; end if;
   execute q;
  end if;
 end loop;
 if exists(select 1 from pg_policies where schemaname in ('public','storage')
    and (coalesce(qual,'')||coalesce(with_check,'')) ~ 'me_role\(') then
   raise exception 'uniform_staff_unreviewed_role_policy';
 end if;
end $$;
-- The old global catalog write policy also allowed cross-venue custom edits.
drop policy if exists flavors_write on public.flavors;
create policy flavors_staff_write on public.flavors for all to authenticated
 using(public.is_staff() and (venue_id is null or venue_id=public.me_venue()))
 with check(public.is_staff() and (venue_id is null or venue_id=public.me_venue()));
-- No direct stock/moves writes are restored. All members use the transactional
-- RPC and compensation journal; receipts, revision checks and locks stay intact.

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
revoke all on function mixora_private.apply_stock(uuid,jsonb) from public,anon;
grant execute on function mixora_private.apply_stock(uuid,jsonb) to authenticated;


commit;
