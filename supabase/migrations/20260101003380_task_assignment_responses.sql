-- An assigned unit's own answer to a task: a note and, optionally, one document.
--
-- A task assignment already had `note`, and `update_assignment_status` already
-- accepted `submitted`. What it had nowhere to live was the *document* that
-- answers the task -- the checklists (`task_requirements`) are the office's
-- questions, not a unit's free-form handover. The LSG therefore had no place to
-- attach the file the task actually asked for.
--
-- The document machinery is reused rather than duplicated: the upload is claimed,
-- chunked, and confirmed exactly like every other document, and the answer row
-- stores the sealed path. The path shape carries the task and the unit so the
-- claim function can refuse an upload for a task the caller is not assigned.

alter table smartgov.task_assignments
  add column if not exists response_path  text,
  add column if not exists response_name  text,
  add column if not exists response_mime  text,
  add column if not exists response_bytes bigint,
  add column if not exists responded_by   uuid references smartgov.accounts (id) on delete set null,
  add column if not exists responded_at   timestamptz;

create index if not exists task_assignments_responded_idx
  on smartgov.task_assignments (task_id, responded_at desc)
  where responded_at is not null;

-- ------------------------------------------------------------- claim the bytes
--
-- Path: `<org>/tasks/<task>/response/v<n>/<unit>/<name>`
--
-- Only the assigned unit may claim; there is no office path here, because the
-- office authors the task and does not answer it.
create or replace function smartgov.claim_task_assignment_upload(
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
  v_task    smartgov.tasks%rowtype;
  v_units   uuid[];
  v_org     uuid;
  v_task_id uuid;
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

  v_task_id := nullif(substring(p_storage_path from '^[^/]+/tasks/([^/]+)/response/'), '')::uuid;
  v_version := substring(p_storage_path from '^[^/]+/tasks/[^/]+/response/v([0-9]+)/')::int;
  v_unit_id := nullif(substring(p_storage_path from '^[^/]+/tasks/[^/]+/response/v[0-9]+/([^/]+)/'), '')::uuid;

  if v_task_id is null or v_version is null or v_unit_id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  if p_storage_path <> v_account.organization_id::text || '/tasks/'
                        || v_task_id::text || '/response/v' || v_version || '/'
                        || v_unit_id::text || '/' || p_original_name then
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

  if v_task.closed_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'task_closed');
  end if;

  select coalesce(array_agg(u), '{}'::uuid[]) into v_units
    from smartgov.lsg_unit_ids(v_account.id, v_account.organization_id) u;

  if not (v_unit_id = any (v_units)) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if not exists (select 1 from smartgov.task_assignments ta
                  where ta.task_id = v_task_id and ta.unit_id = v_unit_id) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  select du.large_object_oid into v_oid
    from smartgov.document_uploads du
   where du.storage_path = p_storage_path
     and du.confirmed_at is null
     and du.organization_id = v_account.organization_id
   limit 1;

  if v_oid is null then
    v_oid := lo_create(0);

    insert into smartgov.document_uploads
      (storage_path, organization_id, uploaded_by,
       original_name, mime_type, size_bytes, large_object_oid, written_bytes)
    values
      (p_storage_path, v_account.organization_id, v_account.id,
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

revoke all on function smartgov.claim_task_assignment_upload(text, text, text, text, bigint) from public;

-- ------------------------------------------------------- seal the answer
--
-- One call, because "here is my note and here is my file" is one act. A note
-- without a file and a file without a note are both accepted; neither alone is
-- empty.
create or replace function smartgov.submit_assignment_response(
  p_session_token text,
  p_task_id       uuid,
  p_unit_id       uuid,
  p_note          text,
  p_storage_path  text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_task    smartgov.tasks%rowtype;
  v_assign  smartgov.task_assignments%rowtype;
  v_units   uuid[];
  v_note    text := btrim(coalesce(p_note, ''));
  v_doc     smartgov.document_uploads%rowtype;
  v_task_id uuid;
  v_unit_id uuid;
  v_version int;
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if length(v_note) > 4000 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  select t.* into v_task
    from smartgov.tasks t
   where t.id = p_task_id and t.organization_id = v_account.organization_id;

  if v_task.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if v_task.closed_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'task_closed');
  end if;

  select coalesce(array_agg(u), '{}'::uuid[]) into v_units
    from smartgov.lsg_unit_ids(v_account.id, v_account.organization_id) u;

  if not (p_unit_id = any (v_units)) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  select ta.* into v_assign
    from smartgov.task_assignments ta
   where ta.task_id = p_task_id and ta.unit_id = p_unit_id
   for update;

  if v_assign.task_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if v_assign.status = 'done' then
    return jsonb_build_object('ok', false, 'reason', 'already_done');
  end if;

  if p_storage_path is not null and btrim(p_storage_path) <> '' then
    -- Re-check the shape here. The claim has already run, but this call is a
    -- different transaction and a caller who skipped the claim must not be able
    -- to point the answer at somebody else's document.
    v_task_id := nullif(substring(p_storage_path from '^[^/]+/tasks/([^/]+)/response/'), '')::uuid;
    v_version := substring(p_storage_path from '^[^/]+/tasks/[^/]+/response/v([0-9]+)/')::int;
    v_unit_id := nullif(substring(p_storage_path from '^[^/]+/tasks/[^/]+/response/v[0-9]+/([^/]+)/'), '')::uuid;

    if v_task_id is null or v_task_id <> p_task_id
       or v_unit_id is null or v_unit_id <> p_unit_id
       or v_version is null
       or p_storage_path <> v_account.organization_id::text || '/tasks/'
                            || p_task_id::text || '/response/v' || v_version || '/'
                            || p_unit_id::text || '/'
                            || substring(p_storage_path from '^[^/]+/tasks/[^/]+/response/v[0-9]+/[^/]+/(.+)$') then
      return jsonb_build_object('ok', false, 'reason', 'invalid_request');
    end if;

    select du.* into v_doc
      from smartgov.document_uploads du
     where du.storage_path = p_storage_path
       and du.organization_id = v_account.organization_id
       and du.confirmed_at is not null
       and du.large_object_oid is not null
       and du.written_bytes = du.size_bytes;

    if v_doc.storage_path is null then
      return jsonb_build_object('ok', false, 'reason', 'missing_document');
    end if;

    if v_assign.response_path is not null
       and v_assign.response_path <> v_doc.storage_path then
      delete from smartgov.document_uploads
       where storage_path = v_assign.response_path;
    end if;
  end if;

  if v_note = '' and (p_storage_path is null or btrim(p_storage_path) = '') then
    return jsonb_build_object('ok', false, 'reason', 'answer_required');
  end if;

  update smartgov.task_assignments
     set status = 'submitted',
         note = v_note,
         response_path  = case when p_storage_path is null or btrim(p_storage_path) = ''
                               then null else v_doc.storage_path end,
         response_name  = case when p_storage_path is null or btrim(p_storage_path) = ''
                               then null else v_doc.original_name end,
         response_mime  = case when p_storage_path is null or btrim(p_storage_path) = ''
                               then null else v_doc.mime_type end,
         response_bytes = case when p_storage_path is null or btrim(p_storage_path) = ''
                               then null else v_doc.size_bytes end,
         responded_by = v_account.id,
         responded_at = now(),
         updated_by = v_account.id,
         updated_at = now()
   where task_id = p_task_id and unit_id = p_unit_id;

  return jsonb_build_object('ok', true, 'status', 'submitted');
end;
$$;

revoke all on function smartgov.submit_assignment_response(text, uuid, uuid, text, text) from public;

-- ------------------------------------------------------------- the read side
--
-- The office sees every unit's response; a unit sees its own. The file path is
-- not in this payload -- only whether one is attached and what it is called --
-- so a reader still has to pass the download gate.
create or replace function smartgov.task_assignment_responses(
  p_session_token text,
  p_task_id       uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_task    smartgov.tasks%rowtype;
  v_usg     boolean;
  v_units   uuid[];
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  select t.* into v_task
    from smartgov.tasks t
   where t.id = p_task_id and t.organization_id = v_account.organization_id;

  if v_task.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  v_usg := smartgov.is_usg(v_account.id, v_account.organization_id);

  select coalesce(array_agg(u), '{}'::uuid[]) into v_units
    from smartgov.lsg_unit_ids(v_account.id, v_account.organization_id) u;

  if not v_usg and not exists (
    select 1 from smartgov.task_assignments ta
     where ta.task_id = p_task_id and ta.unit_id = any (v_units)
  ) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  return jsonb_build_object(
    'ok', true,
    'assignments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'unitId', ta.unit_id,
        'unitName', (select gu.name from public.governance_units gu where gu.id = ta.unit_id),
        'status', ta.status,
        'note', ta.note,
        'responseName', ta.response_name,
        'responseMime', ta.response_mime,
        'responseBytes', ta.response_bytes,
        'hasResponse', ta.response_path is not null,
        'respondedAt', ta.responded_at,
        'updatedAt', ta.updated_at,
        'mine', (ta.unit_id = any (v_units))
      ) order by (select gu.name from public.governance_units gu where gu.id = ta.unit_id))
        from smartgov.task_assignments ta
       where ta.task_id = p_task_id
         and (v_usg or ta.unit_id = any (v_units))
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function smartgov.task_assignment_responses(text, uuid) from public;

-- --------------------------------------------------------------- download gate
create or replace function smartgov.get_task_assignment_file(
  p_session_token text,
  p_task_id       uuid,
  p_unit_id       uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_task    smartgov.tasks%rowtype;
  v_usg     boolean;
  v_units   uuid[];
  v_assign  smartgov.task_assignments%rowtype;
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  select t.* into v_task
    from smartgov.tasks t
   where t.id = p_task_id and t.organization_id = v_account.organization_id;

  if v_task.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  v_usg := smartgov.is_usg(v_account.id, v_account.organization_id);

  select coalesce(array_agg(u), '{}'::uuid[]) into v_units
    from smartgov.lsg_unit_ids(v_account.id, v_account.organization_id) u;

  if not v_usg and not (p_unit_id = any (v_units)) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  select ta.* into v_assign
    from smartgov.task_assignments ta
   where ta.task_id = p_task_id and ta.unit_id = p_unit_id;

  if v_assign.response_path is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  return jsonb_build_object(
    'ok', true,
    'originalName', v_assign.response_name,
    'mimeType', v_assign.response_mime,
    'sizeBytes', v_assign.response_bytes,
    'largeObjectOid', (
      select du.large_object_oid from smartgov.document_uploads du
       where du.storage_path = v_assign.response_path limit 1)
  );
end;
$$;

revoke all on function smartgov.get_task_assignment_file(text, uuid, uuid) from public;

-- ------------------------------------------------------------- public doors
create or replace function public.claim_task_assignment_upload(
  p_session_token text, p_storage_path text, p_original_name text,
  p_mime_type text, p_size_bytes bigint
) returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.claim_task_assignment_upload($1,$2,$3,$4,$5); $$;

revoke all on function public.claim_task_assignment_upload(text, text, text, text, bigint) from public;
grant execute on function public.claim_task_assignment_upload(text, text, text, text, bigint) to anon, authenticated;

create or replace function public.submit_assignment_response(
  p_session_token text, p_task_id uuid, p_unit_id uuid, p_note text, p_storage_path text
) returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.submit_assignment_response($1,$2,$3,$4,$5); $$;

revoke all on function public.submit_assignment_response(text, uuid, uuid, text, text) from public;
grant execute on function public.submit_assignment_response(text, uuid, uuid, text, text) to anon, authenticated;

create or replace function public.task_assignment_responses(
  p_session_token text, p_task_id uuid
) returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.task_assignment_responses($1,$2); $$;

revoke all on function public.task_assignment_responses(text, uuid) from public;
grant execute on function public.task_assignment_responses(text, uuid) to anon, authenticated;

create or replace function public.get_task_assignment_file(
  p_session_token text, p_task_id uuid, p_unit_id uuid
) returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.get_task_assignment_file($1,$2,$3); $$;

revoke all on function public.get_task_assignment_file(text, uuid, uuid) from public;
grant execute on function public.get_task_assignment_file(text, uuid, uuid) to anon, authenticated;

notify pgrst, 'reload schema';
