-- 03020 -- the org chart honours structure authorship, not only seating.
--
-- 00800 scopes `unit_chart` on where somebody is seated. That was the only way to
-- earn a chart, and for two years it was the only thing that existed. Approval
-- changed the arithmetic: applying a structure closes and rewrites the memberships
-- it names, so an officer who wrote their council's structure and named somebody
-- else in their own chair stops being seated at the moment the USG approves it.
--
-- The result was a real hole. The author kept their structure -- 02990 gave them
-- read and edit on it -- and lost the chart of the very council they had just
-- written. Renewal, which needs `canEdit`, worked; seeing the government they had
-- just published did not. Seating is a statement about a term, and the term ended.
--
-- So `unit_chart`'s non-owner branch gains the authored units, and -- matching what
-- seating already buys -- their immediate parents, so the chart an author sees is
-- shaped like the chart an officer sees rather than starting in the middle.
--
-- The owner branch is untouched: it already sees every unit, and nothing here is
-- about narrowing or widening that.
--
-- `gov_authored_unit_ids` is the single definition of "authored", shared with
-- `gov_unit_access`. It used to be an inline `exists` in that function only, and
-- having the chart and the structure gate answer the question separately is exactly
-- the drift this schema's other comments warn about: the day one gains a clause the
-- other silently does not.

create or replace function smartgov.gov_authored_unit_ids(p_account smartgov.accounts)
returns uuid[]
language sql stable
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
  select coalesce(array_agg(distinct s.unit_id), '{}'::uuid[])
    from smartgov.gov_structures s
   where s.organization_id = p_account.organization_id
     and s.created_by = p_account.id
     -- A rejected attempt is not a claim on anybody's council. Without this, being
     -- refused once would hand the caller edit rights over a structure they were
     -- never allowed to propose.
     and s.status <> 'rejected';
$$;

revoke all on function smartgov.gov_authored_unit_ids(smartgov.accounts) from public;

create or replace function smartgov.gov_unit_access(
  p_account  smartgov.accounts,
  p_unit_id  uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_type      public.unit_type;
  v_reviewer  boolean;
  v_seated    uuid[];
  v_visible   uuid[];
  v_authored  boolean;
begin
  if p_account.id is null or p_account.organization_id is null or p_unit_id is null then
    return jsonb_build_object('canRead', false, 'canEdit', false, 'isReviewer', false);
  end if;

  select gu.unit_type into v_type
    from public.governance_units gu
   where gu.id = p_unit_id
     and gu.organization_id = p_account.organization_id;

  if v_type is null then
    return jsonb_build_object('canRead', false, 'canEdit', false, 'isReviewer', false);
  end if;

  v_reviewer := p_account.account_scope = 'owner'
             or smartgov.is_org_reviewer(p_account.id, p_account.organization_id);

  v_seated  := smartgov.gov_seated_unit_ids(p_account);
  v_visible := smartgov.gov_visible_unit_ids(p_account);

  v_authored := p_unit_id = any (smartgov.gov_authored_unit_ids(p_account));

  return jsonb_build_object(
    -- Authoring buys read as well as edit, and that is not a convenience. Approval
    -- rewrites the seats the document names, so the officer who wrote the
    -- structure stops being seated the moment it is approved -- and a read gate
    -- that follows the seat would hide from them the very structure they just
    -- wrote, including what the reviewer decided about it.
    'canRead', v_reviewer or p_unit_id = any (v_visible) or v_authored,
    'canEdit', v_type <> 'committee'
               and (
                     p_unit_id = any (v_seated)
                     or v_authored
                     or (p_account.account_scope = 'owner'
                         and p_unit_id = smartgov.gov_root_unit(p_account.organization_id))
                   ),
    'isReviewer', v_reviewer
  );
end;
$$;

revoke all on function smartgov.gov_unit_access(smartgov.accounts, uuid) from public;

-- 00800's scoping, carried over as 02970 carried it, with one clause added. Its
-- guards are not relaxed: the id array is still resolved in SQL, every query is
-- still filtered on it, and an officer with neither a seat nor an authorship still
-- gets `no_unit` rather than an empty organization.
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
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if v_account.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;

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
    with seated as (
      select gu.id, gu.parent_id
      from smartgov.unit_memberships m
      join public.governance_units gu on gu.id = m.unit_id
      join smartgov.roster r on r.id = m.roster_id
      where r.account_id = v_account.id
        and r.organization_id = v_account.organization_id
        and gu.organization_id = v_account.organization_id
        and m.end_date is null
    ),
    -- The added clause. An authored unit is claimed the same way a seat is, which
    -- is what stops a council's own author from losing the council the moment
    -- their structure was approved.
    authored as (
      select gu.id, gu.parent_id
      from smartgov.gov_structures s
      join public.governance_units gu on gu.id = s.unit_id
      where s.organization_id = v_account.organization_id
        and s.created_by = v_account.id
        and s.status <> 'rejected'
    ),
    mine as (
      select id, parent_id from seated
      union
      select id, parent_id from authored
    )
    select coalesce(array_agg(distinct visible.id), '{}'::uuid[]) into v_unit_ids
    from (
      select m.id from mine m
      union
      select p.id
      from mine m
      join public.governance_units p on p.id = m.parent_id
      where p.organization_id = v_account.organization_id
    ) visible;
  end if;

  if not v_is_owner and coalesce(array_length(v_unit_ids, 1), 0) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'no_unit');
  end if;

  return jsonb_build_object(
    'ok', true,
    'scope', case when v_is_owner then 'organization' else 'unit' end,
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
    'units', (
      select coalesce(jsonb_agg(t.unit order by t.name), '[]'::jsonb)
      from (
        select jsonb_build_object(
                 'id', gu.id,
                 'name', gu.name,
                 'unitType', gu.unit_type,
                 'parentId', gu.parent_id,
                 -- Lets the chart tell a committee apart from a college without a
                 -- second read, which matters now that approval materializes one.
                 'structureKey', gu.structure_key,
                 'seats', coalesce(
                   jsonb_agg(
                     jsonb_build_object(
                       'positionId', up.position_id,
                       'label', op.label,
                       'rosterId', um.roster_id,
                       'fullName', r.full_name,
                       'firstName', r.first_name,
                       'middleName', r.middle_name,
                       'lastName', r.last_name,
                       'birthdate', r.birthdate,
                       'course', r.course,
                       'yearLevel', r.year_level,
                       'gender', r.gender,
                       'contactNumber', r.contact_number,
                       'address', r.address,
                       'hasPhoto', r.photo_oid is not null,
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
        group by gu.id, gu.name, gu.unit_type, gu.parent_id, gu.structure_key
      ) t
    ),
    'positions', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', op.id, 'label', op.label, 'sortOrder', op.sort_order
          )
          order by op.sort_order, op.label
        ),
        '[]'::jsonb
      )
      from smartgov.org_positions op
      where op.organization_id = v_account.organization_id
    )
  );
end;
$$;

revoke all on function smartgov.unit_chart(text) from public;

create or replace function public.unit_chart(p_session_token text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.unit_chart(p_session_token); $$;
revoke all on function public.unit_chart(text) from public;
grant execute on function public.unit_chart(text) to anon, authenticated;