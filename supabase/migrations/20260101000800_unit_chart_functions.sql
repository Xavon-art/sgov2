-- The org chart: one scoped read, four owner-only writes.
--
-- The read is the point of this migration. An LSG officer must not learn that
-- any unit *other than their own and their own parent USG* exists, and the only
-- way to guarantee that is to never put the rest in the result set: a
-- client-side filter over a full fetch still ships every row to the browser,
-- where devtools can read it, so the scoping would be decorative. `unit_chart`
-- therefore resolves the caller's visible units into a uuid array first and
-- every subsequent query filters on it.
--
-- Owner authority is proven by the `public.organization_members` row with
-- `is_founding` set and a matching email -- the record `create_organization`
-- writes and the same proof `create_owner_account` already demands. An
-- organization id in the request body is not authority, so none of these
-- functions accept one.
--
-- Every mutation is owner-only. An LSG officer gets a read-only view in this
-- slice, which means there is no such thing as "the LSG officer may edit their
-- own council" here, and writing that rule once in each function is preferable
-- to a shared helper whose call sites then have to be audited.

-- ---------------------------------------------------------------- the read

create or replace function smartgov.unit_chart(p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, smartgov, pg_temp
as $$
declare
  v_account  smartgov.accounts%rowtype;
  v_is_owner boolean := false;
  v_unit_ids uuid[];
  v_result   jsonb;
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if v_account.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;

  -- The founder sees the whole organization. The founding-member row written by
  -- `create_organization` is the proof of authorship, matching what
  -- `create_owner_account` already checks; a client-supplied organization id on
  -- its own is not.
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = v_account.organization_id
      and m.email = v_account.email
      and m.is_founding
  ) into v_is_owner;

  if v_is_owner then
    select coalesce(array_agg(gu.id), '{}'::uuid[]) into v_unit_ids
    from public.governance_units gu
    where gu.organization_id = v_account.organization_id;
  else
    -- An officer sees the units they currently hold a seat in, plus the parent
    -- of each of those units. Nothing else is aggregated, so nothing else exists
    -- in the payload -- not even a count.
    --
    -- The parent is included ON PURPOSE and must not be "tightened" out. The
    -- approved design is that an LSG officer sees their own unit *and their
    -- unit's parent USG*, read-only, and the LSG view cannot render a parent it
    -- was never given. It is also not a leak: it is the officer's own parent
    -- organization, one row, reached only by following `parent_id` from a unit
    -- they already hold a seat in. The union below selects the parent row and
    -- nothing else about it -- no children, no siblings, no occupants of any
    -- unit but their own. A sibling shares that same parent, and this query
    -- still cannot name it: sibling ids are never in the `seated` set, and the
    -- parent branch projects a single id, `p.id`, not `p`'s subtree.
    --
    -- The organization filters are load-bearing rather than decorative, on both
    -- halves. `governance_units.parent_id` is a self-reference with no
    -- organization of its own, so nothing stops a row pointing at a unit in
    -- another organization; the `p.organization_id` predicate is what keeps a
    -- cross-organization parent out of the result. `gu.organization_id` costs
    -- nothing and is the difference between a scoping bug being visible here and
    -- being invisible.
    with seated as (
      select gu.id, gu.parent_id
      from smartgov.unit_memberships m
      join public.governance_units gu on gu.id = m.unit_id
      join smartgov.roster r on r.id = m.roster_id
      where r.account_id = v_account.id
        and r.organization_id = v_account.organization_id
        and gu.organization_id = v_account.organization_id
        and m.end_date is null
    )
    select coalesce(array_agg(distinct visible.id), '{}'::uuid[]) into v_unit_ids
    from (
      select s.id from seated s
      union
      select p.id
      from seated s
      join public.governance_units p on p.id = s.parent_id
      where p.organization_id = v_account.organization_id
    ) visible;
  end if;

  if not v_is_owner and coalesce(array_length(v_unit_ids, 1), 0) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'no_unit');
  end if;

  select jsonb_build_object(
    'ok', true,
    'scope', case when v_is_owner then 'organization' else 'unit' end,
    -- The unit with no parent, drawn from the same `v_unit_ids` the rest of the
    -- response is filtered by. In unit scope that is the officer's own parent
    -- USG, which is in `v_unit_ids` because the aggregation above unions it in;
    -- for a unitary organization, where the council has no parent, it is the
    -- officer's own unit. Never resolved by walking `parent_id` from outside the
    -- array, because a row the filter did not admit must not be able to reach
    -- the payload by another route.
    'root', (
      select jsonb_build_object(
               'id', gu.id,
               'name', gu.name,
               'unitType', gu.unit_type
             )
      from public.governance_units gu
      where gu.id = any(v_unit_ids)
        and gu.parent_id is null
      order by gu.id
      limit 1
    ),
    -- A unit with no enabled seat still renders, with an empty `seats` array
    -- rather than being dropped: an empty card is what tells an owner the unit
    -- exists and still needs staffing.
    --
    -- `name` is projected alongside `unit` because the aggregate below orders by
    -- it: the row is built as one jsonb object, so without the bare column the
    -- `order by` has nothing to resolve against and the whole function fails at
    -- runtime for every caller. `gu.name` is already in the `group by`.
    'units', (
      select coalesce(jsonb_agg(t.unit order by t.name), '[]'::jsonb)
      from (
        select jsonb_build_object(
                 'id', gu.id,
                 'name', gu.name,
                 'unitType', gu.unit_type,
                 'parentId', gu.parent_id,
                 'seats', coalesce(
                   jsonb_agg(
                     jsonb_build_object(
                       'positionId', up.position_id,
                       'label', op.label,
                       'rosterId', um.roster_id,
                       'fullName', r.full_name,
                       'email', r.email,
                       'membershipId', um.id,
                       'startDate', um.start_date
                     )
                     order by op.sort_order, op.label
                   ) filter (where up.position_id is not null),
                   '[]'::jsonb
                 )
                ) as unit,
               gu.name as name
        from public.governance_units gu

        left join smartgov.unit_positions up on up.unit_id = gu.id
        left join smartgov.org_positions op on op.id = up.position_id
        left join smartgov.unit_memberships um
          on um.unit_id = up.unit_id
         and um.position_id = up.position_id
         and um.end_date is null
        left join smartgov.roster r on r.id = um.roster_id
        where gu.id = any(v_unit_ids)
        group by gu.id, gu.name, gu.unit_type, gu.parent_id
      ) t
    ),
    -- The organization template is returned to every scope. It names the
    -- positions the USG recognises and nothing about which units exist or who
    -- holds anything, so it is the same for an LSG officer as for the owner
    -- and is needed for their own seats to render at all.
    'positions', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object('id', op.id, 'label', op.label, 'sortOrder', op.sort_order)
          order by op.sort_order, op.label
        ),
        '[]'::jsonb
      )
      from smartgov.org_positions op
      where op.organization_id = v_account.organization_id
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function smartgov.unit_chart(text) from public;

