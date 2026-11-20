-- Structure drafts keep their holders' photos.
--
-- The chart stores a holder's picture in the organization roster, not in the
-- structure document: a document read strips `photo` and marks `hasPhoto` from
-- the roster row. But the roster row was only written when a structure was
-- *approved* (`gov_apply_structure` -> `gov_upsert_holder`). An autosaved draft
-- therefore kept the base64 in `gov_structures.document` where no read looks,
-- and the next page load showed the picture gone.
--
-- This writes the photo to the existing roster row at draft save time, then
-- strips it from the stored document. Only an existing row is updated: a holder
-- with no roster row has nowhere to keep the picture, and inventing a row from
-- an email alone would create a placeholder nobody can resolve.

create or replace function smartgov.gov_persist_holder_photo(
  p_organization uuid,
  p_holder       jsonb
)
returns void
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_email    text := lower(btrim(coalesce(p_holder->>'email', '')));
  v_photo    bytea;
  v_new_oid  oid;
  v_old_oid  oid;
begin
  if v_email = '' or coalesce(p_holder->>'photo', '') = '' then
    return;
  end if;

  begin
    v_photo := decode(p_holder->>'photo', 'base64');
  exception when others then
    return;
  end;

  if length(v_photo) = 0 or length(v_photo) > 524288 then
    return;
  end if;

  select photo_oid into v_old_oid
    from smartgov.roster
   where organization_id = p_organization
     and lower(email) = v_email;

  if v_old_oid is null then
    return;
  end if;

  v_new_oid := lo_from_bytea(0, v_photo);

  if v_old_oid <> v_new_oid then
    begin
      perform lo_unlink(v_old_oid);
    exception when others then
      null;
    end;
  end if;

  update smartgov.roster
     set photo_oid   = v_new_oid,
         photo_mime  = 'image/jpeg',
         photo_bytes = length(v_photo)
   where organization_id = p_organization
     and lower(email) = v_email;
end;
$$;

revoke all on function smartgov.gov_persist_holder_photo(uuid, jsonb) from public;

