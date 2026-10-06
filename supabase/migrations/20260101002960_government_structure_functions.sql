-- Government structure: the functions that build, gate and apply it.
--
-- The rule this file exists to enforce
-- ----------------------------------
-- A council's structure takes effect only when the right side approved it:
--
--   * A unit's structure is authored by whoever is seated in that unit. An LSG
--     officer edits their own council. A USG board member edits the USG's own
--     structure. Nobody edits another council's draft -- that is what the USG
--     review step is for, and giving the USG a draft-editing back door would
--     make the approval it grants meaningless.
--   * Whether approval is needed follows the *unit*, not the person. A structure
--     for the top-tier unit (the `usg` unit, or the single `council` in a unitary
--     organization) is the top of the hierarchy and takes effect on submit, the
--     same way 02000 lets a USG-authored proposal publish directly. Any other
--     unit's structure is submitted and waits for the USG.
--   * That second rule is why `author_kind` is derived from `p_unit_id` and not
--     from the caller's side. An account seated in both an LSG council and the
--     USG board is a reviewer everywhere; if "am I a reviewer" decided whether a
--     submit auto-approved, that one person could approve their own council's
--     structure and the gate would be theatre.
--
-- Everything below is reached only through the `public` forwarders in 02970.

-- ------------------------------------------------------------------ scoping

-- The unit an organization sits at the top of. `usg` wins over a rootless row
-- because a federated organization has both a `usg` row and possibly a rootless
-- one only in a unitary; ordering by `usg` first makes the federated case
-- explicit rather than accidental.
create or replace function smartgov.gov_root_unit(p_organization uuid)
returns uuid
language sql stable
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
  select gu.id
    from public.governance_units gu
   where gu.organization_id = p_organization
   order by (gu.unit_type = 'usg') desc,
            (gu.parent_id is null) desc,
            gu.created_at
   limit 1;
$$;

revoke all on function smartgov.gov_root_unit(uuid) from public;

-- Units the account currently holds a seat in.
create or replace function smartgov.gov_seated_unit_ids(p_account smartgov.accounts)
returns uuid[]
language sql stable
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
  select coalesce(array_agg(distinct u), '{}'::uuid[])
    from smartgov.lsg_unit_ids(p_account.id, p_account.organization_id) u;
$$;

revoke all on function smartgov.gov_seated_unit_ids(smartgov.accounts) from public;

-- Units the account can read: the ones it is seated in, plus every ancestor of
-- each. The ancestors are what let a USG board member read the structure of a
-- college LSG without being on the college's roster.
--
-- Deliberately NOT a rewrite of `unit_chart`'s visibility: that function only
-- unions in the immediate parent and its comments are load-bearing, and copying
-- it here with the extra levels would leave two slightly different answers to
-- "what can this person see" in the schema. The `depth < 20` guard is there so a
-- cycle introduced by a bad `parent_id` edit ends the recursion instead of
-- running until the backend gives up.
create or replace function smartgov.gov_visible_unit_ids(p_account smartgov.accounts)
returns uuid[]
language sql stable
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
  with recursive up as (
    select gu.id, gu.parent_id, 0 as depth
      from smartgov.unit_memberships m
      join public.governance_units gu on gu.id = m.unit_id
     where m.end_date is null
       and gu.organization_id = p_account.organization_id
       and m.roster_id in (
             select r.id
               from smartgov.roster r
              where r.account_id = p_account.id
                and r.organization_id = p_account.organization_id
           )
    union all
    select parent.id, parent.parent_id, up.depth + 1
      from public.governance_units parent
      join up on up.parent_id = parent.id
     where parent.organization_id = p_account.organization_id
       and up.depth < 20
  )
  select coalesce(array_agg(distinct up.id), '{}'::uuid[])
    from up;
$$;

revoke all on function smartgov.gov_visible_unit_ids(smartgov.accounts) from public;

-- One place that answers "may this account touch this unit's structure".
-- `gov_unit_access` is called by every read and every write here so the matrix
-- cannot drift between them.
--
--   canRead  -- reviewer (sees every structure it must review), or the unit is
--               one this account can see.
--   canEdit  -- seated in the unit, or the owner and the unit is the top tier.
--   reviewer -- owner or a seat on the USG board, i.e. `is_org_reviewer`.
--
-- A `committee` unit can never be edited on its own: its seats come from its
-- parent's structure, so a committee is a row the materializer writes, not a
-- thing somebody authors.
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

  return jsonb_build_object(
    'canRead', v_reviewer or p_unit_id = any (v_visible),
    'canEdit', v_type <> 'committee'
               and (
                     p_unit_id = any (v_seated)
                     or (p_account.account_scope = 'owner'
                         and p_unit_id = smartgov.gov_root_unit(p_account.organization_id))
                   ),
    'isReviewer', v_reviewer
  );
end;
$$;

revoke all on function smartgov.gov_unit_access(smartgov.accounts, uuid) from public;

-- ---------------------------------------------------------------- validation

-- The one validator, used by the draft editor, the template importer and the
-- submit gate alike, so a document that cannot be saved is also a document that
-- cannot be submitted and cannot be imported as a template.
--
-- The reason is coarse on purpose -- the client maps reasons to copy, and a
-- builder has hundreds of inputs, so a second coarse reason would be useless.
-- `detail` carries the committee or seat name so the UI can point at the row.
--
-- Bounds, and why each is here:
--   30 committees / 40 seats -- a council larger than that is not a council, and
--     an unbounded array would let one submit turn into thousands of rows.
--   email required on a filled seat -- `roster` is keyed by address and the invite
--     flow is keyed by address; a seat filled by name alone could not be
--     re-invited or matched to an account.
--   no `isUnit` after the first -- the first committee is the unit itself, and a
--     second one would put two sets of board seats on the same unit.
create or replace function smartgov.gov_document_valid(
  p_document      jsonb,
  p_allow_holders boolean default true
)
returns jsonb
language plpgsql
immutable
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_committees jsonb;
  v_ci         int;
  v_pi         int;
  v_c          jsonb;
  v_p          jsonb;
  v_h          jsonb;
  v_key        text;
  v_title      text;
  v_seen_c     text[] := '{}';
  v_seen_p     text[];
  v_email      text;
  v_name       text;
  v_seen_unit  boolean := false;
