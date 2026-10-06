-- 02980 -- government structure: document integrity, chart hygiene, and the
-- states that would strand a council.
--
-- Everything here was found by exercising the feature end to end rather than by
-- reading it, which is worth saying because two of these are invisible in a unit
-- test and obvious in a browser:
--
--   1. `gov_strip_photos` returned the committees array instead of the document.
--      Reads therefore answered `{committees: [...]}` as `[]`, so a client that
--      fetched a draft and saved it back -- which is every keystroke batch the
--      builder does -- sent a document with no `committees` key and was refused by
--      its own validator. The probes passed because they asserted against the
--      fixture they built rather than against a round trip.
--   2. Neither photo helper ordered its aggregates, so the order the user dragged
--      committees into was not guaranteed to survive a read.
--   3. The validator refused a second `isUnit` but not a misplaced first one, and
--      the materializer reads that flag positionally.
--   4. Replacing a member's photo orphaned the old large object forever.
--   5. A seat dropped from a committee the structure kept stayed on the chart,
--      while a dropped committee was correctly deleted.
--   6. A top-tier submit that failed to apply left the structure `submitted` with
--      nobody above it who could ever move it again.
--
-- The access-control work (roster scope, author retention) is 02990.

-- ------------------------------------------------------------ photo read shape

-- `p_document || jsonb_build_object('committees', ...)` rather than returning the
-- bare array: any other top-level key the document grows later is carried through
-- instead of silently dropped, which is what made the lost wrapper possible in the
-- first place.
--
-- The aggregates are ordered. `jsonb_array_elements` happens to preserve order
-- today, but an unordered aggregate over a partitioned plan may not, and this is
-- the only place the order a council's officers were arranged in is stored.
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
    else p_document || jsonb_build_object(
           'committees',
           coalesce((
             select jsonb_agg(
                      jsonb_set(
                        c.value, '{positions}',
                        coalesce(
                          (select jsonb_agg(
                                    case when jsonb_typeof(p.value->'holder') = 'object'
                                         then jsonb_set(p.value, '{holder}',
                                                        (p.value->'holder') - 'photo')
                                         else p.value
                                    end
                                    order by p.ord)
                             from jsonb_array_elements(
                                    case when jsonb_typeof(c.value->'positions') = 'array'
                                         then c.value->'positions' else '[]'::jsonb end)
                             with ordinality as p(value, ord)
                          ), '[]'::jsonb)
                      )
                      order by c.ord)
               from jsonb_array_elements(p_document->'committees')
               with ordinality as c(value, ord)
           ), '[]'::jsonb))
  end;
$$;

revoke all on function smartgov.gov_strip_photos(jsonb) from public;

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
    else p_document || jsonb_build_object(
           'committees',
           coalesce((
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
                                    end
                                    order by p.ord)
                             from jsonb_array_elements(
                                    case when jsonb_typeof(c.value->'positions') = 'array'
                                         then c.value->'positions' else '[]'::jsonb end)
                             with ordinality as p(value, ord)
                          ), '[]'::jsonb)
                      )
                      order by c.ord)
               from jsonb_array_elements(p_document->'committees')
               with ordinality as c(value, ord)
           ), '[]'::jsonb))
  end;
$$;

revoke all on function smartgov.gov_mark_existing_photos(uuid, jsonb) from public;

-- ---------------------------------------------------------------- validation

-- Unchanged except for one rule, which the comment above 02960's copy of this
-- function already described and the code did not implement: `isUnit` marks *the
-- first committee*, not "one of the committees". The materializer reads it
-- positionally, so `isUnit` on committee three would file the council's own board
-- officers under a committee nobody is allowed to edit.
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
      if v_ci > 0 then
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
        'detail', format('The description for "%s" is too long.', v_key));
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

-- ------------------------------------------------------------ holder upsert

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

  -- Read the photo this call is about to replace, *before* the write. `returning
  -- photo_oid` hands back the row as it now stands, which is the new large object,
  -- so after the upsert the replaced one is unrecoverable and would sit in the
  -- database until something vacuumed it -- with a member's face still in it.
  select r.photo_oid into v_old_oid
    from smartgov.roster r
   where r.organization_id = p_organization
     and lower(r.email) = v_email;

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
  returning id into v_roster;

  if v_new_oid is not null and v_old_oid is not null and v_old_oid <> v_new_oid then
    -- Guarded rather than bare: a leaked photo is a nuisance, and failing an
    -- approval because the housekeeping step could not find its object is a
    -- council's government not getting written.
    begin
      perform lo_unlink(v_old_oid);
    exception when others then
      null;
    end;
  end if;

  return v_roster;
end;
$$;

revoke all on function smartgov.gov_upsert_holder(uuid, jsonb) from public;

-- ------------------------------------------------------------- materializer

