-- 03102 -- `list_umbrella`, corrected against the real schema.
--
-- Two wrong guesses in 03100, both caught by running the call against the live
-- database before trusting it:
--   * `governance_units` has no `status` column (03101 already swapped that for
--     the unit's `structure_key`).
--   * `smartgov.accounts` has no `unit_id`. An account reaches a unit through
--     the roster: `accounts.id` -> `roster.account_id` -> `roster.id` ->
--     `unit_memberships.roster_id` -> `unit_memberships.unit_id`.
--
-- `list_umbrella` is a read used by Manage, so it must not be wrong. This
-- version walks the real join, and returns each unit with every member seat
-- (account, roster name, position) rather than a single inferred owner.
--
-- Ledger rule: 03100/03101 are recorded and never re-run, so the body lives
-- here.

create or replace function smartgov.list_umbrella(p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_org     uuid;
  v_units   jsonb;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if v_account.account_scope <> 'owner' then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  v_org := v_account.organization_id;

  select coalesce(jsonb_agg(unit order by unit->>'name'), '[]'::jsonb)
    into v_units
  from (
    select jsonb_build_object(
      'unitId', u.id,
      'name', u.name,
      'unitType', u.unit_type,
      'parentId', u.parent_id,
      'structureKey', u.structure_key,
      'memberCount', (
        select count(distinct m.roster_id)
        from smartgov.unit_memberships m
        where m.unit_id = u.id
          and (m.end_date is null or m.end_date >= current_date)
      ),
      'members', coalesce((
        select jsonb_agg(member order by member->>'name')
        from (
          select jsonb_build_object(
            'rosterId', r.id,
            'name', coalesce(nullif(trim(r.full_name), ''), r.email),
            'email', r.email,
            'position', p.title,
            'account', case when a.id is null then null else jsonb_build_object(
              'id', a.id,
              'email', a.email,
              'displayName', a.display_name,
              'status', a.status,
              'deactivationStartsAt', a.deactivation_starts_at,
              'deactivationEndsAt', a.deactivation_ends_at,
              'deactivationReason', a.deactivation_reason
            ) end
          ) as member
          from smartgov.unit_memberships m
          join smartgov.roster r on r.id = m.roster_id
          left join smartgov.accounts a on a.id = r.account_id
          left join smartgov.unit_positions p on p.id = m.position_id
          where m.unit_id = u.id
            and (m.end_date is null or m.end_date >= current_date)
        ) mm
      ), '[]'::jsonb)
    ) as unit
    from public.governance_units u
    where u.organization_id = v_org
      and u.unit_type <> 'usg'
  ) s;

  return jsonb_build_object('ok', true, 'units', v_units);
end;
$$;

revoke execute on function smartgov.list_umbrella(text) from public, anon, authenticated;
grant execute on function public.list_umbrella(text) to anon, authenticated;
