-- proposal_detail's version items add submission ids so an authorized viewer
-- (author, their unit, the USG board) can open the original document through
-- the scoped get_item_file gate. Everything else about the read is unchanged.
create or replace function smartgov.proposal_detail(
  p_session_token text,
  p_proposal_id   uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_proposal smartgov.proposals%rowtype;
  v_ok boolean;
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  select pr.id, pr.organization_id, pr.program_id, pr.unit_id, pr.author_kind,
         pr.created_by, pr.title, pr.description, pr.activity_type,
         pr.event_date, pr.venue, pr.status, pr.created_at
    into v_proposal
    from smartgov.proposals pr
   where pr.id = p_proposal_id
     and pr.organization_id = v_account.organization_id;

  if v_proposal.id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_proposal');
  end if;

  v_ok := v_account.account_scope = 'owner'
       or smartgov.is_org_reviewer(v_account.id, v_account.organization_id)
       or v_proposal.created_by = v_account.id
       or (v_proposal.unit_id is not null and v_proposal.unit_id in (
             select u from smartgov.lsg_unit_ids(v_account.id, v_account.organization_id) u
           ));

  if not v_ok then
    -- Foreign scope is indistinguishable from a missing row.
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  return jsonb_build_object(
    'ok', true,
    'proposal', jsonb_build_object(
      'id', v_proposal.id,
      'title', v_proposal.title,
      'description', v_proposal.description,
      'status', v_proposal.status,
      'authorKind', v_proposal.author_kind,
      'activityType', v_proposal.activity_type,
      'eventDate', v_proposal.event_date,
      'venue', v_proposal.venue,
      'createdAt', v_proposal.created_at,
      'programId', v_proposal.program_id,
      'programName', (select pr.name from smartgov.programs pr where pr.id = v_proposal.program_id),
      'unitId', v_proposal.unit_id,
      'unitName', (select u.name from public.governance_units u where u.id = v_proposal.unit_id),
      'versions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', pv.id,
          'versionNumber', pv.version_number,
          'submittedBy', (select a.display_name from smartgov.accounts a where a.id = pv.submitted_by),
          'submissionNote', pv.submission_note,
          'submittedAt', pv.submitted_at,
          'items', coalesce((
            select jsonb_agg(jsonb_build_object(
              'itemId', isub.requirement_item_id,
              'submissionId', isub.id,
              'label', (select ri.label from smartgov.requirement_items ri where ri.id = isub.requirement_item_id),
              'itemKind', (select ri.item_kind from smartgov.requirement_items ri where ri.id = isub.requirement_item_id),
              'submissionKind', isub.submission_kind,
              'storagePath', isub.storage_path,
              'originalName', isub.original_name,
              'mimeType', isub.mime_type,
              'sizeBytes', isub.size_bytes,
              'linkUrl', isub.link_url
            ))
            from smartgov.item_submissions isub
            where isub.version_id = pv.id
          ), jsonb '[]')
        ) order by pv.version_number desc)
        from smartgov.proposal_versions pv
        where pv.proposal_id = v_proposal.id
      ), jsonb '[]'),
      'reviews', coalesce((
        select jsonb_agg(jsonb_build_object(
          'versionNumber', pv2.version_number,
          'decision', rev.decision,
          'remark', rev.remark,
          'decidedBy', (select a2.display_name from smartgov.accounts a2 where a2.id = rev.decided_by),
          'createdAt', rev.created_at
        ) order by rev.created_at desc)
        from smartgov.reviews rev
        join smartgov.proposal_versions pv2 on pv2.id = rev.version_id
        where rev.proposal_id = v_proposal.id
      ), jsonb '[]')
    )
  );
end;
$$;

revoke all on function smartgov.proposal_detail(text, uuid) from public;

-- The public wrapper delegates untouched; grants were set by 002000 and survive
-- the body replacement above, but re-declared for the migration audit.
create or replace function public.proposal_detail(p_session_token text, p_proposal_id uuid)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.proposal_detail(p_session_token, p_proposal_id); $$;
revoke all on function public.proposal_detail(text, uuid) from public;
grant execute on function public.proposal_detail(text, uuid) to anon, authenticated;

-- ------------------------------------------------------------------- my_unit