create or replace function smartgov.gov_apply_structure(
  p_structure smartgov.gov_structures
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_doc       jsonb := p_structure.document;
  v_org       uuid  := p_structure.organization_id;
  v_unit      uuid  := p_structure.unit_id;
  v_ci        int;
  v_pi        int;
  v_c         jsonb;
  v_p         jsonb;
  v_h         jsonb;
  v_is_unit   boolean;
  v_cid       uuid;
  v_pid       uuid;
  v_roster    uuid;
  v_kept      uuid[] := '{}';
  v_stale     uuid;
  v_seats     int := 0;
  -- unit id -> the position ids this document gives it. Kept as jsonb because the
  -- unit only becomes known while the committees are being walked, and a nested
  -- array of (unit, position) pairs would have to be searched linearly below.
  v_on_this   jsonb := '{}'::jsonb;
  v_cid_text  text;
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

    v_cid_text := v_cid::text;
    if not (v_on_this ? v_cid_text) then
      v_on_this := jsonb_set(v_on_this, array[v_cid_text], '[]'::jsonb, true);
    end if;

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

      v_on_this := jsonb_set(v_on_this, array[v_cid_text],
                             (v_on_this -> v_cid_text) || to_jsonb(v_pid), true);

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

      begin
        insert into smartgov.unit_memberships (roster_id, unit_id, position_id)
        values (v_roster, v_cid, v_pid);
      exception when unique_violation then
        -- `unit_memberships_one_active_per_unit`: one person, one seat, per unit.
        -- Letting this escape would hand the caller a driver error for something
        -- the builder can explain -- the same person is named in two seats of one
        -- committee, which is a mistake in the document, not a bug.
        return jsonb_build_object(
          'ok', false, 'reason', 'duplicate_holder',
          'detail', format(
            'The same person holds two seats in "%s"; each member may hold one.',
            btrim(v_c->>'name')));
      end;
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

  -- Seats this structure dropped from a committee it kept. Abolished committees are
  -- deleted outright, but a kept committee's row survives the rename-and-reorder
  -- path above, so without this the chart would go on showing a Welfare Committee
  -- seat the government had already abolished.
  --
  -- Memberships are dated and only the unit_position link goes, for the same reason
  -- the committee delete does not erase who once sat here.
  for v_cid_text in
    select jsonb_object_keys(v_on_this)
  loop
    update smartgov.unit_memberships m
       set end_date = current_date
     where m.end_date is null
       and m.unit_id = v_cid_text::uuid
       and not (m.position_id = any (
             select (jsonb_array_elements_text(v_on_this -> v_cid_text))::uuid));

    delete from smartgov.unit_positions up
     where up.unit_id = v_cid_text::uuid
       and not (up.position_id = any (
             select (jsonb_array_elements_text(v_on_this -> v_cid_text))::uuid));
  end loop;

  return jsonb_build_object('ok', true, 'committees', array_length(v_kept, 1), 'seats', v_seats);
end;
$$;

revoke all on function smartgov.gov_apply_structure(smartgov.gov_structures) from public;

-- --------------------------------------------------------------- write: submit

-- Same as 02960's, except for what happens when the top tier's self-approval
-- cannot be applied. `gov_record_decision` returns the failure rather than raising,
-- so without this the row would stay `submitted` -- and a top-tier structure has
-- nobody above it, meaning nothing could ever move it again and the council's own
-- government would be permanently unreachable.
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
      update smartgov.gov_structures
         set status = 'draft',
             submitted_at = null,
             updated_at = now()
       where id = v_struct.id
         and status = 'submitted';
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

-- ------------------------------------------------------------------ one unit

-- `draft` is the author's working copy. A reviewer has to be able to read a
-- submission -- that is the whole job -- but not a draft that has not been sent
-- yet, because the queue deliberately hides drafts from reviewers and that promise
-- has to be a gate rather than a UI convention.
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
  v_hidden  boolean := false;
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

  if v_open.id is not null
     and v_open.created_by <> v_account.id
     and v_open.status in ('draft','returned') then
    v_hidden := true;
  end if;

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
    'draft', case when v_open.id is null or v_hidden then null
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
             and not (s.id = coalesce(v_live.id, '00000000-0000-0000-0000-000000000000'::uuid))
             and (not v_hidden or s.id <> v_open.id)
        ) t
    ), '[]'::jsonb),
    -- What the dashboard's Renew button needs, without it having to read the
    -- whole structure to decide whether to offer itself. A hidden draft still
    -- blocks renewal: the author is not the one asking, so it is not their slot to
    -- overwrite.
    'renewal', jsonb_build_object(
      'canRequest', (v_access->>'canEdit')::boolean
                    and v_live.id is not null
                    and (v_open.id is null or v_open.created_by = v_account.id),
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

-- The public forwarder is `language sql`, and a `language sql` body is resolved when
-- the function is created, so it is replaced here rather than in 02970.
create or replace function public.get_structure(p_session_token text, p_unit_id uuid)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.get_structure(p_session_token, p_unit_id); $$;
revoke all on function public.get_structure(text, uuid) from public;
grant execute on function public.get_structure(text, uuid) to anon, authenticated;

create or replace function public.submit_structure(p_session_token text, p_structure_id uuid, p_note text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.submit_structure(p_session_token, p_structure_id, p_note); $$;
revoke all on function public.submit_structure(text, uuid, text) from public;
grant execute on function public.submit_structure(text, uuid, text) to anon, authenticated;