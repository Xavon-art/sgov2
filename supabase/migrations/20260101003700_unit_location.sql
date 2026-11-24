-- 03700 -- Give federated units a locatable Philippine address.
--
-- The invites screen now creates LSGs before it invites their officers. A bare
-- name is not enough to find a campus or department afterwards, so a unit can
-- carry the PSGC place it belongs to plus the human-readable address built from
-- that hierarchy. The write reuses `add_unit` rather than copying its authority,
-- duplicate-name, and rate-limit checks: a location is extra data on the same
-- owner-only write, never a second way to create a unit.

alter table public.governance_units
  add column if not exists address text,
  add column if not exists location_code text;

create or replace function smartgov.add_unit_with_location(
  p_session_token text,
  p_name          text,
  p_unit_type     text,
  p_address       text default null,
  p_location_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_result  jsonb;
  v_address text := nullif(btrim(coalesce(p_address, '')), '');
  v_code    text := nullif(btrim(coalesce(p_location_code, '')), '');
begin
  v_result := smartgov.add_unit(p_session_token, p_name, p_unit_type);

  if (v_result ->> 'ok') is distinct from 'true' then
    return v_result;
  end if;

  update public.governance_units
     set address = v_address,
         location_code = v_code
   where id = (v_result ->> 'unitId')::uuid;

  return v_result || jsonb_build_object(
    'address', v_address,
    'locationCode', v_code
  );
end;
$$;

revoke all on function smartgov.add_unit_with_location(text, text, text, text, text)
  from public, anon, authenticated;

create or replace function public.add_unit_with_location(
  p_session_token text,
  p_name          text,
  p_unit_type     text,
  p_address       text default null,
  p_location_code text default null
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
  select smartgov.add_unit_with_location(
    p_session_token, p_name, p_unit_type, p_address, p_location_code
  );
$$;

revoke all on function public.add_unit_with_location(text, text, text, text, text) from public;
grant execute on function public.add_unit_with_location(text, text, text, text, text)
  to anon, authenticated;

-- The umbrella is the screen that shows the result, so it reads the two new
-- columns alongside the existing structure key. Everything else stays exactly
-- as 03600 wrote it.
create or replace function smartgov.list_umbrella(p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_org uuid;
  v_root uuid;
  v_units jsonb;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if not smartgov.is_central_manager(v_account) and not smartgov.is_org_reviewer(v_account.id, v_account.organization_id) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  v_org := v_account.organization_id;
  v_root := smartgov.gov_root_unit(v_org);

  select coalesce(jsonb_agg(unit order by unit->>'name'), '[]'::jsonb)
    into v_units
    from (
      select jsonb_build_object(
        'unitId', u.id,
        'name', u.name,
        'unitType', u.unit_type,
        'parentId', u.parent_id,
        'structureKey', u.structure_key,
        'address', u.address,
        'locationCode', u.location_code,
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
                  'accountKind', a.account_kind,
                  'isUnitAccount', coalesce(a.is_unit_account, false),
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
       and (v_root is null or u.id <> v_root)
     ) s;

  return jsonb_build_object('ok', true, 'units', v_units);
end;
$$;
revoke all on function smartgov.list_umbrella(text) from public, anon, authenticated;

notify pgrst, 'reload schema';