-- The single local unit an invited officer drafts from. `create_proposal`
-- requires the caller's lsg unit id, so the shells need this read before a
-- draft form can open; owners answer null (they publish USG-wide, unit-less).
create or replace function smartgov.my_unit(p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_first   uuid;
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  select u into v_first
    from smartgov.lsg_unit_ids(v_account.id, v_account.organization_id) u
   limit 1;

  return jsonb_build_object('ok', true, 'unitId', v_first);
end;
$$;

revoke all on function smartgov.my_unit(text) from public;

create or replace function public.my_unit(p_session_token text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.my_unit(p_session_token); $$;
revoke all on function public.my_unit(text) from public;
grant execute on function public.my_unit(text) to anon, authenticated;

-- The `::text[]` cast does not exist for jsonb on every supported Postgres
-- (it raises 42846 on the current server), so template writers go through an
-- aggregate over jsonb_array_elements_text: on an empty array that yields a
-- NULL the coalesce turns into '{}', the same empty text[] a fresh default
-- template is created with.
create or replace function smartgov.jsonb_text_array(p_value jsonb)
returns text[]
language sql stable
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
  select coalesce(
    (select array_agg(elem) from jsonb_array_elements_text(p_value) elem),
    '{}'::text[]
  );
$$;

revoke all on function smartgov.jsonb_text_array(jsonb) from public;

-- -------------------------------------------------- allowed_extensions cast

-- 002000 inserted `p_items->...'allowed_extensions'` (a jsonb value) directly
-- into requirement_items.allowed_extensions (text[]). Postgres refuses the bare
-- jsonb -> text[] assignment (42804) and `::text[]` raises 42846, so create_program
-- and set_default_requirements fail the moment a template with a file item is
-- written. The migration audit checked function shape, not execution; this
-- re-declaration folds the payload through smartgov.jsonb_text_array.
create or replace function smartgov.create_program(p_session_token text, p_name text, p_description text, p_icon text, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_program_id uuid;
  v_label text;
  v_kind  text;
  v_i     int;
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if v_account.account_scope <> 'owner' then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if length(btrim(p_name)) < 3 or length(btrim(p_name)) > 120
     or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  if v_account.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;

  if p_icon is null
     or p_icon not in ('sports','culture','academic','community','wellness','special')
     or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  if not smartgov.consume_rate_limit(
       'program:create:' || v_account.id::text, 20, interval '10 minutes') then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  for v_i in 0 .. jsonb_array_length(p_items) - 1 loop
    v_label := btrim(p_items->v_i->>'label');
    v_kind  := p_items->v_i->>'item_kind';
    if length(v_label) < 2 or length(v_label) > 140
       or v_kind not in ('file','link')
       or (v_kind = 'file' and jsonb_array_length(coalesce(p_items->v_i->'allowed_extensions', jsonb '[]')) < 1) then
      return jsonb_build_object('ok', false, 'reason', 'invalid_request');
    end if;
  end loop;

  insert into smartgov.programs (
    organization_id, created_by, name, description, icon, status
  ) values (
    v_account.organization_id, v_account.id, btrim(p_name),
    btrim(coalesce(p_description, '')), p_icon, 'published'
  ) returning id into v_program_id;

  for v_i in 0 .. jsonb_array_length(p_items) - 1 loop
    insert into smartgov.requirement_items (
      organization_id, program_id, label, item_kind, allowed_extensions, position
    ) values (
      v_account.organization_id, v_program_id,
      btrim(p_items->v_i->>'label'),
      p_items->v_i->>'item_kind',
      smartgov.jsonb_text_array(coalesce(p_items->v_i->'allowed_extensions', jsonb '[]')),
      coalesce((p_items->v_i->>'position')::int, v_i)
    );
  end loop;

  return jsonb_build_object('ok', true, 'programId', v_program_id, 'name', btrim(p_name));
end;
$$;

revoke all on function smartgov.create_program(text, text, text, text, jsonb) from public;

create or replace function smartgov.set_default_requirements(p_session_token text, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_label   text;
  v_kind    text;
  v_i       int;
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if v_account.account_scope <> 'owner' then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  if not smartgov.consume_rate_limit(
       'requirements:set:' || v_account.id::text, 20, interval '10 minutes') then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  for v_i in 0 .. jsonb_array_length(p_items) - 1 loop
    v_label := btrim(p_items->v_i->>'label');
    v_kind  := p_items->v_i->>'item_kind';
    if length(v_label) < 2 or length(v_label) > 140
       or v_kind not in ('file','link')
       or (v_kind = 'file' and jsonb_array_length(coalesce(p_items->v_i->'allowed_extensions', jsonb '[]')) < 1) then
      return jsonb_build_object('ok', false, 'reason', 'invalid_request');
    end if;
  end loop;

  delete from smartgov.requirement_items
   where program_id is null
     and organization_id = v_account.organization_id;

  for v_i in 0 .. jsonb_array_length(p_items) - 1 loop
    insert into smartgov.requirement_items (
      organization_id, program_id, label, item_kind, allowed_extensions, position
    ) values (
      v_account.organization_id, null,
      btrim(p_items->v_i->>'label'),
      p_items->v_i->>'item_kind',
      smartgov.jsonb_text_array(coalesce(p_items->v_i->'allowed_extensions', jsonb '[]')),
      coalesce((p_items->v_i->>'position')::int, v_i)
    );
  end loop;

  return jsonb_build_object('ok', true, 'count', jsonb_array_length(p_items));
end;
$$;

revoke all on function smartgov.set_default_requirements(text, jsonb) from public;

-- The forwarders are unchanged in shape; grants were set by 002000 and survive
-- the body replacement, but are re-declared for the migration audit.
create or replace function public.create_program(p_session_token text, p_name text, p_description text, p_icon text, p_items jsonb)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.create_program(p_session_token, p_name, p_description, p_icon, p_items); $$;
revoke all on function public.create_program(text, text, text, text, jsonb) from public;
grant execute on function public.create_program(text, text, text, text, jsonb) to anon, authenticated;

create or replace function public.set_default_requirements(p_session_token text, p_items jsonb)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.set_default_requirements(p_session_token, p_items); $$;
revoke all on function public.set_default_requirements(text, jsonb) from public;
grant execute on function public.set_default_requirements(text, jsonb) to anon, authenticated;