begin;

-- The service-role Edge handler verifies the Telegram identity before calling.
-- Both writes commit together, including when the caller loses the response.
create function public.redeem_staff_invite(p_code text, p_tg_id bigint, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  invite_venue uuid;
  member public.users%rowtype;
begin
  update public.invites
     set used_by = p_tg_id
   where code = p_code and used_by is null and venue_id is not null
   returning venue_id into invite_venue;

  if not found then
    return null;
  end if;

  insert into public.users(tg_id, venue_id, name, role)
  values (p_tg_id, invite_venue, p_name, 'manager')
  returning * into member;

  return jsonb_build_object('tg_id', member.tg_id, 'venue_id', member.venue_id, 'name', member.name);
end;
$$;

revoke all on function public.redeem_staff_invite(text, bigint, text) from public, anon, authenticated;
grant execute on function public.redeem_staff_invite(text, bigint, text) to service_role;

-- Staff can issue and withdraw unused codes through the existing policy.
-- Consumed codes must remain immutable even when table UPDATE/DELETE is granted.
create policy invites_unused_only on public.invites as restrictive
  for all to authenticated
  using (used_by is null)
  with check (used_by is null);

commit;
