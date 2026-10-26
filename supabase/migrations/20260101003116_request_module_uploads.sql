-- Request module: reserving an upload for a task requirement or a personal request.
--
-- The existing `claim_document_upload` reserves a path of the shape
-- `<org>/proposals/<nonce>/v<n>/<item>/<name>` and then checks the named id
-- against `requirement_items`, because its whole purpose is a proposal
-- submission. The new owners -- a task's checklist item and a unit's personal
-- request -- are not requirement items and do not live under a proposal, so
-- they cannot borrow that function without either lying about the id or
-- loosening a check that is currently precise.
--
-- So this file adds one claim per new owner, with its own path shape and its own
-- scope check. Everything downstream is shared and unchanged:
--
--   write_document_chunk     writes bytes, keyed by storage_path
--   confirm_document_upload  seals the object, keyed by storage_path
--   discard_document_upload  gives the reservation back
--
-- Those three never cared what the upload was FOR -- they care that the path
-- belongs to the caller's organization and that the bytes add up -- which is
-- why only the claim has to be written twice.
--
-- The path shapes:
--
--   <org>/tasks/<task>/reqs/v<n>/<requirement>/<name>
--   <org>/requests/v<n>/<unit>/<name>
--
-- Both start with the organization id, because that prefix is what every
-- downstream function uses to decide whether a caller may touch the object. A
-- shape that did not lead with it would be unreachable by `write_document_chunk`
-- at best and claimable by someone else's path at worst.