begin
  if jsonb_typeof(p_document) <> 'object'
     or jsonb_typeof(p_document->'committees') <> 'array'
     or jsonb_array_length(p_document->'committees') < 1
     or jsonb_array_length(p_document->'committees') > 30 then
    return jsonb_build_object(
      'ok', false, 'reason', 'invalid_request',
      'detail', 'A structure needs between 1 and 30 committees.');
  end if;

  v_committees := p_document->'committees';

  for v_ci in 0 .. jsonb_array_length(v_committees) - 1 loop
    v_c := v_committees->v_ci;
    v_key := btrim(coalesce(v_c->>'key', ''));

    if length(v_key) < 1 or length(v_key) > 60 then
      return jsonb_build_object(
        'ok', false, 'reason', 'invalid_request',
        'detail', format('Committee %s has no usable key.', v_ci + 1));
    end if;

    if v_key = any (v_seen_c) then
      return jsonb_build_object(
        'ok', false, 'reason', 'duplicate_committee_key',
        'detail', format('Two committees share the key "%s".', v_key));
    end if;
    v_seen_c := array_append(v_seen_c, v_key);

    if coalesce((v_c->>'isUnit')::boolean, false) then
      if v_seen_unit then
        return jsonb_build_object(
          'ok', false, 'reason', 'invalid_request',
          'detail', 'Only the first committee can be the council itself.');
      end if;
      v_seen_unit := true;
    end if;

    if length(btrim(coalesce(v_c->>'name', ''))) not between 1 and 120 then
      return jsonb_build_object(
        'ok', false, 'reason', 'invalid_request',
        'detail', format('Committee "%s" needs a name of 1 to 120 characters.', v_key));
    end if;

    if length(coalesce(v_c->>'description', '')) > 400 then
      return jsonb_build_object(
        'ok', false, 'reason', 'invalid_request',
        'detail', format('The description for "%s" is over 400 characters.', v_key));
    end if;

    if jsonb_typeof(v_c->'positions') <> 'array'
       or jsonb_array_length(v_c->'positions') < 1
       or jsonb_array_length(v_c->'positions') > 40 then
      return jsonb_build_object(
        'ok', false, 'reason', 'invalid_request',
        'detail', format('"%s" needs between 1 and 40 seats.', v_key));
    end if;

    v_seen_p := '{}';

    for v_pi in 0 .. jsonb_array_length(v_c->'positions') - 1 loop
      v_p := v_c->'positions'->v_pi;
      v_key := btrim(coalesce(v_p->>'key', ''));

      if length(v_key) < 1 or length(v_key) > 60 then
        return jsonb_build_object(
          'ok', false, 'reason', 'invalid_request',
          'detail', format('A seat in "%s" has no usable key.',
                           btrim(coalesce(v_c->>'name', ''))));
      end if;

      if v_key = any (v_seen_p) then
        return jsonb_build_object(
          'ok', false, 'reason', 'duplicate_position_key',
          'detail', format('Two seats in "%s" share the key "%s".',
                           btrim(coalesce(v_c->>'name', '')), v_key));
      end if;
      v_seen_p := array_append(v_seen_p, v_key);

      v_title := btrim(coalesce(v_p->>'title', ''));
      if length(v_title) not between 1 and 80 then
        return jsonb_build_object(
          'ok', false, 'reason', 'invalid_request',
          'detail', format('A seat in "%s" needs a title of 1 to 80 characters.',
                           btrim(coalesce(v_c->>'name', ''))));
      end if;

      v_h := v_p->'holder';

      if v_h is null or v_h = 'null'::jsonb then
        continue;
      end if;

      if jsonb_typeof(v_h) <> 'object' or v_h = '{}'::jsonb then
        -- An explicit empty object is the client saying "vacant".
        continue;
      end if;

      if not p_allow_holders then
        return jsonb_build_object(
          'ok', false, 'reason', 'invalid_request',
          'detail', format('A template cannot name people, but "%s / %s" does.',
                           btrim(coalesce(v_c->>'name', '')), v_title));
      end if;

      v_email := lower(btrim(coalesce(v_h->>'email', '')));
      v_name  := btrim(concat_ws(' ',
                    coalesce(v_h->>'firstName', ''),
                    coalesce(v_h->>'middleName', ''),
                    coalesce(v_h->>'lastName', '')));

      if v_name = '' then
        v_name := btrim(coalesce(v_h->>'fullName', ''));
      end if;

      if v_email = '' or position('@' in v_email) < 2
         or length(v_email) > 254 then
        return jsonb_build_object(
          'ok', false, 'reason', 'invalid_request',
          'detail', format('"%s" needs a valid email address.', v_title));
      end if;

      if length(v_name) not between 1 and 200 then
        return jsonb_build_object(
          'ok', false, 'reason', 'invalid_request',
          'detail', format('"%s" needs a name.', v_title));
      end if;

      -- A photo arrives base64-encoded. 512 KiB is the 02950 ceiling, and base64
      -- of that is a little over 700 KB, so 1 MiB of text is a generous ceiling
      -- that still refuses a megabyte-scale upload pretending to be a photo.
      if v_h ? 'photo'
         and length(coalesce(v_h->>'photo', '')) > 1048576 then
        return jsonb_build_object(
          'ok', false, 'reason', 'invalid_request',
          'detail', format('The photo for "%s" is too large.', v_title));
      end if;

      if coalesce(v_h->>'gender', 'prefer_not_to_say')
         not in ('female','male','other','prefer_not_to_say') then
        return jsonb_build_object(
          'ok', false, 'reason', 'invalid_request',
          'detail', format('"%s" has an unrecognised gender value.', v_title));
      end if;

      if coalesce(v_h->>'birthdate', '') <> ''
         and (v_h->>'birthdate') !~ '^\d{4}-\d{2}-\d{2}$' then
        return jsonb_build_object(
          'ok', false, 'reason', 'invalid_request',
          'detail', format('"%s" has a malformed birthdate.', v_title));
      end if;
    end loop;
  end loop;

  if not v_seen_unit then
    -- Not fatal on its own: a structure of only sub-committees is odd but not
    -- wrong, and the materializer handles it. The gate is here so the builder can
    -- show a warning, not to refuse.
    return jsonb_build_object(
      'ok', true, 'warning', 'no_unit_committee');
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function smartgov.gov_document_valid(jsonb, boolean) from public;

-- ---------------------------------------------------------- photo bookkeeping