-- ---------------------------------------------------------------- positions

-- A new position is enabled on every existing unit at the same time. A USG
-- with 24 colleges should not have to visit each one to make "Auditor" appear
-- -- and a position that exists in the template but nowhere else reads as a
-- bug to whoever is trying to staff it.
create or replace function smartgov.add_position(
  p_session_token text,
  p_label         text,
  p_sort_order    smallint default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public, smartgov, pg_temp
as $$
declare
  v_account     smartgov.accounts%rowtype;
  v_label       text := btrim(coalesce(p_label, ''));
  v_position_id uuid;
  v_seats       bigint;
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

  if v_label = '' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_label');
  end if;

  insert into smartgov.org_positions (organization_id, label, sort_order)
  values (v_account.organization_id, v_label, coalesce(p_sort_order, 0))
  returning id into v_position_id;

  insert into smartgov.unit_positions (unit_id, position_id)
  select gu.id, v_position_id
  from public.governance_units gu
  where gu.organization_id = v_account.organization_id
  on conflict do nothing;

  select count(*) into v_seats
  from smartgov.unit_positions
  where position_id = v_position_id;

  return jsonb_build_object(
    'ok', true,
    'positionId', v_position_id,
    'label', v_label,
    'enabledUnits', v_seats
  );
exception
  -- Rolls back to the entry of this block, so a rejected label leaves neither
  -- the position nor the seats behind.
  when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'duplicate_label');
