-- 02990 -- government structure: who may see which people, and who may keep
-- editing a structure after approval changes their own seat.
--
-- Two problems, both about people rather than documents:
--
--   1. `list_structure_roster` and `get_member_photo` gated on
--      `gov_visible_unit_ids`, which walks *upward*. An LSG officer seated in one
--      college therefore also matched every membership in the USG root above it, and
--      the picker returned the whole university government -- names, addresses,
--      contact numbers, birthdates and photographs -- while the function's own
--      comment promised "only the people already in their own council plus the
--      people seated in units below it". Reading a parent's *chart* is legitimate
--      and is what `unit_chart` does; enumerating a parent's *membership* is not,
--      and the roster picker has no reason to walk in that direction at all.
--
--   2. Approval rewrites the seats it names, which closes the membership of the
--      officer who built the structure whenever the document puts somebody else in
--      their chair. That member then holds no seat anywhere, so `gov_unit_access`
--      stops granting `canEdit` -- and the person who wrote the council's structure
--      could neither renew it, nor fix a mistake in it, ever again. Seating is a
--      statement about a term; authoring is a statement about the unit.

-- ------------------------------------------------------------- unit scoping

-- A unit and everything under it.
--
-- Separate from `gov_visible_unit_ids` rather than a filter on it, because the two
-- answer different questions. Visibility is "what may this person read", and
-- answering it upward is what lets a USG board member read a college's structure
-- without being on its roster. People-scoping is "whose membership may I enumerate",
-- and the honest answer to that is downward: your own unit, and the units you are
-- responsible for. Keeping them apart also means the `depth < 20` cycle guard here
-- is independent of the one over there.
create or replace function smartgov.gov_descendant_unit_ids(
  p_organization uuid,
  p_unit_id      uuid
)
returns uuid[]
language sql stable
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
  with recursive down as (
    select gu.id, gu.parent_id, 0 as depth
      from public.governance_units gu
     where gu.id = p_unit_id
       and gu.organization_id = p_organization
    union all
    select child.id, child.parent_id, down.depth + 1
      from public.governance_units child
      join down on down.id = child.parent_id
     where child.organization_id = p_organization
       and down.depth < 20
  )
  select coalesce(array_agg(distinct down.id), '{}'::uuid[])
    from down;
$$;

revoke all on function smartgov.gov_descendant_unit_ids(uuid, uuid) from public;

-- The units whose membership a non-reviewer may enumerate: everything at or below
-- every unit they are seated in. An LSG officer gets their own council and its
-- committees; a USG board member, seated in the root, gets the organization -- which
-- is the right answer for them and is why reviewers keep the blanket scope instead.
create or replace function smartgov.gov_people_unit_ids(p_account smartgov.accounts)
returns uuid[]
language sql stable
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
  select coalesce(array_agg(distinct d.id), '{}'::uuid[])
    from smartgov.gov_seated_unit_ids(p_account) s
    cross join lateral unnest(s) as seat(id)
    cross join lateral smartgov.gov_descendant_unit_ids(
      p_account.organization_id, seat.id) as d(id);
$$;

revoke all on function smartgov.gov_people_unit_ids(smartgov.accounts) from public;

-- ------------------------------------------------------------------- access

-- `canEdit` gains one clause: having authored a structure for this unit keeps that
-- right, whatever the document later says about their own seat.
--
-- It is deliberately narrow. Authoring a *rejected* structure does not count, so a
-- refused attempt is not a way to stake a claim on somebody else's council, and
-- `save_structure_draft` already refuses to touch a structure while a reviewer holds
-- it -- so this cannot become a way to edit a submission under the reviewer reading
-- it. It also does not reach across committees: a committee's seats come from its
-- parent's structure, so `v_type <> 'committee'` still stands.
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

  select exists (
    select 1
      from smartgov.gov_structures s
     where s.unit_id = p_unit_id
       and s.organization_id = p_account.organization_id
       and s.created_by = p_account.id
       and s.status <> 'rejected'
  ) into v_authored;

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

