begin;

alter table public.users add column membership_epoch uuid not null default gen_random_uuid();

create function mixora_private.rotate_membership_epoch()
returns trigger language plpgsql set search_path='' as $$
begin
  if TG_OP = 'INSERT' then
    new.membership_epoch := gen_random_uuid();
  elsif new.tg_id is distinct from old.tg_id or new.venue_id is distinct from old.venue_id then
    new.membership_epoch := gen_random_uuid();
  else
    new.membership_epoch := old.membership_epoch;
  end if;
  return new;
end;
$$;
create trigger membership_epoch before insert or update on public.users
for each row execute function mixora_private.rotate_membership_epoch();

-- Reject signatures issued before this security boundary, including previously unrecorded replays.
create table mixora_private.telegram_auth_cutover(
  singleton boolean primary key default true check(singleton),
  auth_date bigint not null
);
insert into mixora_private.telegram_auth_cutover(auth_date)
values(floor(extract(epoch from clock_timestamp())));
revoke all on mixora_private.telegram_auth_cutover from public,anon,authenticated;

create table mixora_private.telegram_sessions(
  proof_hash text primary key check(proof_hash ~ '^[0-9a-f]{64}$'),
  session_id uuid not null unique default gen_random_uuid(),
  tg_id bigint not null,
  membership_epoch uuid not null,
  auth_date bigint not null,
  expires_at bigint not null
);
revoke all on mixora_private.telegram_sessions from public,anon,authenticated;
-- Deliberately no FK cascade: used signatures stay consumed after member deletion.

create function public.bind_telegram_session(
  p_tg_id bigint, p_proof_hash text, p_auth_date bigint, p_session_id uuid default null,
  p_invite text default null, p_name text default null, p_allow_invites boolean default false
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  member public.users%rowtype;
  bound mixora_private.telegram_sessions%rowtype;
  now_seconds bigint := floor(extract(epoch from clock_timestamp()));
begin
  if p_auth_date is null or p_auth_date > now_seconds+300 or p_auth_date+86400 <= now_seconds then return null; end if;
  if p_auth_date <= (select auth_date from mixora_private.telegram_auth_cutover) then return null; end if;
  if p_session_id is null and p_auth_date < now_seconds-300 then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_proof_hash,0));
  select * into bound from mixora_private.telegram_sessions where proof_hash=p_proof_hash;
  if p_session_id is null and found then return null; end if;

  -- Membership creation and proof consumption share the same transaction.
  select * into member from public.users where tg_id=p_tg_id for share;
  if not found then
    if p_session_id is not null then return null; end if;
    if not p_allow_invites or p_invite is null or p_invite='' then
      return jsonb_build_object('error','need_invite');
    end if;
    if public.redeem_staff_invite(p_invite,p_tg_id,p_name) is null then
      return jsonb_build_object('error','bad_invite');
    end if;
    select * into member from public.users where tg_id=p_tg_id for share;
  end if;
  if member.venue_id is null then return null; end if;

  if p_session_id is null then
    if p_auth_date < now_seconds-300 then return null; end if;
    insert into mixora_private.telegram_sessions(proof_hash,tg_id,membership_epoch,auth_date,expires_at)
    values(p_proof_hash,p_tg_id,member.membership_epoch,p_auth_date,p_auth_date+86400)
    on conflict(proof_hash) do nothing;
    if not found then return null; end if;
  end if;

  select * into bound from mixora_private.telegram_sessions where proof_hash=p_proof_hash;
  if not found or bound.tg_id<>p_tg_id or bound.membership_epoch<>member.membership_epoch
    or bound.auth_date<>p_auth_date or bound.expires_at<=now_seconds
    or (p_session_id is not null and bound.session_id<>p_session_id) then return null; end if;
  return jsonb_build_object('session_id',bound.session_id,'membership_epoch',bound.membership_epoch,
    'expires_at',bound.expires_at,'user',jsonb_build_object('tg_id',member.tg_id,'venue_id',member.venue_id,'name',member.name));
end;
$$;
revoke all on function public.bind_telegram_session(bigint,text,bigint,uuid,text,text,boolean) from public,anon,authenticated;
grant execute on function public.bind_telegram_session(bigint,text,bigint,uuid,text,text,boolean) to service_role;

-- Old JWTs lack the epoch and must reauthenticate with the coordinated client/Edge.
create or replace function public.me_tg() returns bigint
language sql stable security definer set search_path='' as $$
 select u.tg_id
 from (select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb c) q
 join public.users u on u.tg_id::text=c->>'sub' and u.membership_epoch::text=c->>'membership_epoch'
 where c->>'role'='authenticated'
   and (not(c ? 'tg_id') or c->>'tg_id'=c->>'sub')
$$;
commit;
