alter function smartgov.budget_parent_rollup(text, uuid, uuid) rename to budget_parent_rollup_legacy;

create or replace function smartgov.budget_parent_rollup(
  p_session_token text,
  p_unit_id uuid,
  p_period_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_is_usg boolean;
  v_allowed_units uuid[];
  v_result jsonb;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if not exists (
    select 1
      from public.governance_units gu
     where gu.id = p_unit_id
       and gu.organization_id = v_account.organization_id
  ) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  v_is_usg := smartgov.budget_is_usg(v_account);

  if not v_is_usg
     and not (p_unit_id = any (
       select smartgov.lsg_unit_ids(v_account.id, v_account.organization_id)
     )) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  v_result := smartgov.budget_parent_rollup_legacy(
    p_session_token, p_unit_id, p_period_id
  );

  if coalesce((v_result ->> 'ok')::boolean, false) is not true then
    return v_result;
  end if;

  if v_is_usg then
    select coalesce(array_agg(gu.id), '{}'::uuid[])
      into v_allowed_units
      from public.governance_units gu
     where gu.organization_id = v_account.organization_id;
  else
    v_allowed_units := '{}'::uuid[];
  end if;

  return jsonb_set(
    v_result,
    '{children}',
    coalesce((
      select jsonb_agg(child.value)
        from jsonb_array_elements(coalesce(v_result -> 'children', '[]'::jsonb)) as child(value)
       where nullif(child.value ->> 'unitId', '')::uuid = any (v_allowed_units)
    ), '[]'::jsonb),
    false
  );
end;
$$;

revoke all on function smartgov.budget_parent_rollup(text, uuid, uuid) from public;
revoke all on function smartgov.budget_parent_rollup_legacy(text, uuid, uuid) from public;

create or replace function public.budget_parent_rollup(
  p_session_token text,
  p_unit_id uuid,
  p_period_id uuid
)
returns jsonb
language sql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.budget_parent_rollup($1, $2, $3); $$;

revoke all on function public.budget_parent_rollup(text, uuid, uuid) from public;
grant execute on function public.budget_parent_rollup(text, uuid, uuid) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
