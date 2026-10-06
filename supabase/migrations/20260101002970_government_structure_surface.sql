-- Government structure: the browser-facing surface, and the two existing reads
-- that now have person details to show.
--
-- The forwarders are the same one-line `security definer` shape 003 established
-- and 00800 listed explicitly: no logic, so a wrapper can never be stricter or
-- looser than the function it calls. 003 revoked execute on the `smartgov`
-- originals and dropped the blanket schema grant, so a function without a
-- wrapper here is unreachable from the app.

create or replace function public.list_structure_templates(p_session_token text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.list_structure_templates(p_session_token); $$;
revoke all on function public.list_structure_templates(text) from public;
grant execute on function public.list_structure_templates(text) to anon, authenticated;

create or replace function public.import_structure_template(
  p_session_token text, p_key text, p_name text,
  p_description text, p_category text, p_document jsonb
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.import_structure_template(p_session_token, p_key, p_name, p_description, p_category, p_document); $$;
revoke all on function public.import_structure_template(text, text, text, text, text, jsonb) from public;
grant execute on function public.import_structure_template(text, text, text, text, text, jsonb) to anon, authenticated;

create or replace function public.get_structure(p_session_token text, p_unit_id uuid)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.get_structure(p_session_token, p_unit_id); $$;
revoke all on function public.get_structure(text, uuid) from public;
grant execute on function public.get_structure(text, uuid) to anon, authenticated;

create or replace function public.save_structure_draft(
  p_session_token text, p_unit_id uuid, p_template_key text, p_term_label text,
  p_starts_on date, p_ends_on date, p_document jsonb, p_note text
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.save_structure_draft(p_session_token, p_unit_id, p_template_key, p_term_label, p_starts_on, p_ends_on, p_document, p_note); $$;
revoke all on function public.save_structure_draft(text, uuid, text, text, date, date, jsonb, text) from public;
grant execute on function public.save_structure_draft(text, uuid, text, text, date, date, jsonb, text) to anon, authenticated;

create or replace function public.submit_structure(p_session_token text, p_structure_id uuid, p_note text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.submit_structure(p_session_token, p_structure_id, p_note); $$;
revoke all on function public.submit_structure(text, uuid, text) from public;
grant execute on function public.submit_structure(text, uuid, text) to anon, authenticated;

create or replace function public.review_structure(p_session_token text, p_structure_id uuid, p_decision text, p_remark text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.review_structure(p_session_token, p_structure_id, p_decision, p_remark); $$;
revoke all on function public.review_structure(text, uuid, text, text) from public;
grant execute on function public.review_structure(text, uuid, text, text) to anon, authenticated;

create or replace function public.request_structure_renewal(
  p_session_token text, p_unit_id uuid, p_term_label text, p_starts_on date, p_ends_on date
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.request_structure_renewal(p_session_token, p_unit_id, p_term_label, p_starts_on, p_ends_on); $$;
revoke all on function public.request_structure_renewal(text, uuid, text, date, date) from public;
grant execute on function public.request_structure_renewal(text, uuid, text, date, date) to anon, authenticated;

create or replace function public.list_structure_queue(p_session_token text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.list_structure_queue(p_session_token); $$;
revoke all on function public.list_structure_queue(text) from public;
grant execute on function public.list_structure_queue(text) to anon, authenticated;

create or replace function public.match_structure_holder(p_session_token text, p_unit_id uuid, p_email text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.match_structure_holder(p_session_token, p_unit_id, p_email); $$;
revoke all on function public.match_structure_holder(text, uuid, text) from public;
grant execute on function public.match_structure_holder(text, uuid, text) to anon, authenticated;

create or replace function public.get_member_photo(p_session_token text, p_roster_id uuid)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.get_member_photo(p_session_token, p_roster_id); $$;
revoke all on function public.get_member_photo(text, uuid) from public;
grant execute on function public.get_member_photo(text, uuid) to anon, authenticated;

-- --------------------------------------------------- scoped roster for a builder

-- Who can be put in a seat, for one unit.
--
-- The builder needs a picker, and the picker must not become a way to read the
-- whole organization's membership. An LSG officer sees only the people already in
-- their own council plus the people seated in units below it; the USG side sees
-- the whole organization, because moving an officer between councils is its job.
--
-- `roster.full_name` and the new detail columns are returned; photo bytes are
-- not -- `hasPhoto` is, so the picker can show an avatar without pulling every
-- face in the organization over the wire.
create or replace function smartgov.list_structure_roster(
  p_session_token text,
  p_unit_id       uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account  smartgov.accounts%rowtype;
  v_access   jsonb;
  v_reviewer boolean;
  v_visible  uuid[];
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if v_account.organization_id is null or p_unit_id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  v_access := smartgov.gov_unit_access(v_account, p_unit_id);
  if not (v_access->>'canRead')::boolean then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  v_reviewer := v_account.account_scope = 'owner'
             or smartgov.is_org_reviewer(v_account.id, v_account.organization_id);
  v_visible  := smartgov.gov_visible_unit_ids(v_account);

  return jsonb_build_object(
    'ok', true,
    'scope', case when v_reviewer then 'organization' else 'unit' end,
    'roster', coalesce((
      select jsonb_agg(t.entry order by t.full_name)
        from (
          select r.full_name,
                 jsonb_build_object(
                   'rosterId', r.id,
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
                   'email', r.email,
                   'hasPhoto', r.photo_oid is not null,
                   'hasAccount', r.account_id is not null,
                   'seats', coalesce((
                     select jsonb_agg(jsonb_build_object(
                              'unitId', gu.id,
                              'unitName', gu.name,
                              'unitType', gu.unit_type,
                              'positionLabel', op.label
                            ) order by gu.name, op.sort_order)
                       from smartgov.unit_memberships m
                       join public.governance_units gu on gu.id = m.unit_id
                       join smartgov.org_positions op on op.id = m.position_id
                      where m.roster_id = r.id
                        and m.end_date is null
                        and gu.organization_id = v_account.organization_id
                   ), '[]'::jsonb)
                 ) as entry
            from smartgov.roster r
           where r.organization_id = v_account.organization_id
             and (
               v_reviewer
               or exists (
                 select 1
                   from smartgov.unit_memberships m
                  where m.roster_id = r.id
                    and m.end_date is null
                    and m.unit_id = any (v_visible)
               )
             )
        ) t
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function smartgov.list_structure_roster(text, uuid) from public;

-- Its forwarder is declared here rather than in the block at the top of this
-- file: a `language sql` function's body is resolved when it is created, so the
-- wrapper cannot precede the function it forwards to.
create or replace function public.list_structure_roster(p_session_token text, p_unit_id uuid)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.list_structure_roster(p_session_token, p_unit_id); $$;
revoke all on function public.list_structure_roster(text, uuid) from public;
grant execute on function public.list_structure_roster(text, uuid) to anon, authenticated;

-- ------------------------------------------------ roster picker (owner view)

-- Same signature and same owner-only gate as 01000; the projection grows the
-- detail columns the brief asks for, because a picker that cannot show a course
-- or a year level cannot prefill a seat. The full personal record is deliberately
-- NOT returned here -- `list_structure_roster` is the surface that carries it, and
-- only for units the caller may read.
create or replace function smartgov.list_roster(p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account  smartgov.accounts%rowtype;
  v_is_owner boolean := false;
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if v_account.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;

  select exists (
    select 1 from public.organization_members m
    where m.organization_id = v_account.organization_id
      and m.email = v_account.email
      and m.is_founding
  ) into v_is_owner;

  if not v_is_owner then
    return jsonb_build_object('ok', false, 'reason', 'not_organization_founder');
  end if;

  return jsonb_build_object(
    'ok', true,
    'roster', (
      select coalesce(jsonb_agg(t.r order by t.full_name), '[]'::jsonb)
      from (
        select jsonb_build_object(
          'rosterId', r.id,
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
          'email',    r.email,
          'hasPhoto', r.photo_oid is not null
        ) as r
        from smartgov.roster r
        where r.organization_id = v_account.organization_id
      ) t
    )
  );
end;
$$;

revoke all on function smartgov.list_roster(text) from public;

-- ------------------------------------------------------------- unit_chart

-- Replaced rather than wrapped: the scoping logic in 00800 -- owner sees the
-- organization, an officer sees the units it is seated in plus their parents,
-- with every query filtered on the resolved id array -- is carried over
-- unchanged, and the only difference is that a seat now carries the member's
-- details. Everything 00800 says about why the filter happens in SQL rather than
-- in TypeScript still applies, and none of its guards are relaxed here.
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
          jsonb_build_object('id', op.id, 'label', op.label, 'sortOrder', op.sort_order)
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