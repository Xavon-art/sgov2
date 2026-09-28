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
--
-- A seat-less officer therefore does not appear in their own unit's `seats`:
-- 00800 builds that list by joining through `unit_positions`, and holding no
-- position means no row to join from. Their unit card shows empty seats, which
-- is intended -- an LSG officer staffs no seat, and the owner staffing one is a
-- separate `create_invite` with a `p_position_id`.

alter table smartgov.unit_memberships
  alter column position_id drop not null;

-- Two campuses of the same name in one organization make the officer's unit
-- unreadable in the chart, so `add_unit` refuses the name. That pre-check is
-- only the common path: two owners posting the same name at the same moment
-- both see an empty result and both insert. This index is the guarantee, and
-- `add_unit` turns what it raises into `duplicate_unit_name` rather than
-- letting a raw 22P02 out. Named for the same reason as
-- `org_positions_one_label_per_org` in 00600 -- "the same college name" is not
-- enough to find the offending row in a list the client cannot see the index of.
--
-- New data is held to this, but old data is not: the legacy bulk writer
-- `public.create_organization` (00700, long applied) groups unit names by
-- `btrim(name)` alone, case-sensitively, so an organization created before this
-- index can hold two units whose names differ only in case. Those rows are legal
-- under the writer and illegal here, and `create unique index` -- unlike the
-- `if not exists` -- aborts the whole migration on the first duplicate rather
-- than skipping it. This is expected: the operator verifies the applied data is
-- clean (or dedupes it) before applying this migration, and an aborted run here
-- is the loud signal that they did not.
create unique index if not exists governance_units_one_name_per_org
  on public.governance_units (organization_id, lower(btrim(name)));

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

  -- A unitary organization has no local tier: 00700 writes one `council` row
  -- from the organization name and never reads the `units` array, and that
  -- council row is where its officers belong. A college, campus or department
  -- grafted under it is a layer the wizard refuses to draw, so it is refused
  -- here rather than left in the table for the chart to misread.
  if not exists (
    select 1
    from public.organizations o
    where o.id = v_account.organization_id
      and o.governance_model = 'federated'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'unitary_model');
  end if;

  if v_name = '' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_name');
  end if;

  begin
    v_type := p_unit_type::public.unit_type;
  exception when invalid_text_representation then
    return jsonb_build_object('ok', false, 'reason', 'invalid_type');
  end;

  -- Both halves are load-bearing, and neither covers the other. The cast raises
  -- only on a *string the enum does not contain*; `null::public.unit_type` is a
  -- strict function of a null input, so it returns null and raises nothing. Left
  -- to the `not in` alone, that null makes the test itself null, the `if` is
  -- skipped, and the insert below dies on the `not null` unit_type column as an
  -- unexplained 500 rather than as a refusal the client can render.
  if v_type is null or v_type not in ('college', 'campus', 'department') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_type');
  end if;

  -- Cheap and common, so it runs first and names the collision in the caller's
  -- words; the index above is what makes the answer true when it does not.
  if exists (
    select 1
    from public.governance_units gu
    where gu.organization_id = v_account.organization_id
      and lower(btrim(gu.name)) = lower(v_name)
  ) then
    return jsonb_build_object('ok', false, 'reason', 'duplicate_unit_name');
  end if;

  -- The new unit always hangs directly off the organization's root USG, the
  -- same row 00800 draws as `root`. `order by` so a tree that somehow grew a
  -- second root still resolves to a row rather than whichever one the planner
  -- reached first. `not_found` is kept over 00800's `no_unit`: it is the code
  -- the other two unit-scoped writers in 00800 already return for "that unit is
  -- not part of your organization", and it is the one the client's message map
  -- has a string for.
  select gu.id into v_parent
  from public.governance_units gu
  where gu.organization_id = v_account.organization_id
    and gu.parent_id is null
  order by gu.id
  limit 1;

  if v_parent is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  -- Two buckets, two intents. The first caps one owner -- a client in a retry
  -- loop is the only way to reach it. The second is the instance-wide ceiling
  -- that one owner cannot raise by spreading across many accounts, and it is
  -- the one that actually bounds the table.
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
exception
  -- The only uniqueness an insert like this can realistically reach is the name
  -- index above, and reaching it means another call won the race after the
  -- pre-check ran. Rolls back to the entry of this block, so a refused name
  -- leaves no unit behind and -- importantly -- refunds the rate-limit charge
  -- spent above.
  when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'duplicate_unit_name');
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

  -- The one half of the old "a seat needs a unit and a unit needs a seat" pair
  -- that is still illegal. A position with no unit is the dangling-row case: the
  -- membership it would write resolves to a seat the chart cannot reach. The
  -- other half -- unit with no position -- is the LSG invite this migration
  -- exists to allow, so the seat is optional and `position_id` is nullable. A
  -- relaxation is only safe in one direction, and that is the direction kept.
  if p_unit_id is null and p_position_id is not null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  if p_unit_id is not null then
    -- Both ids are uuids and therefore guessable, and neither `governance_units`
    -- nor `org_positions` carries an organization of its own. Re-resolving them
    -- against the *authenticated* account's organization is the only thing
    -- stopping an owner from inviting somebody into another council, and it is
    -- why the organization is never read out of the request body.
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

    -- A re-invite for someone who already holds the seat-less LSG membership
    -- reuses it instead of tripping `one_active_person_per_unit` (which would
    -- roll back the whole call and report a misleading `seat_occupied`). The
    -- new invite link is still minted above, which is what the owner wanted.
    -- The match is on the seat as well, because a seat-less row is a different
    -- thing from a seated one: matching either would let a seat-less membership
    -- swallow a re-invite that carries a position, skipping the insert and
    -- answering `ok` for a seat nothing ever fills. `is not distinct from`
    -- rather than `=` so the seat-less path -- both sides null -- still matches.
    if not exists (
      select 1
      from smartgov.unit_memberships m
      where m.unit_id = p_unit_id
        and m.roster_id = v_roster_id
        and m.position_id is not distinct from p_position_id
        and m.end_date is null
    ) then
      insert into smartgov.unit_memberships (roster_id, unit_id, position_id)
      values (v_roster_id, p_unit_id, p_position_id)
      returning id into v_membership_id;
    end if;
  end if;

  select o.name into v_org_name
  from public.organizations o
  where o.id = v_account.organization_id;

  -- `membershipId` is null on a re-invite that found the membership already
  -- there, which is the honest answer: this call did not write the row. The
  -- only `membershipId` the dashboard acts on comes from the chart payload and
  -- from `release_officer`, so nothing here depends on this one being set.
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
  -- Left as 00900 wrote it, and now narrower than it was: the re-invite case
  -- that used to land here is handled by the `not exists` above. What is left
  -- is a genuine race on a *seated* invite -- the seat checks pass and the
  -- insert loses anyway -- and the same interleaving between the `not exists`
  -- and the insert on a membership this person already holds. Both are the
  -- caller's cue to re-read the chart.
  when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'seat_occupied');
end;
$$;

revoke all on function smartgov.create_invite(text, text, text, text, uuid, uuid) from public;

-- ---------------------------------------------------------------- PostgREST surface

-- Thin `public` forwarders in the shape 003 established and 00800 restated: no
-- logic, so a wrapper can never be stricter or looser than what it calls. The
-- reachable surface grows by one -- `public.add_unit` -- which is the point of
-- the migration; `public.create_invite` keeps its six-argument signature, the
-- trailing two defaulted, so the dashboard's existing four-argument org-wide
-- invite is untouched. `smartgov.add_unit` stays unpublished like every other
-- function in the private schema.

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