-- Walks the document once, saving any holder photo that is present, then hands
-- back the same document with `photo` removed so the base64 is never stored.
create or replace function smartgov.gov_persist_holder_photos(
  p_organization uuid,
  p_document     jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_doc jsonb;
  v_c   jsonb;
  v_p   jsonb;
  v_h   jsonb;
begin
  if jsonb_typeof(p_document) <> 'object'
     or jsonb_typeof(p_document->'committees') <> 'array' then
    return smartgov.gov_strip_photos(p_document);
  end if;

  v_doc := p_document;

  for v_c in select value from jsonb_array_elements(v_doc->'committees') loop
    if jsonb_typeof(v_c->'positions') <> 'array' then
      continue;
    end if;

    for v_p in select value from jsonb_array_elements(v_c->'positions') loop
      if jsonb_typeof(v_p->'holder') = 'object'
         and v_p->'holder' <> '{}'::jsonb
         and coalesce(v_p->'holder'->>'photo', '') <> '' then
        perform smartgov.gov_persist_holder_photo(p_organization, v_p->'holder');
      end if;

      if jsonb_typeof(v_p->'holders') = 'array' then
        for v_h in select value from jsonb_array_elements(v_p->'holders') loop
          if coalesce(v_h->>'photo', '') <> '' then
            perform smartgov.gov_persist_holder_photo(p_organization, v_h);
          end if;
        end loop;
      end if;
    end loop;
  end loop;

  return smartgov.gov_strip_photos(v_doc);
end;
$$;

revoke all on function smartgov.gov_persist_holder_photos(uuid, jsonb) from public;

-- Same draft save, one step earlier: the upgraded document's photos are written
-- to the roster before it is stored, and the stored document is the stripped
-- one. Nothing else about the save changes.
create or replace function smartgov.save_structure_draft_v2(
  p_session_token        text,
  p_unit_id              uuid,
  p_template_key         text,
  p_term_label           text,
  p_starts_on            date,
  p_ends_on              date,
  p_document             jsonb,
  p_note                 text,
  p_expected_updated_at  timestamptz default null
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
  v_document  jsonb;
  v_struct    smartgov.gov_structures%rowtype;
  v_root      uuid;
  v_previous  timestamptz;
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

  -- Upgrade first: the validator has to see the same fields the renderer will,
  -- and the stored draft should not need upgrading on every later read.
  v_document := smartgov.gov_document_upgrade(p_document);

  -- A photo in the document is write-only. Persist it where the read path can
  -- find it, and store the document without it.
  v_document := smartgov.gov_persist_holder_photos(v_account.organization_id, v_document);

  v_valid := smartgov.gov_document_valid(v_document);
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
      return jsonb_build_object('ok', false, 'reason', 'awaiting_review');
    end if;

    if p_expected_updated_at is not null
       and v_struct.updated_at is distinct from p_expected_updated_at then
      return jsonb_build_object(
        'ok', false, 'reason', 'conflict',
        'detail', 'This structure was changed somewhere else.',
        'updatedAt', v_struct.updated_at,
        'status', v_struct.status,
        'revision', v_struct.revision);
    end if;

    v_previous := v_struct.updated_at;

    update smartgov.gov_structures s
       set template_key = coalesce(nullif(btrim(coalesce(p_template_key, '')), ''), s.template_key),
           term_label = btrim(p_term_label),
           starts_on = p_starts_on,
           ends_on = p_ends_on,
           document = v_document,
           note = left(btrim(coalesce(p_note, '')), 1000),
           status = 'draft',
           revision = case
                        when s.status = 'returned'
                          or s.document is distinct from v_document
                          or s.starts_on is distinct from p_starts_on
                          or s.ends_on is distinct from p_ends_on
                          or s.term_label is distinct from btrim(p_term_label)
                        then s.revision + 1
                        else s.revision
                      end,
           -- `now()` can equal the previous timestamp inside one transaction.
           -- The conflict check compares for inequality, so the update must move.
           updated_at = greatest(now(), coalesce(v_previous, now()) + interval '1 microsecond')
      where s.id = v_struct.id
      returning * into v_struct;
  else
    insert into smartgov.gov_structures (
      organization_id, unit_id, author_kind, created_by, template_key,
      term_label, starts_on, ends_on, status, document, note
    ) values (
      v_account.organization_id, p_unit_id,
      case when p_unit_id = v_root then 'usg' else 'lsg' end,
      v_account.id, nullif(btrim(coalesce(p_template_key, '')), ''),
      btrim(p_term_label), p_starts_on, p_ends_on, 'draft', v_document,
      left(btrim(coalesce(p_note, '')), 1000)
    ) returning * into v_struct;
  end if;

  return jsonb_build_object(
    'ok', true,
    'structureId', v_struct.id,
    'status', v_struct.status,
    'revision', v_struct.revision,
    'authorKind', v_struct.author_kind,
    'updatedAt', v_struct.updated_at
  );
end;
$$;

revoke all on function smartgov.save_structure_draft_v2(text, uuid, text, text, date, date, jsonb, text, timestamptz) from public;

create or replace function public.save_structure_draft_v2(
  p_session_token       text,
  p_unit_id             uuid,
  p_template_key        text,
  p_term_label          text,
  p_starts_on           date,
  p_ends_on             date,
  p_document            jsonb,
  p_note                text,
  p_expected_updated_at timestamptz default null
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
  select smartgov.save_structure_draft_v2(
    p_session_token, p_unit_id, p_template_key, p_term_label,
    p_starts_on, p_ends_on, p_document, p_note, p_expected_updated_at);
$$;

revoke all on function public.save_structure_draft_v2(text, uuid, text, text, date, date, jsonb, text, timestamptz) from public;
grant execute on function public.save_structure_draft_v2(text, uuid, text, text, date, date, jsonb, text, timestamptz) to anon, authenticated;

notify pgrst, 'reload schema';
