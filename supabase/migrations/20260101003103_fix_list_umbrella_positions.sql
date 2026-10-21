-- 03103 -- `list_umbrella`: the position label join.
--
-- Third schema guess corrected, same discipline: run it before trusting it.
-- `smartgov.unit_positions` is a join table (`unit_id`, `position_id`); the
-- human label lives on `smartgov.org_positions.label`. 03102 joined
-- `unit_positions` directly as if it were the position, so it read `p.id`,
-- which the join table does not have.
--
-- Ledger rule: earlier files are recorded and never re-run.

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
            'position', p.label,
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
          left join smartgov.unit_positions up on up.unit_id = m.unit_id and up.position_id = m.position_id
          left join smartgov.org_positions p on p.id = up.position_id
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