-- --------------------------------------------------- claim for a checklist item
--
-- The scope rule, and it is narrower than the proposals one on purpose: an
-- upload against a task requirement may only be made by a unit that is actually
-- assigned that task, or by the office that owns it. There is no program, no
-- published template, no reviewer bypass -- a task is a direct instruction, so
-- the only question is whether the caller is one of its parties.
create or replace function smartgov.claim_task_requirement_upload(
  p_session_token text,
  p_storage_path  text,
  p_original_name text,
  p_mime_type     text,
  p_size_bytes    bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_req     smartgov.task_requirements%rowtype;
  v_task    smartgov.tasks%rowtype;
  v_usg     boolean;
  v_units   uuid[];
  v_org     uuid;
  v_task_id uuid;
  v_version int;
  v_req_id  uuid;
  v_ext     text;
  v_t       text;
  v_ok      boolean := false;
  v_oid     bigint;
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if not smartgov.consume_rate_limit(
       'document:upload:' || v_account.id::text, 60, interval '10 minutes') then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  if p_storage_path is null or p_original_name is null or p_size_bytes is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  -- Same name hygiene as the proposals path: no separators, sane length.
  if position('/' in p_original_name) > 0
     or position('\' in p_original_name) > 0
     or length(p_original_name) not between 1 and 128
     or p_size_bytes < 1 or p_size_bytes > 10485760 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  -- The path must begin with the caller's own organization. This is the line
  -- that stops a document landing in another org's namespace.
  v_org := nullif(split_part(p_storage_path, '/', 1), '')::uuid;
  if v_org is null or v_org <> v_account.organization_id then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  -- Each capture is its own `substring` with exactly one group: Postgres returns
  -- an array when a pattern has more than one, which would silently cast to the
  -- wrong thing rather than fail.
  v_task_id := nullif(substring(p_storage_path from '^[^/]+/tasks/([^/]+)/reqs/v[0-9]+/'), '')::uuid;
  v_version := substring(p_storage_path from '^[^/]+/tasks/[^/]+/reqs/v([0-9]+)/')::int;
  v_req_id  := nullif(substring(p_storage_path from '^[^/]+/tasks/[^/]+/reqs/v[0-9]+/([^/]+)/'), '')::uuid;

  if v_task_id is null or v_version is null or v_req_id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  if p_storage_path <> v_account.organization_id::text || '/tasks/'
                       || v_task_id::text || '/reqs/v' || v_version || '/'
                       || v_req_id::text || '/' || p_original_name then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  if v_version < 1 or v_version > 50 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  select t.* into v_task
    from smartgov.tasks t
   where t.id = v_task_id and t.organization_id = v_account.organization_id;

  if v_task.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  select rq.* into v_req
    from smartgov.task_requirements rq
   where rq.id = v_req_id and rq.task_id = v_task_id;

  if v_req.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  v_usg := smartgov.is_usg(v_account.id, v_account.organization_id);

  if not v_usg then
    select coalesce(array_agg(u), '{}'::uuid[]) into v_units
      from smartgov.lsg_unit_ids(v_account.id, v_account.organization_id) u;

    if not exists (select 1 from smartgov.task_assignments ta
                    where ta.task_id = v_task_id and ta.unit_id = any (v_units)) then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
  end if;

  -- A closed task takes no new documents, matching the answer path.
  if v_task.closed_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'task_closed');
  end if;

  -- The accepted-type list is checked here as well as at answer time. Checking
  -- only at answer time would let a person upload a 9 MB file the office will
  -- never accept, which is a waste of their connection as well as ours.
  if jsonb_typeof(v_req.accepted_types) = 'array'
     and jsonb_array_length(v_req.accepted_types) > 0 then
    v_ext := lower(coalesce(nullif(substring(p_original_name from '[^.]+$'), ''), ''));
    for v_t in select jsonb_array_elements_text(v_req.accepted_types) loop
      if lower(btrim(v_t)) = v_ext then
        v_ok := true;
      end if;
    end loop;
    if not v_ok then
      return jsonb_build_object('ok', false, 'reason', 'unaccepted_type');
    end if;
  end if;

  -- An in-flight claim for the same path is reused rather than duplicated; a
  -- fresh reservation is created otherwise. `lo_create(0)` mints an empty large
  -- object for the chunks to be written into.
  select du.large_object_oid into v_oid
    from smartgov.document_uploads du
   where du.storage_path = p_storage_path
     and du.confirmed_at is null
     and du.organization_id = v_account.organization_id
   limit 1;

  if v_oid is null then
    v_oid := lo_create(0);

    insert into smartgov.document_uploads
      (storage_path, organization_id, uploaded_by, task_requirement,
       original_name, mime_type, size_bytes, large_object_oid, written_bytes)
    values
      (p_storage_path, v_account.organization_id, v_account.id, v_req_id,
       p_original_name, coalesce(p_mime_type, ''), p_size_bytes, v_oid, 0);
  end if;

  return jsonb_build_object(
    'ok', true,
    'storagePath', p_storage_path,
    'writtenBytes', coalesce((
      select du.written_bytes from smartgov.document_uploads du
       where du.storage_path = p_storage_path limit 1), 0));
end;
$$;

revoke all on function smartgov.claim_task_requirement_upload(text, text, text, text, bigint) from public;

-- ------------------------------------------------ claim for a personal request
--
-- A personal request has no id until it is filed, so its path is keyed by unit
-- and version rather than by row. The scope rule is the mirror of the one above
-- and deliberately excludes the office: a request is the unit's ask, so only a
-- unit may attach a document to one.
create or replace function smartgov.claim_personal_request_upload(
  p_session_token text,
  p_storage_path  text,
  p_original_name text,
  p_mime_type     text,
  p_size_bytes    bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_units   uuid[];
  v_org     uuid;
  v_unit_id uuid;
  v_version int;
  v_oid     bigint;
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if not smartgov.consume_rate_limit(
       'document:upload:' || v_account.id::text, 60, interval '10 minutes') then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  if p_storage_path is null or p_original_name is null or p_size_bytes is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  if position('/' in p_original_name) > 0
     or position('\' in p_original_name) > 0
     or length(p_original_name) not between 1 and 128
     or p_size_bytes < 1 or p_size_bytes > 10485760 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  v_org := nullif(split_part(p_storage_path, '/', 1), '')::uuid;
  if v_org is null or v_org <> v_account.organization_id then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  -- No fragment segment here: a draft request has no nonce to collide on, and
  -- the version is what lets a unit redo an attachment.
  v_version := substring(p_storage_path from '^[^/]+/requests/v([0-9]+)/')::int;
  v_unit_id := nullif(substring(p_storage_path from '^[^/]+/requests/v[0-9]+/([^/]+)/'), '')::uuid;

  if v_version is null or v_unit_id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  if p_storage_path <> v_account.organization_id::text || '/requests/v'
                       || v_version || '/' || v_unit_id::text || '/'
                       || p_original_name then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  if v_version < 1 or v_version > 50 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  -- Only a unit may attach to a request, and only its own.
  select coalesce(array_agg(u), '{}'::uuid[]) into v_units
    from smartgov.lsg_unit_ids(v_account.id, v_account.organization_id) u;

  if not (v_unit_id = any (v_units)) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  select du.large_object_oid into v_oid
    from smartgov.document_uploads du
   where du.storage_path = p_storage_path
     and du.confirmed_at is null
     and du.organization_id = v_account.organization_id
   limit 1;

  if v_oid is null then
    v_oid := lo_create(0);

    -- `personal_request` stays null: the request row does not exist yet. The
    -- link is made when `file_personal_request` is called with the storage
    -- path, which stamps the owner onto the upload.
    insert into smartgov.document_uploads
      (storage_path, organization_id, uploaded_by, personal_request,
       original_name, mime_type, size_bytes, large_object_oid, written_bytes)
    values
      (p_storage_path, v_account.organization_id, v_account.id, null,
       p_original_name, coalesce(p_mime_type, ''), p_size_bytes, v_oid, 0);
  end if;

  return jsonb_build_object(
    'ok', true,
    'storagePath', p_storage_path,
    'writtenBytes', coalesce((
      select du.written_bytes from smartgov.document_uploads du
       where du.storage_path = p_storage_path limit 1), 0));
end;
$$;

revoke all on function smartgov.claim_personal_request_upload(text, text, text, text, bigint) from public;

-- ------------------------------------------------------------- bind on filing
--
-- `file_personal_request` is re-issued so that a request filed WITH a staged
-- document stamps that document's owner. Without this the upload would sit
-- bound to nothing, satisfy no branch of the exclusivity constraint, and be
-- orphaned the moment the request was created -- the file would upload
-- successfully and then belong to no one.
create or replace function smartgov.file_personal_request(
  p_session_token  text,
  p_unit_id        uuid,
  p_subject        text,
  p_cover_letter   text,
  p_purpose        text,
  p_needed_on      date,
  p_needed_time    time,
  p_needed_timezone text,
  p_link_url       text,
  p_storage_path   text,
  p_original_name  text,
  p_mime_type      text,
  p_size_bytes     bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_units   uuid[];
  v_unit    uuid;
  v_subject text;
  v_letter  text;
  v_link    text;
  v_path    text;
  v_id      uuid;
  v_upload  smartgov.document_uploads%rowtype;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  select coalesce(array_agg(u), '{}'::uuid[]) into v_units
    from smartgov.lsg_unit_ids(v_account.id, v_account.organization_id) u;

  if p_unit_id is not null then
    if not (p_unit_id = any (v_units)) then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
    v_unit := p_unit_id;
  elsif array_length(v_units, 1) is not null then
    v_unit := v_units[1];
  else
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  v_subject := btrim(coalesce(p_subject, ''));
  if length(v_subject) < 4 or length(v_subject) > 160 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_subject');
  end if;

  v_letter := btrim(coalesce(p_cover_letter, ''));
  if length(v_letter) < 10 or length(v_letter) > 8000 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_cover_letter');
  end if;

  if p_needed_on is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;
  if (p_needed_on + coalesce(p_needed_time, '23:59:59'::time)) < now() then
    return jsonb_build_object('ok', false, 'reason', 'past_deadline');
  end if;
  if p_needed_time is not null and nullif(btrim(coalesce(p_needed_timezone, '')), '') is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  v_link := btrim(coalesce(p_link_url, ''));
  v_path := nullif(btrim(coalesce(p_storage_path, '')), '');
  if v_link <> '' and v_path is not null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;
  if length(v_link) > 2000 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;
  if v_path is not null and nullif(btrim(coalesce(p_original_name, '')), '') is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  -- A staged file must exist, belong to this organization, be sealed, belong to
  -- this unit, and not already be owned by a different request. Checking it here
  -- means a request can never point at a file nobody uploaded.
  if v_path is not null then
    select du.* into v_upload
      from smartgov.document_uploads du
     where du.storage_path = v_path
       and du.organization_id = v_account.organization_id;

    if v_upload.storage_path is null then
      return jsonb_build_object('ok', false, 'reason', 'missing_document');
    end if;
    if v_upload.confirmed_at is null then
      return jsonb_build_object('ok', false, 'reason', 'incomplete_upload');
    end if;
    if v_upload.personal_request is not null then
      return jsonb_build_object('ok', false, 'reason', 'already_uploaded');
    end if;

    -- The path carries the unit it was claimed for; a mismatch means someone is
    -- trying to attach another unit's document.
    if not (v_unit = nullif(substring(v_path from '^[^/]+/requests/v[0-9]+/([^/]+)/'), '')::uuid) then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
  end if;

  insert into smartgov.personal_requests
    (organization_id, unit_id, created_by, subject, cover_letter, purpose,
     needed_on, needed_time, needed_timezone, link_url, storage_path,
     original_name, mime_type, size_bytes)
  values
    (v_account.organization_id, v_unit, v_account.id, v_subject, v_letter,
     btrim(coalesce(p_purpose, '')), p_needed_on, p_needed_time,
     nullif(btrim(coalesce(p_needed_timezone, '')), ''), v_link, v_path,
     case when v_path is null then null
          else nullif(btrim(coalesce(p_original_name, '')), '') end,
     case when v_path is null then null
          else nullif(btrim(coalesce(p_mime_type, '')), '') end,
     case when v_path is null then null else p_size_bytes end)
  returning id into v_id;

  -- Bind the staged document to the request it now belongs to.
  if v_path is not null then
    update smartgov.document_uploads
       set personal_request = v_id
     where storage_path = v_path
       and organization_id = v_account.organization_id;
  end if;

  return jsonb_build_object('ok', true, 'requestId', v_id);
end;
$$;

revoke all on function smartgov.file_personal_request(text, uuid, text, text, text, date, time, text, text, text, text, text, bigint) from public;

-- ------------------------------------------------------------- public wrappers
create or replace function public.claim_task_requirement_upload(p_session_token text, p_storage_path text, p_original_name text, p_mime_type text, p_size_bytes bigint)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.claim_task_requirement_upload(p_session_token, p_storage_path, p_original_name, p_mime_type, p_size_bytes); $$;

create or replace function public.claim_personal_request_upload(p_session_token text, p_storage_path text, p_original_name text, p_mime_type text, p_size_bytes bigint)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.claim_personal_request_upload(p_session_token, p_storage_path, p_original_name, p_mime_type, p_size_bytes); $$;

grant execute on function public.claim_task_requirement_upload(text, text, text, text, bigint) to anon, authenticated, service_role;
grant execute on function public.claim_personal_request_upload(text, text, text, text, bigint) to anon, authenticated, service_role;
grant execute on function public.file_personal_request(text, uuid, text, text, text, date, time, text, text, text, text, text, bigint) to anon, authenticated, service_role;