-- Reads never carry photo bytes. A structure document round-trips through the
-- browser on every keystroke-batch, and 512 KiB of base64 per member would make
-- the payload unusable and put every member's face in a JSON response that ends
-- up in browser logs. The client learns "there is a photo" from `hasPhoto` and
-- fetches the image only for the seat being looked at.
create or replace function smartgov.gov_strip_photos(p_document jsonb)
returns jsonb
language sql immutable
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
  select case
    when jsonb_typeof(p_document) <> 'object'
      or jsonb_typeof(p_document->'committees') <> 'array'
      then p_document
    else coalesce((
      select jsonb_agg(
               jsonb_set(
                 c.value, '{positions}',
                 coalesce(
                   (select jsonb_agg(
                             case when jsonb_typeof(p.value->'holder') = 'object'
                                  then jsonb_set(p.value, '{holder}',
                                                 (p.value->'holder') - 'photo')
                                  else p.value
                             end)
                      from jsonb_array_elements(
                             case when jsonb_typeof(c.value->'positions') = 'array'
                                  then c.value->'positions' else '[]'::jsonb end) p
                   ), '[]'::jsonb)
               )
             )
        from jsonb_array_elements(p_document->'committees') c
    ), '[]'::jsonb)
  end;
$$;

revoke all on function smartgov.gov_strip_photos(jsonb) from public;

-- The counterpart: after stripping, mark the holders who already have a stored
-- photo so the builder can show an avatar for a seat it cannot re-upload bytes
-- for. Without it, editing any other seat would make every existing photo
-- disappear from the form.
create or replace function smartgov.gov_mark_existing_photos(
  p_organization uuid,
  p_document     jsonb
)
returns jsonb
language sql stable
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
  select case
    when jsonb_typeof(p_document) <> 'object'
      or jsonb_typeof(p_document->'committees') <> 'array'
      then p_document
    else coalesce((
      select jsonb_agg(
               jsonb_set(
                 c.value, '{positions}',
                 coalesce(
                   (select jsonb_agg(
                             case when jsonb_typeof(p.value->'holder') = 'object'
                                  then p.value->'holder'
                                       || jsonb_build_object(
                                            'hasPhoto',
                                            exists (
                                              select 1
                                                from smartgov.roster r
                                               where r.organization_id = p_organization
                                                 and lower(r.email) = lower(
                                                       btrim(coalesce(p.value->'holder'->>'email', '')))
                                                 and r.photo_oid is not null
                                            )
                                          )
                                  else p.value
                             end)
                      from jsonb_array_elements(
                             case when jsonb_typeof(c.value->'positions') = 'array'
                                  then c.value->'positions' else '[]'::jsonb end) p
                   ), '[]'::jsonb)
               )
             )
        from jsonb_array_elements(p_document->'committees') c
    ), '[]'::jsonb)
  end;
$$;

revoke all on function smartgov.gov_mark_existing_photos(uuid, jsonb) from public;

-- Large objects outlive the roster row unless something unlinks them, so the
-- delete does it. Same reason 02700 cleans up orphan document objects: a photo
-- left behind is a member's face in a database nobody is looking at.
create or replace function smartgov.roster_photo_purge()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
begin
  if old.photo_oid is not null then
    perform lo_unlink(old.photo_oid);
  end if;
  return old;
end;
$$;

revoke all on function smartgov.roster_photo_purge() from public;

drop trigger if exists roster_photo_purge_trg on smartgov.roster;

create trigger roster_photo_purge_trg
  before delete on smartgov.roster
  for each row execute function smartgov.roster_photo_purge();

-- ------------------------------------------------------------ holder upsert