end;
$$;

revoke all on function smartgov.add_position(text, text, smallint) from public;

-- Enabling and disabling one unit's seat. A disabled seat is a `unit_positions`
-- row that does not exist, so there is no flag to get out of step with the row.
create or replace function smartgov.toggle_unit_position(
  p_session_token text,
  p_unit_id       uuid,
  p_position_id   uuid,
  p_enabled       boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
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

  if p_unit_id is null or p_position_id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  -- Both ids are uuids and therefore guessable, and `unit_positions` carries no
  -- organization of its own. Resolving them against the caller's organization
  -- is the only thing stopping an owner from staffing somebody else's council.
  if not exists (
    select 1
    from public.governance_units gu
    where gu.id = p_unit_id
      and gu.organization_id = v_account.organization_id
  ) or not exists (
    select 1
    from smartgov.org_positions op
    where op.id = p_position_id
      and op.organization_id = v_account.organization_id
  ) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if coalesce(p_enabled, false) then
    insert into smartgov.unit_positions (unit_id, position_id)
    values (p_unit_id, p_position_id)
    on conflict do nothing;

    return jsonb_build_object(
      'ok', true,
      'unitId', p_unit_id,
      'positionId', p_position_id,
      'enabled', true
    );
  end if;

  -- Refused rather than performed: removing the seat would leave an active
  -- membership pointing at a position the unit no longer has, which reads as a
  -- corrupt chart and cannot be rendered. Release the officer first.
  if exists (
    select 1
    from smartgov.unit_memberships m
    where m.unit_id = p_unit_id
      and m.position_id = p_position_id
      and m.end_date is null
  ) then
    return jsonb_build_object('ok', false, 'reason', 'seat_occupied');
  end if;

  delete from smartgov.unit_positions
  where unit_id = p_unit_id
    and position_id = p_position_id;

  return jsonb_build_object(
    'ok', true,
    'unitId', p_unit_id,
    'positionId', p_position_id,
    'enabled', false
  );
end;
$$;

revoke all on function smartgov.toggle_unit_position(text, uuid, uuid, boolean) from public;

-- ---------------------------------------------------------------- occupants

-- Putting a person in a seat. The old holder's membership is closed rather than
-- deleted, and the partial unique index on (unit_id, position_id) is what makes
-- "one Treasurer" true rather than merely intended.
create or replace function smartgov.assign_officer(
  p_session_token text,
  p_unit_id       uuid,
  p_position_id   uuid,
  p_roster_id     uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, smartgov, pg_temp
as $$
declare
  v_account       smartgov.accounts%rowtype;
  v_membership_id uuid;
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

  if p_unit_id is null or p_position_id is null or p_roster_id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  if not exists (
    select 1
    from public.governance_units gu
    where gu.id = p_unit_id
      and gu.organization_id = v_account.organization_id
  ) or not exists (
    select 1
    from smartgov.org_positions op
    where op.id = p_position_id
      and op.organization_id = v_account.organization_id
  ) or not exists (
    select 1
    from smartgov.roster r
    where r.id = p_roster_id
      and r.organization_id = v_account.organization_id
  ) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if not exists (
    select 1
    from smartgov.unit_positions up
    where up.unit_id = p_unit_id
      and up.position_id = p_position_id
  ) then
    return jsonb_build_object('ok', false, 'reason', 'seat_not_enabled');
  end if;

  update smartgov.unit_memberships
     set end_date = current_date
   where unit_id = p_unit_id
     and position_id = p_position_id
     and end_date is null;

  insert into smartgov.unit_memberships (roster_id, unit_id, position_id)
  values (p_roster_id, p_unit_id, p_position_id)
  returning id into v_membership_id;

  return jsonb_build_object(
    'ok', true,
    'membershipId', v_membership_id,
    'unitId', p_unit_id,
    'positionId', p_position_id,
    'rosterId', p_roster_id
  );
exception
  -- Reached only when a concurrent call took the seat between the update above
  -- and this insert, or when the same person already holds a different seat in
  -- this unit. The rollback to the start of this block also undoes the close,
  -- so the previous holder stays in post rather than being emptied by a failed
  -- replacement. One reason covers both, because the caller only needs to know
  -- the assignment did not take and should re-read the chart.
  when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'seat_occupied');
end;
$$;

revoke all on function smartgov.assign_officer(text, uuid, uuid, uuid) from public;

-- Empties a seat. Nothing is deleted: the row is the record that this person
-- held this seat from this date to this date, and the whole point of dating
-- memberships is that last term stays answerable.
create or replace function smartgov.release_officer(
  p_session_token text,
  p_membership_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
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

  if p_membership_id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  -- Resolved through the unit rather than trusted, for the same reason as the
  -- ids above. An already-closed membership reports `not_found`: there is no
  -- active seat there to empty, and saying otherwise would be a second way to
  -- read the history.
  update smartgov.unit_memberships m
     set end_date = current_date
    from public.governance_units gu
   where m.id = p_membership_id
     and m.end_date is null
     and gu.id = m.unit_id
     and gu.organization_id = v_account.organization_id;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  return jsonb_build_object('ok', true, 'membershipId', p_membership_id);
end;
$$;

revoke all on function smartgov.release_officer(text, uuid) from public;

-- ---------------------------------------------------------------- PostgREST surface

-- Thin `public` entry points, in the shape 003 established: one-line
-- `security definer` forwarders, no logic, so a wrapper can never be stricter
-- or looser than the function it calls. They are required rather than
-- convenient -- 003 revoked execute on the `smartgov` originals and dropped the
-- blanket schema grant, so a function that has no wrapper is unreachable from
-- the browser.
--
-- The reachable surface grows from 13 to 18 here, and stays an explicit
-- list. `authenticate`, `sha256`, `hash_password`, `password_matches`,
-- `consume_rate_limit` and `refresh_invite_status` are still not published: a
-- caller must never be able to resolve a token to a password hash, use the
-- database as a bcrypt oracle, or spend somebody else's rate-limit budget.

create or replace function public.unit_chart(p_session_token text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.unit_chart(p_session_token); $$;

revoke all on function public.unit_chart(text) from public;
grant execute on function public.unit_chart(text) to anon, authenticated;

create or replace function public.add_position(
  p_session_token text,
  p_label         text,
  p_sort_order    smallint default 0
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.add_position(p_session_token, p_label, p_sort_order); $$;

revoke all on function public.add_position(text, text, smallint) from public;
grant execute on function public.add_position(text, text, smallint) to anon, authenticated;

create or replace function public.toggle_unit_position(
  p_session_token text,
  p_unit_id       uuid,
  p_position_id   uuid,
  p_enabled       boolean
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.toggle_unit_position(p_session_token, p_unit_id, p_position_id, p_enabled); $$;

revoke all on function public.toggle_unit_position(text, uuid, uuid, boolean) from public;
grant execute on function public.toggle_unit_position(text, uuid, uuid, boolean) to anon, authenticated;

create or replace function public.assign_officer(
  p_session_token text,
  p_unit_id       uuid,
  p_position_id   uuid,
  p_roster_id     uuid
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.assign_officer(p_session_token, p_unit_id, p_position_id, p_roster_id); $$;

revoke all on function public.assign_officer(text, uuid, uuid, uuid) from public;
grant execute on function public.assign_officer(text, uuid, uuid, uuid) to anon, authenticated;

create or replace function public.release_officer(
  p_session_token text,
  p_membership_id uuid
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.release_officer(p_session_token, p_membership_id); $$;

revoke all on function public.release_officer(text, uuid) from public;
grant execute on function public.release_officer(text, uuid) to anon, authenticated;
