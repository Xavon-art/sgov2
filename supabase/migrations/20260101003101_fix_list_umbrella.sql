-- 03101 -- Fix `list_umbrella` after 03100.
--
-- 03100 selected `u.status` from `public.governance_units`, but that table has
-- no `status` column: a unit's state is carried by the organisation and by the
-- account seat that holds it, not by the unit row. The call raised
-- "column u.status does not exist" the moment an owner opened the umbrella.
--
-- The unit's own `structure_key` is the useful thing to return instead, so the
-- Manage screen can deep-link straight into that unit's government structure.
--
-- Ledger rule: 03100 is already recorded and is never re-run, so the corrected
-- body lives here rather than as an edit to an applied file.

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
      'structureKey', u.structure_key,
      'account', (
        select jsonb_build_object(
          'id', a.id,
          'email', a.email,
          'displayName', a.display_name,
          'status', a.status,
          'deactivationStartsAt', a.deactivation_starts_at,
          'deactivationEndsAt', a.deactivation_ends_at,
          'deactivationReason', a.deactivation_reason
        )
        from smartgov.accounts a
        where a.unit_id = u.id
        order by a.created_at
        limit 1
      ),
      'memberCount', (
        select count(*) from smartgov.accounts a where a.unit_id = u.id
      )
    ) as unit
    from public.governance_units u
    where u.organization_id = v_org
      and u.unit_type <> 'usg'
  ) s;

  return jsonb_build_object(
    'ok', true,
    'units', v_units
  );
end;
$$;

revoke execute on function smartgov.list_umbrella(text) from public, anon, authenticated;
grant execute on function public.list_umbrella(text) to anon, authenticated;