-- One member, one roster row, addressed by email.
--
-- `full_name` is written from the parts when there are any so the chart, the
-- roster picker and the invite email all keep showing a real name; an empty
-- holder part set falls back to the caller's `fullName` and finally to the
-- address, because `roster.full_name` is `not null` and the invite path already
-- uses the address as the placeholder name.
--
-- The photo is write-only: present means replace, absent means leave alone. That
-- is what lets a builder save a document it read with the photos stripped from
-- it without wiping every avatar on the way past.
create or replace function smartgov.gov_upsert_holder(
  p_organization uuid,
  p_holder       jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_email    text := lower(btrim(coalesce(p_holder->>'email', '')));
  v_first    text := btrim(coalesce(p_holder->>'firstName', ''));
  v_middle   text := btrim(coalesce(p_holder->>'middleName', ''));
  v_last     text := btrim(coalesce(p_holder->>'lastName', ''));
  v_full     text := btrim(concat_ws(' ', v_first, v_middle, v_last));
  v_birth    date;
  v_gender   text;
  v_photo    bytea;
  v_new_oid  oid;
  v_old_oid  oid;
  v_roster   uuid;
begin
  if v_full = '' then
    v_full := btrim(coalesce(p_holder->>'fullName', ''));
  end if;
  if v_full = '' then
    v_full := v_email;
  end if;

  v_gender := coalesce(nullif(btrim(coalesce(p_holder->>'gender', '')), ''), 'prefer_not_to_say');

  if coalesce(btrim(coalesce(p_holder->>'birthdate', '')), '') <> '' then
    v_birth := (p_holder->>'birthdate')::date;
  end if;

  if p_holder ? 'photo' and length(coalesce(p_holder->>'photo', '')) > 0 then
    begin
      v_photo := decode(p_holder->>'photo', 'base64');
    exception when others then
      raise exception 'invalid_photo';
    end;

    if length(v_photo) > 524288 then
      raise exception 'invalid_photo';
    end if;

    v_new_oid := lo_from_bytea(0, v_photo);
  end if;

  insert into smartgov.roster (
    organization_id, full_name, email,
    last_name, first_name, middle_name, birthdate,
    course, year_level, gender, contact_number, address,
    photo_oid, photo_mime, photo_bytes
  ) values (
    p_organization, v_full, v_email,
    nullif(v_last, ''), nullif(v_first, ''), nullif(v_middle, ''), v_birth,
    nullif(btrim(coalesce(p_holder->>'course', '')), ''),
    nullif(btrim(coalesce(p_holder->>'yearLevel', p_holder->>'level', '')), ''),
    v_gender,
    nullif(btrim(coalesce(p_holder->>'contactNumber', p_holder->>'contact_number', '')), ''),
    nullif(btrim(coalesce(p_holder->>'address', '')), ''),
    v_new_oid,
    case when v_new_oid is null then null else 'image/jpeg' end,
    case when v_new_oid is null then null else length(v_photo) end
  )
  on conflict (organization_id, lower(email)) do update set
    full_name       = excluded.full_name,
    last_name       = coalesce(excluded.last_name, smartgov.roster.last_name),
    first_name      = coalesce(excluded.first_name, smartgov.roster.first_name),
    middle_name     = coalesce(excluded.middle_name, smartgov.roster.middle_name),
    birthdate       = coalesce(excluded.birthdate, smartgov.roster.birthdate),
    course          = coalesce(excluded.course, smartgov.roster.course),
    year_level      = coalesce(excluded.year_level, smartgov.roster.year_level),
    gender          = excluded.gender,
    contact_number  = coalesce(excluded.contact_number, smartgov.roster.contact_number),
    address         = coalesce(excluded.address, smartgov.roster.address),
    -- Only overwritten when this call actually carried one, which is what makes
    -- the absence of `photo` mean "keep it".
    photo_oid       = coalesce(excluded.photo_oid, smartgov.roster.photo_oid),
    photo_mime      = coalesce(excluded.photo_mime, smartgov.roster.photo_mime),
    photo_bytes     = coalesce(excluded.photo_bytes, smartgov.roster.photo_bytes)
  returning id, photo_oid into v_roster, v_old_oid;

  -- `returning photo_oid` returns the row as it now stands, which is the new oid
  -- when one was written. Re-read to find what it replaced so the old large
  -- object can be unlinked.
  if v_new_oid is not null then
    declare
      v_previous oid;
    begin
      select r.photo_oid into v_previous
        from smartgov.roster r
       where r.id = v_roster;
      if v_previous is distinct from v_new_oid then
        perform lo_unlink(v_previous);
      end if;
    end;
  end if;

  return v_roster;
end;
$$;

revoke all on function smartgov.gov_upsert_holder(uuid, jsonb) from public;

-- ------------------------------------------------------------- materializer

-- Turn an approved document into the live chart, in one transaction.
--
-- Two things here are worth stating outright because they look like oversights:
--
--   * A committee the new document no longer defines is *deleted*, not archived.
--     Its `unit_memberships` cascade with it, so the people who sat on it are not
--     in `unit_memberships` afterwards. That history is not lost -- it is in the
--     approved structure document, which is immutable and still readable. The
--     alternative, keeping stale committee rows around, would leave the chart
--     showing a Welfare Committee the government had already abolished.
--
--   * `org_positions` is organization-wide and shared. Two committees may both
--     have a Chairperson, and that is one position row enabled on two units, which
--     is exactly what `unit_positions` is for. It also means a seat title is not
--     per-committee: renaming "Chairperson" in one committee does not rename it
--     in the other. The structure document remains the place the per-committee
--     titles are authoritative, and the chart shows the label the position row
--     carries.
create or replace function smartgov.gov_apply_structure(
  p_structure smartgov.gov_structures
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_doc      jsonb := p_structure.document;
  v_org      uuid  := p_structure.organization_id;
  v_unit     uuid  := p_structure.unit_id;
  v_ci       int;
  v_pi       int;
  v_c        jsonb;
  v_p        jsonb;
  v_h        jsonb;
  v_is_unit  boolean;
  v_cid      uuid;
  v_pid      uuid;
  v_roster   uuid;
  v_kept     uuid[] := '{}';
  v_stale    uuid;
  v_seats    int := 0;
begin
  for v_ci in 0 .. jsonb_array_length(v_doc->'committees') - 1 loop
    v_c       := v_doc->'committees'->v_ci;
    v_is_unit := coalesce((v_c->>'isUnit')::boolean, false);

    if v_is_unit then
      -- The council's own board. Seats land on the unit itself, not on a child,
      -- so the owner stays seated in the `usg` unit and every existing read keeps
      -- working.
      v_cid := v_unit;
    else
      select gu.id into v_cid
        from public.governance_units gu
       where gu.organization_id = v_org
         and gu.parent_id = v_unit
         and gu.unit_type = 'committee'
         and gu.structure_key = btrim(v_c->>'key');

      if v_cid is null then
        insert into public.governance_units (
          organization_id, name, unit_type, parent_id, structure_key
        ) values (
          v_org, btrim(v_c->>'name'), 'committee', v_unit, btrim(v_c->>'key')
        )
        returning id into v_cid;
      else
        -- A rename, or a reordering: the key is what identifies the committee,
        -- so the row survives and only the label moves.
        update public.governance_units
           set name = btrim(v_c->>'name')
         where id = v_cid;
      end if;
    end if;

    v_kept := array_append(v_kept, v_cid);

    for v_pi in 0 .. jsonb_array_length(v_c->'positions') - 1 loop
      v_p := v_c->'positions'->v_pi;
      v_h := v_p->'holder';

      insert into smartgov.org_positions (organization_id, label, sort_order)
      values (v_org, btrim(v_p->>'title'), v_pi)
      on conflict (organization_id, lower(label)) do nothing;

      select op.id into v_pid
        from smartgov.org_positions op
       where op.organization_id = v_org
         and lower(op.label) = lower(btrim(v_p->>'title'));

      if v_pid is null then
        return jsonb_build_object('ok', false, 'reason', 'invalid_request',
                                 'detail', 'Could not resolve a seat title.');
      end if;

      insert into smartgov.unit_positions (unit_id, position_id)
      values (v_cid, v_pid)
      on conflict do nothing;

      v_seats := v_seats + 1;

      -- Close whoever holds the seat now. Dated rather than deleted, for the same
      -- reason 00600 dates memberships: this term's holder has to stay answerable.
      update smartgov.unit_memberships
         set end_date = current_date
       where unit_id = v_cid
         and position_id = v_pid
         and end_date is null;

      -- A seat with no holder stays vacant. That is the normal state of a council
      -- mid-recruitment and the chart already renders an empty seat.
      if v_h is null or v_h = 'null'::jsonb
         or jsonb_typeof(v_h) <> 'object' or v_h = '{}'::jsonb then
        continue;
      end if;

      begin
        v_roster := smartgov.gov_upsert_holder(v_org, v_h);
      exception when others then
        return jsonb_build_object('ok', false, 'reason', 'invalid_request',
                                 'detail', format(
                                   'The person named for "%s" could not be saved.',
                                   btrim(v_p->>'title')));
      end;

      insert into smartgov.unit_memberships (roster_id, unit_id, position_id)
      values (v_roster, v_cid, v_pid);
    end loop;
  end loop;

  -- Committees this structure dropped.
  for v_stale in
    select gu.id
      from public.governance_units gu
     where gu.organization_id = v_org
       and gu.parent_id = v_unit
       and gu.unit_type = 'committee'
       and not (gu.id = any (v_kept))
  loop
    delete from public.governance_units
     where id = v_stale;
  end loop;

  return jsonb_build_object('ok', true, 'committees', array_length(v_kept, 1), 'seats', v_seats);
end;
$$;

revoke all on function smartgov.gov_apply_structure(smartgov.gov_structures) from public;

-- --------------------------------------------------------------- decisions

-- The single path from "a decision exists" to "the chart changed". Both the
-- submit-time self-approval and the USG review call this, so the two can never
-- disagree about what approving a structure does.
create or replace function smartgov.gov_record_decision(
  p_structure smartgov.gov_structures,
  p_actor      uuid,
  p_decision   text,
  p_remark     text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_apply  jsonb;
  v_status text;
begin
  if p_decision = 'approved' then
    -- Retire the previous one first: `gov_structures_one_approved_per_unit`
    -- forbids two live rows for the same unit, so the order here is not
    -- cosmetic.
    update smartgov.gov_structures
       set status = 'superseded',
           updated_at = now()
     where unit_id = p_structure.unit_id
       and status = 'approved'
       and id <> p_structure.id;

    v_apply := smartgov.gov_apply_structure(p_structure);
    if not (v_apply->>'ok')::boolean then
      return v_apply;
    end if;
  end if;

  v_status := case p_decision
                when 'approved'  then 'approved'
                when 'returned'  then 'returned'
                else 'rejected'
              end;

  update smartgov.gov_structures
     set status = v_status,
         decided_by = p_actor,
         decided_at = now(),
         decision_remark = case
           when p_decision = 'approved' then null
           else left(btrim(coalesce(p_remark, '')), 2000)
         end,
         updated_at = now()
   where id = p_structure.id;

  insert into smartgov.gov_structure_reviews (
    structure_id, revision, decision, remark, decided_by
  ) values (
    p_structure.id, p_structure.revision, p_decision,
    case when p_decision = 'approved' then null
         else left(btrim(coalesce(p_remark, '')), 2000) end,
    p_actor
  );

  return jsonb_build_object(
    'ok', true, 'structureId', p_structure.id, 'status', v_status,
    'revision', p_structure.revision);
end;
$$;

revoke all on function smartgov.gov_record_decision(smartgov.gov_structures, uuid, text, text) from public;

-- ------------------------------------------------------- structure projection

create or replace function smartgov.gov_structure_json(p_s smartgov.gov_structures)
returns jsonb
language sql stable
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
  select jsonb_build_object(
    'id', p_s.id,
    'unitId', p_s.unit_id,
    'authorKind', p_s.author_kind,
    'status', p_s.status,
    'revision', p_s.revision,
    'templateKey', p_s.template_key,
    'termLabel', p_s.term_label,
    'startsOn', p_s.starts_on,
    'endsOn', p_s.ends_on,
    -- Read shape, not stored shape: bytes stripped, existing photos flagged.
    'document', smartgov.gov_mark_existing_photos(
                   p_s.organization_id, smartgov.gov_strip_photos(p_s.document)),
    'note', p_s.note,
    'submittedBy', (select a.display_name from smartgov.accounts a where a.id = p_s.submitted_by),
    'submittedAt', p_s.submitted_at,
    'decidedBy',   (select a.display_name from smartgov.accounts a where a.id = p_s.decided_by),
    'decidedAt',   p_s.decided_at,
    'decisionRemark', p_s.decision_remark,
    'renewsId', p_s.renews_id,
    'renewsTermLabel', (select t.term_label from smartgov.gov_structures t where t.id = p_s.renews_id),
    'createdAt', p_s.created_at,
    'updatedAt', p_s.updated_at
  );
$$;

revoke all on function smartgov.gov_structure_json(smartgov.gov_structures) from public;

-- --------------------------------------------------------------- templates

-- Built-ins plus this organization's own saved templates. A caller with no
-- organization still gets the built-ins, because the gallery is useful before an
-- organization exists and contains nothing personal.
create or replace function smartgov.list_structure_templates(p_session_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  return jsonb_build_object(
    'ok', true,
    'templates', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.id,
               'key', t.key,
               'name', t.name,
               'description', t.description,
               'category', t.category,
               'isBuiltin', t.is_builtin,
               'committees', jsonb_array_length(t.document->'committees'),
               'seats', (
                 select count(*)
                   from jsonb_array_elements(t.document->'committees') c
                   cross join lateral jsonb_array_elements(c->'positions') s
               )
             ) order by t.is_builtin desc, t.category, t.name)
        from smartgov.gov_structure_templates t
       where t.is_builtin
          or t.organization_id = v_account.organization_id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function smartgov.list_structure_templates(text) from public;

-- Save the current shape as a reusable template, or import one the organization
-- obtained elsewhere. Same validator as the builder with holders refused, so a
-- template can never be a way to push one council's officers into another's
-- gallery.
--
-- USG-side only: an organization-wide gallery is a policy thing, and the USG is
-- the side that sets policy for the organization.
create or replace function smartgov.import_structure_template(
  p_session_token text,
  p_key          text,
  p_name         text,
  p_description  text,
  p_category     text,
  p_document     jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_valid   jsonb;
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if v_account.account_scope <> 'owner'
     and not smartgov.is_org_reviewer(v_account.id, v_account.organization_id) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if v_account.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;

  if length(btrim(coalesce(p_key, ''))) not between 2 and 60
     or length(btrim(coalesce(p_name, ''))) not between 2 and 80
     or coalesce(p_category, 'custom') not in
       ('general','academic','org','athletic','media','service','custom') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  if not smartgov.consume_rate_limit(
       'structure:template:' || v_account.id::text, 30, interval '1 hour') then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  v_valid := smartgov.gov_document_valid(p_document, false);
  if not (v_valid->>'ok')::boolean then
    return v_valid;
  end if;

  insert into smartgov.gov_structure_templates (
    organization_id, key, name, description, category, document, is_builtin, created_by
  ) values (
    v_account.organization_id, btrim(p_key), btrim(p_name),
    left(btrim(coalesce(p_description, '')), 300),
    coalesce(p_category, 'custom'), p_document, false, v_account.id
  )
  on conflict (coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(key))
  do update set name = excluded.name,
                description = excluded.description,
                category = excluded.category,
                document = excluded.document,
                created_by = excluded.created_by,
                created_at = now();

  return jsonb_build_object(
    'ok', true, 'key', btrim(p_key), 'name', btrim(p_name));
end;
$$;

revoke all on function smartgov.import_structure_template(text, text, text, text, text, jsonb) from public;

-- --------------------------------------------------------------- one unit

-- Everything the builder page needs for one unit: the open draft, the approved
-- structure, the term history, and whether this caller may touch any of it.
create or replace function smartgov.get_structure(
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
  v_account smartgov.accounts%rowtype;
  v_access  jsonb;
  v_root    uuid;
  v_open    smartgov.gov_structures%rowtype;
  v_live    smartgov.gov_structures%rowtype;
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if p_unit_id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  v_access := smartgov.gov_unit_access(v_account, p_unit_id);

  if not (v_access->>'canRead')::boolean then
    -- A unit this caller cannot read is reported as missing, not as forbidden:
    -- distinguishing them would confirm the existence of another council's unit
    -- to someone holding only a publishable key.
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  v_root := smartgov.gov_root_unit(v_account.organization_id);

  select * into v_open
    from smartgov.gov_structures s
   where s.unit_id = p_unit_id
     and s.status in ('draft','submitted','returned');

  select * into v_live
    from smartgov.gov_structures s
   where s.unit_id = p_unit_id
     and s.status = 'approved';

  return jsonb_build_object(
    'ok', true,
    'unit', (
      select jsonb_build_object(
               'id', gu.id,
               'name', gu.name,
               'unitType', gu.unit_type,
               'parentId', gu.parent_id,
               'parentName', (select p.name from public.governance_units p where p.id = gu.parent_id),
               'isRoot', gu.id = v_root
             )
        from public.governance_units gu
       where gu.id = p_unit_id
    ),
    'capability', v_access,
    'draft', case when v_open.id is null then null
                  else smartgov.gov_structure_json(v_open) end,
    'approved', case when v_live.id is null then null
                     else smartgov.gov_structure_json(v_live) end,
    'history', coalesce((
      select jsonb_agg(t.entry order by t.created_at desc)
        from (
          select s.created_at,
                 smartgov.gov_structure_json(s) as entry
            from smartgov.gov_structures s
           where s.unit_id = p_unit_id
             and s.id not in (coalesce(v_open.id, '00000000-0000-0000-0000-000000000000'::uuid),
                              coalesce(v_live.id, '00000000-0000-0000-0000-000000000000'::uuid))
        ) t
    ), '[]'::jsonb),
    -- What the dashboard's Renew button needs, without it having to read the
    -- whole structure to decide whether to offer itself.
    'renewal', jsonb_build_object(
      'canRequest', (v_access->>'canEdit')::boolean
                    and v_live.id is not null
                    and v_open.id is null,
      'label', v_live.term_label,
      'startsOn', v_live.starts_on,
      'endsOn', v_live.ends_on,
      'daysRemaining', case when v_live.id is null then null
                           else (v_live.ends_on - current_date) end,
      'expired', v_live.ends_on < current_date
    )
  );
end;
$$;

revoke all on function smartgov.get_structure(text, uuid) from public;

-- ------------------------------------------------------------- write: draft

create or replace function smartgov.save_structure_draft(
  p_session_token text,
  p_unit_id       uuid,
  p_template_key  text,
  p_term_label    text,
  p_starts_on     date,
  p_ends_on       date,
  p_document      jsonb,
  p_note          text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account   smartgov.accounts%rowtype;
  v_access    jsonb;
  v_valid     jsonb;
  v_struct    smartgov.gov_structures%rowtype;
  v_root      uuid;
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if v_account.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;

  v_access := smartgov.gov_unit_access(v_account, p_unit_id);
  if not (v_access->>'canEdit')::boolean then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if not smartgov.consume_rate_limit(
       'structure:save:' || v_account.id::text, 120, interval '5 minutes') then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  if length(btrim(coalesce(p_term_label, ''))) not between 1 and 80
     or p_starts_on is null or p_ends_on is null
     or p_ends_on <= p_starts_on then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  v_valid := smartgov.gov_document_valid(p_document);
  if not (v_valid->>'ok')::boolean then
    return v_valid;
  end if;

  v_root := smartgov.gov_root_unit(v_account.organization_id);

  select * into v_struct
    from smartgov.gov_structures s
   where s.unit_id = p_unit_id
     and s.status in ('draft','submitted','returned')
   for update;

  if v_struct.id is not null then
    if v_struct.status = 'submitted' then
      -- Editing under a reviewer who is reading it is how a structure changes
      -- between "looks fine" and "approved".
      return jsonb_build_object('ok', false, 'reason', 'awaiting_review');
    end if;

    update smartgov.gov_structures s
       set template_key = coalesce(nullif(btrim(coalesce(p_template_key, '')), ''), s.template_key),
           term_label = btrim(p_term_label),
           starts_on = p_starts_on,
           ends_on = p_ends_on,
           document = p_document,
           note = left(btrim(coalesce(p_note, '')), 1000),
           -- Back to draft: a returned structure is being worked on again.
           status = 'draft',
           -- A revision bump is what makes `gov_structure_reviews` meaningful, and
           -- it has to happen on resubmission even when nothing changed --
           -- otherwise the returned revision already has a review row and the
           -- resubmission is refused as `already_reviewed` forever.
           revision = case
                        when s.status = 'returned'
                          or s.document is distinct from p_document
                          or s.starts_on is distinct from p_starts_on
                          or s.ends_on is distinct from p_ends_on
                          or s.term_label is distinct from btrim(p_term_label)
                        then s.revision + 1
                        else s.revision
                      end,
           updated_at = now()
     where s.id = v_struct.id
     returning * into v_struct;
  else
    insert into smartgov.gov_structures (
      organization_id, unit_id, author_kind, created_by, template_key,
      term_label, starts_on, ends_on, status, document, note
    ) values (
      v_account.organization_id, p_unit_id,
      -- Derived from the unit, never from the caller: this is the line that keeps
      -- a dual-seat reviewer from approving their own council's structure.
      case when p_unit_id = v_root then 'usg' else 'lsg' end,
      v_account.id, nullif(btrim(coalesce(p_template_key, '')), ''),
      btrim(p_term_label), p_starts_on, p_ends_on, 'draft', p_document,
      left(btrim(coalesce(p_note, '')), 1000)
    ) returning * into v_struct;
  end if;

  return jsonb_build_object(
    'ok', true,
    'structureId', v_struct.id,
    'status', v_struct.status,
    'revision', v_struct.revision,
    'authorKind', v_struct.author_kind
  );
end;
$$;

revoke all on function smartgov.save_structure_draft(text, uuid, text, text, date, date, jsonb, text) from public;

-- -------------------------------------------------------------- write: submit

-- Sealed and handed to the USG -- or, for the top-tier unit's own structure,
-- applied immediately because there is nobody above it to approve it.
create or replace function smartgov.submit_structure(
  p_session_token text,
  p_structure_id  uuid,
  p_note          text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account  smartgov.accounts%rowtype;
  v_access   jsonb;
  v_struct   smartgov.gov_structures%rowtype;
  v_valid    jsonb;
  v_root     uuid;
  v_decision jsonb;
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  select * into v_struct
    from smartgov.gov_structures s
   where s.id = p_structure_id
     and s.organization_id = v_account.organization_id
   for update;

  if v_struct.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  v_access := smartgov.gov_unit_access(v_account, v_struct.unit_id);
  if not (v_access->>'canEdit')::boolean then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if v_struct.status not in ('draft','returned') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  if not smartgov.consume_rate_limit(
       'structure:submit:' || v_account.id::text, 20, interval '10 minutes') then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  -- Re-validated at submit, not only at save: the saved document is what a
  -- reviewer reads, and a gate that trusts the earlier check would be trusting
  -- the client.
  v_valid := smartgov.gov_document_valid(v_struct.document);
  if not (v_valid->>'ok')::boolean then
    return v_valid;
  end if;

  update smartgov.gov_structures s
     set status = 'submitted',
         submitted_by = v_account.id,
         submitted_at = now(),
         note = coalesce(left(btrim(coalesce(p_note, '')), 1000), s.note),
         updated_at = now()
   where s.id = v_struct.id
   returning * into v_struct;

  v_root := smartgov.gov_root_unit(v_account.organization_id);

  if v_struct.unit_id = v_root then
    -- Top of the hierarchy: nobody above it to approve, so this is the same
    -- "USG writes, USG publishes" rule 02000 applies to proposals.
    v_decision := smartgov.gov_record_decision(v_struct, v_account.id, 'approved', null);
    if not (v_decision->>'ok')::boolean then
      return v_decision;
    end if;
    return v_decision || jsonb_build_object('autoApproved', true);
  end if;

  return jsonb_build_object(
    'ok', true, 'structureId', v_struct.id, 'status', 'submitted',
    'revision', v_struct.revision, 'autoApproved', false);
end;
$$;

revoke all on function smartgov.submit_structure(text, uuid, text) from public;

-- -------------------------------------------------------------- write: review

create or replace function smartgov.review_structure(
  p_session_token text,
  p_structure_id  uuid,
  p_decision      text,
  p_remark        text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_struct  smartgov.gov_structures%rowtype;
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if v_account.account_scope <> 'owner'
     and not smartgov.is_org_reviewer(v_account.id, v_account.organization_id) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if p_decision not in ('approved','returned','rejected') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  if p_decision in ('returned','rejected')
     and length(btrim(coalesce(p_remark, ''))) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  if not smartgov.consume_rate_limit(
       'structure:review:' || v_account.id::text, 60, interval '10 minutes') then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  select * into v_struct
    from smartgov.gov_structures s
   where s.id = p_structure_id
     and s.organization_id = v_account.organization_id
   for update;

  if v_struct.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if v_struct.created_by = v_account.id then
    -- The dual-seat case. A reviewer who is also seated in the council they
    -- structured must not be the one who approves it; the USG side cannot review
    -- on their behalf, so somebody else has to.
    return jsonb_build_object('ok', false, 'reason', 'self_review');
  end if;

  if v_struct.status <> 'submitted' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  if exists (
    select 1 from smartgov.gov_structure_reviews r
     where r.structure_id = v_struct.id
       and r.revision = v_struct.revision
  ) then
    return jsonb_build_object('ok', false, 'reason', 'already_reviewed');
  end if;

  return smartgov.gov_record_decision(v_struct, v_account.id, p_decision, p_remark);
end;
$$;

revoke all on function smartgov.review_structure(text, uuid, text, text) from public;

-- ------------------------------------------------------------- write: renew

-- The dashboard's Renew action. Seeds the next term's draft from the structure
-- that is currently in force, so renewing is "carry this forward" rather than
-- "rebuild it from memory", and the two structures are linked by `renews_id` so
-- the lineage is a fact in the schema.
--
-- Refused when there is nothing live to renew, and refused when something is
-- already in flight -- otherwise the button would create a second draft and the
-- `gov_structures_one_open_per_unit` index would turn that into an
-- `invalid_request` at the last moment, which is a worse error to show somebody
-- who pressed a button that looked available.
create or replace function smartgov.request_structure_renewal(
  p_session_token text,
  p_unit_id       uuid,
  p_term_label    text,
  p_starts_on     date,
  p_ends_on       date
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account  smartgov.accounts%rowtype;
  v_access   jsonb;
  v_live     smartgov.gov_structures%rowtype;
  v_open     uuid;
  v_starts   date;
  v_ends     date;
  v_label    text;
  v_new      smartgov.gov_structures%rowtype;
  v_root     uuid;
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  v_access := smartgov.gov_unit_access(v_account, p_unit_id);
  if not (v_access->>'canEdit')::boolean then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if not smartgov.consume_rate_limit(
       'structure:renew:' || v_account.id::text, 20, interval '10 minutes') then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  select * into v_live
    from smartgov.gov_structures s
   where s.unit_id = p_unit_id
     and s.status = 'approved';

  if v_live.id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_approved_structure');
  end if;

  select s.id into v_open
    from smartgov.gov_structures s
   where s.unit_id = p_unit_id
     and s.status in ('draft','submitted','returned');

  if v_open is not null then
    return jsonb_build_object('ok', false, 'reason', 'already_in_progress');
  end if;

  -- Default the new term to the day after the current one ends, for a year.
  -- An expired structure still renews forward from its end date, which is the
  -- whole point: a council that let its term lapse is exactly the one that needs
  -- to renew.
  v_starts := coalesce(p_starts_on, v_live.ends_on + 1);
  v_ends   := coalesce(p_ends_on, (v_starts::timestamp + interval '1 year')::date);
  v_label  := coalesce(nullif(btrim(coalesce(p_term_label, '')), ''), v_live.term_label);

  if v_ends <= v_starts or length(v_label) not between 1 and 80 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  v_root := smartgov.gov_root_unit(v_account.organization_id);

  insert into smartgov.gov_structures (
    organization_id, unit_id, author_kind, created_by,
    term_label, starts_on, ends_on, status, document, note, renews_id
  ) values (
    v_account.organization_id, p_unit_id,
    case when p_unit_id = v_root then 'usg' else 'lsg' end,
    v_account.id,
    v_label, v_starts, v_ends, 'draft',
    -- Carried forward verbatim, photo bytes included. Re-approving rewrites the
    -- same roster rows (matched by email), so the photo survives; the only cost is
    -- that the draft document carries the bytes until it is submitted.
    v_live.document,
    'Renewal of ' || v_live.term_label,
    v_live.id
  ) returning * into v_new;

  return jsonb_build_object(
    'ok', true,
    'structureId', v_new.id,
    'termLabel', v_new.term_label,
    'startsOn', v_new.starts_on,
    'endsOn', v_new.ends_on,
    'renewsId', v_new.renews_id,
    'status', v_new.status
  );
end;
$$;

revoke all on function smartgov.request_structure_renewal(text, uuid, text, date, date) from public;

-- ------------------------------------------------------------------- queue

-- The review inbox for the USG, and the LSG's own submission history.
--
-- Drafts are excluded except the caller's own. A draft is a working copy, and the
-- USG has no business reading a council's half-finished structure -- the point of
-- the gate is that the USG sees a *finished* document.
create or replace function smartgov.list_structure_queue(p_session_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account  smartgov.accounts%rowtype;
  v_reviewer boolean;
  v_visible  uuid[];
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if v_account.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;

  v_reviewer := v_account.account_scope = 'owner'
             or smartgov.is_org_reviewer(v_account.id, v_account.organization_id);
  v_visible  := smartgov.gov_visible_unit_ids(v_account);

  return jsonb_build_object(
    'ok', true,
    'isReviewer', v_reviewer,
    'pending', coalesce((
      select jsonb_agg(t.entry order by t.submitted_at asc nulls last)
        from (
          select s.submitted_at,
                 smartgov.gov_structure_json(s)
                   || jsonb_build_object(
                        'unitName', (select gu.name from public.governance_units gu where gu.id = s.unit_id),
                        'unitType', (select gu.unit_type from public.governance_units gu where gu.id = s.unit_id),
                        'reviewable', s.created_by <> v_account.id
                             and not exists (
                               select 1 from smartgov.gov_structure_reviews r
                                where r.structure_id = s.id and r.revision = s.revision)
                             ) as entry
            from smartgov.gov_structures s
           where s.organization_id = v_account.organization_id
             and s.status = 'submitted'
             and (v_reviewer or s.created_by = v_account.id or s.unit_id = any (v_visible))
        ) t
    ), '[]'::jsonb),
    'decided', coalesce((
      select jsonb_agg(t.entry order by t.decided_at desc nulls last)
        from (
          select s.decided_at,
                 smartgov.gov_structure_json(s)
                   || jsonb_build_object(
                        'unitName', (select gu.name from public.governance_units gu where gu.id = s.unit_id),
                        'unitType', (select gu.unit_type from public.governance_units gu where gu.id = s.unit_id),
                        'reviewable', false) as entry
            from smartgov.gov_structures s
           where s.organization_id = v_account.organization_id
             and s.status in ('approved','returned','rejected','superseded')
             and (v_reviewer or s.created_by = v_account.id or s.unit_id = any (v_visible))
           order by s.decided_at desc nulls last
           limit 40
        ) t
    ), '[]'::jsonb),
    'drafts', coalesce((
      select jsonb_agg(t.entry order by t.updated_at desc)
        from (
          select s.updated_at,
                 smartgov.gov_structure_json(s)
                   || jsonb_build_object(
                        'unitName', (select gu.name from public.governance_units gu where gu.id = s.unit_id),
                        'unitType', (select gu.unit_type from public.governance_units gu where gu.id = s.unit_id),
                        'reviewable', false) as entry
            from smartgov.gov_structures s
           where s.organization_id = v_account.organization_id
             and s.status in ('draft','returned')
             and s.created_by = v_account.id
        ) t
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function smartgov.list_structure_queue(text) from public;

-- ------------------------------------------------------------------ photos

-- One image, base64, for one roster row.
--
-- Scoped like a chart read: your own seat, anything below a unit you are seated
-- in, and -- for the USG side reviewing a council -- the whole organization.
-- A roster row with no current seat is only reachable by a reviewer, which is the
-- right default for a personal photo.
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
  v_visible  uuid[];
  v_oid      oid;
  v_mime     text;
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
  v_visible  := smartgov.gov_visible_unit_ids(v_account);

  if not v_reviewer then
    select exists (
      select 1
        from smartgov.unit_memberships m
       where m.roster_id = p_roster_id
         and m.end_date is null
         and m.unit_id = any (v_visible)
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

  return jsonb_build_object(
    'ok', true,
    'mime', coalesce(v_mime, 'image/jpeg'),
    'bytes', pg_column_size(lo_get(v_oid)),
    'base64', encode(lo_get(v_oid), 'base64')
  );
exception
  -- A large object can go missing independently of its row if something outside
  -- this schema ever unlinks it. That is an absent photo, not a failed request.
  when undefined_object then
    return jsonb_build_object('ok', true, 'mime', null, 'bytes', 0, 'base64', null);
end;
$$;

revoke all on function smartgov.get_member_photo(text, uuid) from public;

-- A roster row resolved to the person the structure names, so the builder's seat
-- editor can show which roster entry a filled seat maps to without the client
-- holding the whole org's roster.
create or replace function smartgov.match_structure_holder(
  p_session_token text,
  p_unit_id       uuid,
  p_email         text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_access  jsonb;
  v_row     smartgov.roster%rowtype;
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  v_access := smartgov.gov_unit_access(v_account, p_unit_id);
  if not (v_access->>'canRead')::boolean then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  select r.* into v_row
    from smartgov.roster r
   where r.organization_id = v_account.organization_id
     and lower(r.email) = lower(btrim(coalesce(p_email, '')));

  if v_row.id is null then
    return jsonb_build_object(
      'ok', true, 'rosterId', null, 'exists', false,
      'inOrg', false);
  end if;

  return jsonb_build_object(
    'ok', true,
    'rosterId', v_row.id,
    'exists', true,
    'hasPhoto', v_row.photo_oid is not null,
    'seats', coalesce((
      select jsonb_agg(jsonb_build_object(
               'unitId', gu.id,
               'unitName', gu.name,
               'unitType', gu.unit_type,
               'positionLabel', op.label
             ) order by op.sort_order)
        from smartgov.unit_memberships m
        join public.governance_units gu on gu.id = m.unit_id
        join smartgov.org_positions op on op.id = m.position_id
       where m.roster_id = v_row.id
         and m.end_date is null
         and gu.organization_id = v_account.organization_id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function smartgov.match_structure_holder(text, uuid, text) from public;