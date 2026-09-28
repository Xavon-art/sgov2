-- The dashboard, units-first: an owner adds a campus or department to their
-- USG, then invites an LSG officer into it. No position seat is involved.
--
-- Until this migration the org chart could not be grown after setup:
-- `create_organization` wrote the tree at signup, and an owner of a USG
-- created with the legacy single-`usg` shape had zero child units and no way
-- to create one. This adds the missing write -- an owner-only `add_unit` --
-- and broadens `create_invite` so a unit id without a position is the
-- seat-less LSG invite rather than an `invalid_request`.
--
-- The scope story stays closed. A membership row drives what `unit_chart`
-- shows a non-owner account: the officer's unit (plus its parent USG) is
-- resolved from `unit_memberships` in SQL, and nothing else is put in the
-- result. `position_id` is made nullable so an LSG officer can *be* in a unit
-- without holding any seat, and the two partial unique indexes already treat
-- NULL as distinct, so many seat-less officers fit in one unit and the
-- one-active-person-per-unit rule is unchanged. `accept_invite`, the mailed
-- link, and the OTP flow are all untouched: the new account verifies exactly
-- like any invitee, and their post-activation `/my-council` view is the LSG
-- dashboard, because `unit_chart` returns `scope: "unit"` for them.

alter table smartgov.unit_memberships
  alter column position_id drop not null;

-- ---------------------------------------------------------------- add_unit

