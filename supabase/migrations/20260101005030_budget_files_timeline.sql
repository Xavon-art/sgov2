alter table smartgov.document_uploads
  add column if not exists budget_request_id uuid references smartgov.budget_requests (id) on delete cascade,
  add column if not exists usg_expense_id uuid references smartgov.usg_expenses (id) on delete cascade,
  add column if not exists budget_kind text check (budget_kind in ('justification', 'receipt', 'usg_expense')),
  add column if not exists budget_scope uuid;

create index if not exists document_uploads_budget_request_idx
  on smartgov.document_uploads (budget_request_id, budget_kind);
create index if not exists document_uploads_usg_expense_idx
  on smartgov.document_uploads (usg_expense_id);

create or replace function smartgov.budget_can_read(
  p_account smartgov.accounts,
  p_budget smartgov.budget_requests
)
returns boolean
language sql
stable
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
  select smartgov.budget_is_usg(p_account)
      or p_budget.unit_id = any (select smartgov.lsg_unit_ids(p_account.id, p_account.organization_id));
$$;

create or replace function smartgov.claim_budget_upload(
  p_session_token text,
  p_storage_path text,
  p_original_name text,
  p_mime_type text,
  p_size_bytes bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_kind text;
  v_scope uuid;
  v_nonce uuid;
  v_oid oid;
  v_written bigint;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then return jsonb_build_object('ok', false, 'reason', 'unauthenticated'); end if;
  if not smartgov.consume_rate_limit('document:upload:' || v_account.id::text, 60, interval '10 minutes') then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;
  if p_storage_path is null or p_original_name is null or p_size_bytes is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;
  if p_storage_path !~ '^[^/]+/budgets/[^/]+/[^/]+/[^/]+/[^/]+$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;
  if split_part(p_storage_path, '/', 2) <> 'budgets'
     or split_part(p_storage_path, '/', 6) <> p_original_name
     or position('/' in p_original_name) > 0
     or position('\' in p_original_name) > 0
     or length(p_original_name) not between 1 and 128
     or p_size_bytes < 1 or p_size_bytes > 10485760 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  v_kind := lower(split_part(p_storage_path, '/', 3));
  v_scope := nullif(split_part(p_storage_path, '/', 4), '')::uuid;
  v_nonce := nullif(split_part(p_storage_path, '/', 5), '')::uuid;
  if v_kind not in ('justification', 'receipt', 'usg_expense') or v_scope is null or v_nonce is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;
  if nullif(split_part(p_storage_path, '/', 1), '')::uuid is distinct from v_account.organization_id then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if v_kind = 'usg_expense' then
    if not smartgov.budget_is_usg(v_account) or v_scope <> v_account.organization_id then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
  elsif smartgov.budget_is_usg(v_account)
     or not (v_scope = any (select smartgov.lsg_unit_ids(v_account.id, v_account.organization_id))) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if exists (
    select 1 from smartgov.document_uploads du
     where du.storage_path = p_storage_path and du.confirmed_at is not null
  ) then
    return jsonb_build_object('ok', false, 'reason', 'already_uploaded');
  end if;

  select du.large_object_oid, du.written_bytes into v_oid, v_written
    from smartgov.document_uploads du
   where du.storage_path = p_storage_path
     and du.uploaded_by = v_account.id
     and du.organization_id = v_account.organization_id
     and du.confirmed_at is null
   limit 1;

  if v_oid is null then
    v_oid := lo_create(0);
    insert into smartgov.document_uploads
      (storage_path, organization_id, uploaded_by, original_name, mime_type, size_bytes,
       large_object_oid, written_bytes, budget_kind, budget_scope)
    values
      (p_storage_path, v_account.organization_id, v_account.id, p_original_name,
       coalesce(p_mime_type, ''), p_size_bytes, v_oid, 0, v_kind, v_scope);
    v_written := 0;
  end if;

  return jsonb_build_object(
    'ok', true,
    'storagePath', p_storage_path,
    'writtenBytes', coalesce(v_written, 0)
  );
end;
$$;

create or replace function smartgov.attach_budget_files(
  p_session_token text,
  p_budget_id uuid,
  p_kind text,
  p_paths jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_budget smartgov.budget_requests%rowtype;
  v_kind text := lower(btrim(coalesce(p_kind, '')));
  v_path text;
  v_attached integer := 0;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then return jsonb_build_object('ok', false, 'reason', 'unauthenticated'); end if;
  if v_kind not in ('justification', 'receipt') then return jsonb_build_object('ok', false, 'reason', 'invalid_request'); end if;
  if coalesce(jsonb_typeof(p_paths), '') <> 'array' or jsonb_array_length(p_paths) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  select b.* into v_budget from smartgov.budget_requests b where b.id = p_budget_id and b.organization_id = v_account.organization_id;
  if v_budget.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if smartgov.budget_is_usg(v_account)
     or not (v_budget.unit_id = any (select smartgov.lsg_unit_ids(v_account.id, v_account.organization_id))) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  for v_path in select value from jsonb_array_elements_text(p_paths)
  loop
    if not exists (
      select 1 from smartgov.document_uploads du
       where du.storage_path = v_path
         and du.organization_id = v_account.organization_id
         and du.uploaded_by = v_account.id
         and du.budget_kind = v_kind
         and du.budget_scope = v_budget.unit_id
         and du.confirmed_at is not null
         and du.large_object_oid is not null
    ) then
      return jsonb_build_object('ok', false, 'reason', 'invalid_file');
    end if;

    update smartgov.document_uploads
       set budget_request_id = v_budget.id
     where storage_path = v_path;
    v_attached := v_attached + 1;
  end loop;

  perform smartgov.budget_audit(
    v_account,
    'budget_request.file_attached',
    'budget_request',
    p_budget_id,
    jsonb_build_object('kind', v_kind, 'count', v_attached)
  );

  return jsonb_build_object('ok', true, 'attached', v_attached);
end;
$$;

create or replace function smartgov.attach_usg_expense_files(
  p_session_token text,
  p_expense_id uuid,
  p_paths jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_path text;
  v_first text;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then return jsonb_build_object('ok', false, 'reason', 'unauthenticated'); end if;
  if not smartgov.budget_is_usg(v_account) then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if coalesce(jsonb_typeof(p_paths), '') <> 'array' or jsonb_array_length(p_paths) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;
  if not exists (
    select 1 from smartgov.usg_expenses ue
     where ue.id = p_expense_id and ue.organization_id = v_account.organization_id
  ) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  for v_path in select value from jsonb_array_elements_text(p_paths)
  loop
    if not exists (
      select 1 from smartgov.document_uploads du
       where du.storage_path = v_path
         and du.organization_id = v_account.organization_id
         and du.uploaded_by = v_account.id
         and du.budget_kind = 'usg_expense'
         and du.budget_scope = v_account.organization_id
         and du.confirmed_at is not null
         and du.large_object_oid is not null
    ) then
      return jsonb_build_object('ok', false, 'reason', 'invalid_file');
    end if;
    if v_first is null then v_first := v_path; end if;
  end loop;

  update smartgov.document_uploads
     set usg_expense_id = p_expense_id
   where storage_path = any (select value from jsonb_array_elements_text(p_paths));

  update smartgov.usg_expenses
     set receipt_file = v_first
   where id = p_expense_id;

  perform smartgov.budget_audit(
    v_account,
    'usg_expense.file_attached',
    'usg_expense',
    p_expense_id,
    jsonb_build_object('storagePath', v_first)
  );

  return jsonb_build_object('ok', true, 'storagePath', v_first);
end;
$$;

create or replace function smartgov.list_budget_files(
  p_session_token text,
  p_budget_id uuid,
  p_kind text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_budget smartgov.budget_requests%rowtype;
  v_kind text := nullif(btrim(coalesce(p_kind, '')), '');
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then return jsonb_build_object('ok', false, 'reason', 'unauthenticated'); end if;

  select b.* into v_budget from smartgov.budget_requests b where b.id = p_budget_id and b.organization_id = v_account.organization_id;
  if v_budget.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if not smartgov.budget_can_read(v_account, v_budget) then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;

  return jsonb_build_object(
    'ok', true,
    'files', coalesce((
      select jsonb_agg(jsonb_build_object(
        'storagePath', du.storage_path,
        'kind', du.budget_kind,
        'originalName', du.original_name,
        'mimeType', du.mime_type,
        'sizeBytes', du.size_bytes,
        'uploadedAt', du.confirmed_at
      ) order by du.confirmed_at)
        from smartgov.document_uploads du
       where du.budget_request_id = p_budget_id
         and (v_kind is null or du.budget_kind = v_kind)
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function smartgov.get_budget_file(
  p_session_token text,
  p_storage_path text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_upload smartgov.document_uploads%rowtype;
  v_budget smartgov.budget_requests%rowtype;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then return jsonb_build_object('ok', false, 'reason', 'unauthenticated'); end if;

  select du.* into v_upload
    from smartgov.document_uploads du
   where du.storage_path = p_storage_path
     and du.organization_id = v_account.organization_id
     and du.confirmed_at is not null
     and du.large_object_oid is not null;
  if v_upload.storage_path is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;

  if v_upload.budget_request_id is not null then
    select b.* into v_budget from smartgov.budget_requests b where b.id = v_upload.budget_request_id;
    if v_budget.id is null or not smartgov.budget_can_read(v_account, v_budget) then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
  elsif v_upload.usg_expense_id is not null then
    if not smartgov.budget_is_usg(v_account) then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  elsif v_upload.uploaded_by <> v_account.id and not smartgov.budget_is_usg(v_account) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  return jsonb_build_object(
    'ok', true,
    'oid', v_upload.large_object_oid,
    'originalName', v_upload.original_name,
    'mimeType', v_upload.mime_type,
    'sizeBytes', v_upload.size_bytes
  );
end;
$$;

create or replace function smartgov.list_budget_timeline(
  p_session_token text,
  p_budget_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_budget smartgov.budget_requests%rowtype;
  v_events jsonb;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then return jsonb_build_object('ok', false, 'reason', 'unauthenticated'); end if;

  select b.* into v_budget from smartgov.budget_requests b where b.id = p_budget_id and b.organization_id = v_account.organization_id;
  if v_budget.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if not smartgov.budget_can_read(v_account, v_budget) then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;

  with events as (
    select
      b.id::text || '-submitted' as event_id,
      'submitted'::text as stage,
      null::text as status,
      'Budget request submitted for PHP ' || b.requested_total::text as note,
      coalesce((select a.display_name from smartgov.accounts a where a.id = b.requested_by), 'System') as actor_name,
      b.created_at as created_at
    from smartgov.budget_requests b
    where b.id = p_budget_id
    union all
    select
      b.id::text || '-decision',
      'decision',
      b.status,
      coalesce(nullif(btrim(coalesce(b.decision_remark, '')), ''), 'Decision recorded'),
      coalesce((select a.display_name from smartgov.accounts a where a.id = b.decided_by), 'USG office'),
      b.decided_at
    from smartgov.budget_requests b
    where b.id = p_budget_id and b.decided_at is not null
    union all
    select
      be.id::text,
      'expense',
      null,
      'Spending recorded: PHP ' || be.amount::text || ' - ' || be.description,
      coalesce((select a.display_name from smartgov.accounts a where a.id = be.recorded_by), 'System'),
      be.recorded_at
    from smartgov.budget_expenses be
    where be.request_id = p_budget_id
    union all
    select
      du.storage_path,
      'attachment',
      null,
      'File attached: ' || du.original_name,
      coalesce((select a.display_name from smartgov.accounts a where a.id = du.uploaded_by), 'System'),
      du.confirmed_at
    from smartgov.document_uploads du
    where du.budget_request_id = p_budget_id and du.confirmed_at is not null
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', e.event_id,
    'stage', e.stage,
    'status', e.status,
    'note', e.note,
    'actorName', e.actor_name,
    'createdAt', e.created_at
  ) order by e.created_at), '[]'::jsonb) into v_events from events e;

  return jsonb_build_object('ok', true, 'events', v_events);
end;
$$;

create or replace function public.claim_budget_upload(
  p_session_token text, p_storage_path text, p_original_name text, p_mime_type text, p_size_bytes bigint
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.claim_budget_upload($1, $2, $3, $4, $5); $$;

create or replace function public.attach_budget_files(
  p_session_token text, p_budget_id uuid, p_kind text, p_paths jsonb
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.attach_budget_files($1, $2, $3, $4); $$;

create or replace function public.attach_usg_expense_files(
  p_session_token text, p_expense_id uuid, p_paths jsonb
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.attach_usg_expense_files($1, $2, $3); $$;

create or replace function public.list_budget_files(
  p_session_token text, p_budget_id uuid, p_kind text
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.list_budget_files($1, $2, $3); $$;

create or replace function public.get_budget_file(p_session_token text, p_storage_path text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.get_budget_file($1, $2); $$;

create or replace function public.list_budget_timeline(p_session_token text, p_budget_id uuid)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.list_budget_timeline($1, $2); $$;

revoke all on function public.claim_budget_upload(text, text, text, text, bigint) from public;
revoke all on function public.attach_budget_files(text, uuid, text, jsonb) from public;
revoke all on function public.attach_usg_expense_files(text, uuid, jsonb) from public;
revoke all on function public.list_budget_files(text, uuid, text) from public;
revoke all on function public.get_budget_file(text, text) from public;
revoke all on function public.list_budget_timeline(text, uuid) from public;

grant execute on function public.claim_budget_upload(text, text, text, text, bigint) to anon, authenticated, service_role;
grant execute on function public.attach_budget_files(text, uuid, text, jsonb) to anon, authenticated, service_role;
grant execute on function public.attach_usg_expense_files(text, uuid, jsonb) to anon, authenticated, service_role;
grant execute on function public.list_budget_files(text, uuid, text) to anon, authenticated, service_role;
grant execute on function public.get_budget_file(text, text) to anon, authenticated, service_role;
grant execute on function public.list_budget_timeline(text, uuid) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