-- ------------------------------------------------------------- scoped roster

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
  v_people   uuid[];
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
  v_people   := smartgov.gov_people_unit_ids(v_account);

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
                        -- Same narrowing as the outer query: a member's entry must
                        -- not advertise seats in a unit the caller cannot enumerate.
                        and (v_reviewer or m.unit_id = any (v_people))
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
                    and m.unit_id = any (v_people)
               )
             )
        ) t
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function smartgov.list_structure_roster(text, uuid) from public;

create or replace function public.list_structure_roster(p_session_token text, p_unit_id uuid)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.list_structure_roster(p_session_token, p_unit_id); $$;
revoke all on function public.list_structure_roster(text, uuid) from public;
grant execute on function public.list_structure_roster(text, uuid) to anon, authenticated;

-- ------------------------------------------------------------------ a photo

create or replace function smartgov.get_member_photo(
  p_session_token text,
  p_roster_id     uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account  smartgov.accounts%rowtype;
  v_reviewer boolean;
  v_people   uuid[];
  v_oid      oid;
  v_mime     text;
  v_bytes    bytea;
  v_allowed  boolean := false;
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if v_account.organization_id is null or p_roster_id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  v_reviewer := v_account.account_scope = 'owner'
             or smartgov.is_org_reviewer(v_account.id, v_account.organization_id);
  v_people   := smartgov.gov_people_unit_ids(v_account);

  if not v_reviewer then
    select exists (
      select 1
        from smartgov.unit_memberships m
       where m.roster_id = p_roster_id
         and m.end_date is null
         and m.unit_id = any (v_people)
    ) into v_allowed;
  else
    v_allowed := true;
  end if;

  if not v_allowed then
    -- Checked before the roster read so an unprivileged call cannot distinguish
    -- "no such person" from "not yours".
    if not exists (
      select 1 from smartgov.roster r
       where r.id = p_roster_id
         and r.organization_id = v_account.organization_id
    ) then
      return jsonb_build_object('ok', false, 'reason', 'not_found');
    end if;
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  select r.photo_oid, r.photo_mime into v_oid, v_mime
    from smartgov.roster r
   where r.id = p_roster_id
     and r.organization_id = v_account.organization_id;

  if v_oid is null then
    return jsonb_build_object('ok', true, 'mime', null, 'bytes', 0, 'base64', null);
  end if;

  -- One read, not two. `lo_get` copies the whole object out of `pg_largeobject`,
  -- and 02960 asked for the length and the payload separately -- two copies of up
  -- to 512 KiB on a call the builder makes once per avatar it renders.
  v_bytes := lo_get(v_oid);

  return jsonb_build_object(
    'ok', true,
    'mime', coalesce(v_mime, 'image/jpeg'),
    'bytes', length(v_bytes),
    -- The newlines are stripped because `encode(..., 'base64')` wraps its output
    -- every 76 characters, per its own documentation, and there is no option to
    -- turn that off. It is not cosmetic: a client that compares, caches or
    -- re-uploads this string would be comparing a wrapped string against an unwrapped
    -- one, and the 1 MiB ceiling in `gov_document_valid` would be measuring padding.
    -- `decode` ignores whitespace, so the write path was never affected.
    'base64', regexp_replace(encode(v_bytes, 'base64'), E'\n', '', 'g')
  );
exception
  -- A large object can go missing independently of its row if something outside
  -- this schema ever unlinks it. That is an absent photo, not a failed request.
  when undefined_object then
    return jsonb_build_object('ok', true, 'mime', null, 'bytes', 0, 'base64', null);
end;
$$;

revoke all on function smartgov.get_member_photo(text, uuid) from public;

create or replace function public.get_member_photo(p_session_token text, p_roster_id uuid)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.get_member_photo(p_session_token, p_roster_id); $$;
revoke all on function public.get_member_photo(text, uuid) from public;
grant execute on function public.get_member_photo(text, uuid) to anon, authenticated;

-- `list_roster` is deliberately left as 02970 left it. It answers for the founding
-- member only and returns `not_organization_founder` to everyone else, so there is
-- no upward walk in it to narrow -- and its response shape is what the existing
-- members screen reads. Changing it to a scoped picker would be a second feature
-- wearing this migration's clothes.