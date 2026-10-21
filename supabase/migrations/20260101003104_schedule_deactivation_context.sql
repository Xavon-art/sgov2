-- 03104 -- `schedule_deactivation` returns who it just scheduled.
--
-- The umbrella endpoint sends the unit a notice when a window is set. The
-- address and unit name are the two facts the letter needs, and the RPC already
-- resolved the target account to authorise the write -- so it should hand them
-- back rather than have the route re-resolve the same row from the session,
-- which would be a second read of the same authority.
--
-- This is a `create or replace` of the 03100 body with a wider return only in
-- the success object. The signature and the refusal paths are unchanged, so the
-- 03100 forwarder and its grant still describe it exactly.

create or replace function smartgov.schedule_deactivation(
  p_session_token text,
  p_account_id uuid,
  p_starts_on date,
  p_ends_on date,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, smartgov, pg_temp
as $$
declare
  v_owner   smartgov.accounts%rowtype;
  v_target  smartgov.accounts%rowtype;
  v_starts  timestamptz;
  v_ends    timestamptz;
  v_unit    text;
begin
  v_owner := smartgov.authenticate(p_session_token);
  if v_owner.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if v_owner.account_scope <> 'owner' then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if p_starts_on is null then
    return jsonb_build_object('ok', false, 'reason', 'missing_start');
  end if;

  if p_ends_on is not null and p_ends_on <= p_starts_on then
    return jsonb_build_object('ok', false, 'reason', 'end_before_start');
  end if;

  select a.* into v_target
  from smartgov.accounts a
  where a.id = p_account_id
    and a.organization_id = v_owner.organization_id;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if v_target.account_scope = 'owner' then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  v_starts := p_starts_on::timestamptz;
  v_ends   := (p_ends_on + 1)::timestamptz - interval '1 second';

  update smartgov.accounts a
     set deactivation_starts_at = v_starts,
         deactivation_ends_at = case when p_ends_on is null then null else v_ends end,
         deactivation_reason = nullif(trim(coalesce(p_reason, '')), ''),
         deactivation_scheduled_by = v_owner.id
   where a.id = v_target.id;

  perform smartgov.apply_scheduled_deactivation(v_target.id);

  -- The unit whose seat this is, for the notice. A seat with no unit yet is
  -- still a seat; the letter then names the organisation instead.
  select coalesce(u.name, v_target.campus_name)
    into v_unit
  from smartgov.roster r
  join smartgov.unit_memberships m on m.roster_id = r.id
  join public.governance_units u on u.id = m.unit_id
  where r.account_id = v_target.id
  order by m.created_at desc
  limit 1;

  return jsonb_build_object(
    'ok', true,
    'accountId', v_target.id,
    'email', v_target.email,
    'unitName', v_unit,
    'startsAt', v_starts,
    'endsAt', case when p_ends_on is null then null else v_ends end
  );
end;
$$;

revoke execute on function smartgov.schedule_deactivation(text, uuid, date, date, text)
  from public, anon, authenticated;
grant execute on function public.schedule_deactivation(text, uuid, date, date, text)
  to anon, authenticated;
