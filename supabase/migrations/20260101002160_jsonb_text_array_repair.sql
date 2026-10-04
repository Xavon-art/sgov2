-- Repair migration. The 002150 that reached production carried a `::text[]`
-- cast on the allowed_extensions insert, and Postgres 17 rejects the jsonb ->
-- text[] cast outright (42846), so create_program / set_default_requirements
-- still failed after 002150. This re-declares the same two template writers
-- exactly as the corrected 002150 body, through the jsonb_array_elements_text
-- aggregate. The helper and both functions are create-or-replace, so the file
-- is a no-op on databases that never ran the broken 002150.
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

-- proposal_items_valid holds the same jsonb -> text[] cast on the file-extension
-- allowlist; re-declared through the helper so create_proposal/submit_revision
-- stop raising 42846 on their very first file submission.
create or replace function smartgov.proposal_items_valid(
  p_account  smartgov.accounts,
  p_template jsonb,
  p_items    jsonb,
  p_version  int
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_i      int;
  v_t      jsonb;
  v_tid    uuid;
  v_entry  jsonb;
  v_ext    text;
  v_name   text;
  v_path   text;
  v_link   text;
  v_size   bigint;
  v_frag   text;
  v_found  boolean;
  v_e      int;
begin
  for v_i in 0 .. jsonb_array_length(p_template) - 1 loop
    v_t    := p_template->v_i;
    v_tid  := (v_t->>'id')::uuid;
    v_found := false;

    for v_e in 0 .. jsonb_array_length(p_items) - 1 loop
      v_entry := p_items->v_e;
      if (v_entry->>'requirement_item_id')::uuid = v_tid then
        v_found := true;
        exit;
      end if;
    end loop;

    if not v_found then
      return jsonb_build_object('ok', false, 'reason', 'incomplete_submission');
    end if;

    if v_entry->>'kind' <> v_t->>'itemKind' then
      return jsonb_build_object('ok', false, 'reason', 'invalid_request');
    end if;

    if v_t->>'itemKind' = 'file' then
      v_name := v_entry->>'originalName';
      v_path := v_entry->>'storagePath';
      v_size := coalesce((v_entry->>'sizeBytes')::bigint, 0);
      if v_name is null or position('/' in v_name) > 0
         or position('\' in v_name) > 0 or length(v_name) > 128
         or v_path is null or v_size < 1 or v_size > 10485760 then
        return jsonb_build_object('ok', false, 'reason', 'invalid_request');
      end if;
      v_ext := lower(substring(v_name from '[^.]+$'));
      if not (v_ext = any(smartgov.jsonb_text_array(v_t->'allowedExtensions'))) then
        return jsonb_build_object('ok', false, 'reason', 'unsupported_file_type');
      end if;
      v_frag := substring(v_path from 'proposals/([^/]+)/');
      if v_frag is null
         or v_path <> p_account.organization_id::text || '/proposals/'
              || v_frag || '/v' || p_version || '/'
              || v_tid || '/' || v_name then
        return jsonb_build_object('ok', false, 'reason', 'invalid_request');
      end if;
    else
      v_link := btrim(v_entry->>'linkUrl');
      if v_link !~ '^https?://' or length(v_link) > 2048 then
        return jsonb_build_object('ok', false, 'reason', 'invalid_request');
      end if;
    end if;
  end loop;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function smartgov.proposal_items_valid(
  smartgov.accounts, jsonb, jsonb, int) from public;

-- Forwarders unchanged in shape; grants survive the body replacements but are
-- re-declared for the migration audit.
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