create or replace function smartgov.add_unit(
  p_session_token text,
  p_name          text,
  p_unit_type     text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_name    text := btrim(coalesce(p_name, ''));
  v_type    public.unit_type;
  v_parent  uuid;
  v_unit_id uuid;
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if v_account.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;

  if not exists (
    select 1
    from public.organization_members m
    where m.organization_id = v_account.organization_id
      and m.email = v_account.email
      and m.is_founding
  ) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if v_name = '' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_name');
  end if;

  begin
    v_type := p_unit_type::public.unit_type;
  exception when invalid_text_representation then
    return jsonb_build_object('ok', false, 'reason', 'invalid_type');
  end;

  if v_type not in ('college', 'campus', 'department') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_type');
  end if;

  if exists (
    select 1
    from public.governance_units gu
    where gu.organization_id = v_account.organization_id
      and lower(btrim(gu.name)) = lower(v_name)
  ) then
    return jsonb_build_object('ok', false, 'reason', 'duplicate_unit_name');
  end if;

  select gu.id into v_parent
  from public.governance_units gu
  where gu.organization_id = v_account.organization_id
    and gu.parent_id is null
  limit 1;

  if v_parent is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if not smartgov.consume_rate_limit(
       'unit:session:' || v_account.id::text, 60, interval '1 hour')
     or not smartgov.consume_rate_limit(
       'unit:global', 240, interval '1 hour') then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  insert into public.governance_units (organization_id, name, unit_type, parent_id)
  values (v_account.organization_id, v_name, v_type, v_parent)
  returning id into v_unit_id;

  return jsonb_build_object(
    'ok', true,
    'unitId', v_unit_id,
    'name', v_name,
    'unitType', v_type,
    'parentId', v_parent
  );
end;
$$;

revoke all on function smartgov.add_unit(text, text, text) from public;

-- ---------------------------------------------------------------- invites

create or replace function smartgov.create_invite(
  p_session_token text,
  p_email         text,
  p_campus_name   text,
  p_unit_type     text,
  p_unit_id       uuid default null,
  p_position_id   uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account       smartgov.accounts%rowtype;
  v_email         text := lower(trim(coalesce(p_email, '')));
  v_raw           text := encode(extensions.gen_random_bytes(24), 'hex');
  v_unit          public.unit_type := 'lsg';
  v_invite_id     uuid;
  v_org_name      text;
  v_roster_id     uuid;
  v_membership_id uuid;
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if v_account.account_scope <> 'owner' then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if v_account.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;

  if v_email = '' or position('@' in v_email) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_email');
  end if;

  if not smartgov.consume_rate_limit(
       'invite:session:' || v_account.id::text, 30, interval '1 hour')
     or not smartgov.consume_rate_limit(
       'invite:email:' || v_email, 5, interval '1 hour') then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  if exists (select 1 from smartgov.accounts a where lower(a.email) = v_email) then
    return jsonb_build_object('ok', false, 'reason', 'already_registered');
  end if;

  if p_unit_type in ('lsg', 'college', 'campus', 'council', 'department') then
    v_unit := p_unit_type::public.unit_type;
  end if;

  if p_unit_id is null and p_position_id is not null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  if p_unit_id is not null then
    if not exists (
      select 1
      from public.governance_units gu
      where gu.id = p_unit_id
        and gu.organization_id = v_account.organization_id
    ) or (
      p_position_id is not null
      and not exists (
        select 1
        from smartgov.org_positions op
        where op.id = p_position_id
          and op.organization_id = v_account.organization_id
      )
    ) then
      return jsonb_build_object('ok', false, 'reason', 'not_found');
    end if;

    if p_position_id is not null then
      if not exists (
        select 1
        from smartgov.unit_positions up
        where up.unit_id = p_unit_id
          and up.position_id = p_position_id
      ) then
        return jsonb_build_object('ok', false, 'reason', 'seat_not_enabled');
      end if;

      if exists (
        select 1
        from smartgov.unit_memberships m
        where m.unit_id = p_unit_id
          and m.position_id = p_position_id
          and m.end_date is null
      ) then
        return jsonb_build_object('ok', false, 'reason', 'seat_occupied');
      end if;
    end if;
  end if;

  update smartgov.invites
     set status = 'revoked'
   where organization_id = v_account.organization_id
     and lower(email) = v_email
     and status = 'pending';

  insert into smartgov.invites (
    organization_id, email, campus_name, unit_type, unit_id, position_id,
    token_hash, invited_by, expires_at
  )
  values (
    v_account.organization_id, v_email, trim(coalesce(p_campus_name, '')),
    v_unit, p_unit_id, p_position_id,
    smartgov.sha256(v_raw), v_account.display_name, now() + interval '14 days'
  )
  returning id into v_invite_id;

  if p_unit_id is not null then
    insert into smartgov.roster (organization_id, full_name, email)
    values (v_account.organization_id, v_email, v_email)
    on conflict (organization_id, lower(email)) do update
      set email = excluded.email
    returning id into v_roster_id;

    insert into smartgov.unit_memberships (roster_id, unit_id, position_id)
    values (v_roster_id, p_unit_id, p_position_id)
    returning id into v_membership_id;
  end if;

  select o.name into v_org_name
  from public.organizations o
  where o.id = v_account.organization_id;

  return jsonb_build_object(
    'ok', true,
    'token', v_raw,
    'inviteId', v_invite_id,
    'email', v_email,
    'organizationName', v_org_name,
    'universityName', v_account.university_name,
    'rosterId', v_roster_id,
    'membershipId', v_membership_id,
    'expiresAt', (now() + interval '14 days')
  );
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'seat_occupied');
end;
$$;

revoke all on function smartgov.create_invite(text, text, text, text, uuid, uuid) from public;

create or replace function public.add_unit(
  p_session_token text,
  p_name          text,
  p_unit_type     text
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
  select smartgov.add_unit(p_session_token, p_name, p_unit_type);
$$;

revoke all on function public.add_unit(text, text, text) from public;
grant execute on function public.add_unit(text, text, text) to anon, authenticated;

create or replace function public.create_invite(
  p_session_token text,
  p_email         text,
  p_campus_name   text,
  p_unit_type     text,
  p_unit_id       uuid default null,
  p_position_id   uuid default null
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
  select smartgov.create_invite(
    p_session_token, p_email, p_campus_name, p_unit_type, p_unit_id, p_position_id
  );
$$;

revoke all on function public.create_invite(text, text, text, text, uuid, uuid) from public;
grant execute on function public.create_invite(text, text, text, text, uuid, uuid) to anon, authenticated;
