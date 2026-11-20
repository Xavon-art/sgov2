-- 03400 -- Richer resolution filing.
--
-- A resolution now carries the particulars a formal office document needs: its
-- number, the date it was passed, a short summary, the proposed budget, and one
-- sealed attachment. The filing path stays the same security-definer shape as the
-- rest of the request module: the caller is resolved from the session, the file
-- is claimed before the row exists, and the row stamps the owner onto it.

alter table smartgov.resolutions
  add column if not exists resolution_no   text,
  add column if not exists date_passed     date,
  add column if not exists short_summary   text,
  add column if not exists proposed_budget numeric(14,2),
  add column if not exists storage_path    text,
  add column if not exists original_name   text,
  add column if not exists mime_type       text,
  add column if not exists size_bytes      bigint;

alter table smartgov.document_uploads
  add column if not exists resolution uuid
  references smartgov.resolutions (id) on delete cascade;

alter table smartgov.document_uploads
  drop constraint if exists document_uploads_owner_exclusive;

alter table smartgov.document_uploads
  add constraint document_uploads_owner_exclusive check (
    (case when requirement_item      is null then 0 else 1 end)
  + (case when proposal_requirement  is null then 0 else 1 end)
  + (case when task_requirement      is null then 0 else 1 end)
  + (case when personal_request      is null then 0 else 1 end)
  + (case when accomplishment_report is null then 0 else 1 end)
  + (case when resolution            is null then 0 else 1 end)
  <= 1
  );

create index if not exists document_uploads_resolution_idx
  on smartgov.document_uploads (resolution)
  where resolution is not null;

-- ---------------------------------------------------------------------------
-- Direct-to-USG notification.
-- ---------------------------------------------------------------------------
create or replace function smartgov.review_resolution_notice(
  p_resolution_id   uuid,
  p_organization_id uuid,
  p_actor_id        uuid,
  p_title           text
)
returns void
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
begin
  insert into smartgov.notifications
    (account_id, organization_id, kind, title, body, link)
  select a.id, p_organization_id, 'resolution_submitted',
         'Resolution for review: ' || left(p_title, 90),
         'A new resolution was filed and is waiting for the USG office.',
         '/usg/request?tab=resolutions'
    from smartgov.accounts a
   where a.organization_id = p_organization_id
     and a.id <> p_actor_id
     and smartgov.is_usg(a.id, p_organization_id);
end;
$$;

revoke all on function smartgov.review_resolution_notice(uuid, uuid, uuid, text) from public;

-- ---------------------------------------------------------------------------
-- Claim a resolution attachment before the resolution row exists.
-- ---------------------------------------------------------------------------
create or replace function smartgov.claim_resolution_upload(
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
  v_account  smartgov.accounts%rowtype;
  v_units    uuid[];
  v_org      uuid;
  v_version  int;
  v_scope_id uuid;
  v_oid      bigint;
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

  if p_storage_path !~ '^[^/]+/resolutions/v[0-9]+/[^/]+/[^/]+$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  v_org := nullif(split_part(p_storage_path, '/', 1), '')::uuid;
  if v_org is null or v_org <> v_account.organization_id then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if split_part(p_storage_path, '/', 5) <> p_original_name then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  v_version := substring(p_storage_path from '^[^/]+/resolutions/v([0-9]+)/')::int;
  v_scope_id := nullif(split_part(p_storage_path, '/', 4), '')::uuid;

  if v_version is null or v_version < 1 or v_version > 50 or v_scope_id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  select coalesce(array_agg(u), '{}'::uuid[]) into v_units
    from smartgov.lsg_unit_ids(v_account.id, v_account.organization_id) u;

  if not (
    v_scope_id = v_account.organization_id
    or v_scope_id = any (v_units)
    or (smartgov.is_usg(v_account.id, v_account.organization_id) and exists (
          select 1 from public.governance_units u
           where u.id = v_scope_id and u.organization_id = v_account.organization_id))
  ) then
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

    insert into smartgov.document_uploads
      (storage_path, organization_id, uploaded_by, resolution,
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

revoke all on function smartgov.claim_resolution_upload(text, text, text, text, bigint) from public;

-- ---------------------------------------------------------------------------
-- create_resolution_v2: leaves the original four-argument function intact for
-- older callers, and adds the fields the resolution form now collects.
-- ---------------------------------------------------------------------------
create or replace function smartgov.create_resolution_v2(
  p_session_token   text,
  p_title           text,
  p_resolution_no   text,
  p_date_passed     date,
  p_short_summary   text,
  p_body            text,
  p_proposed_budget numeric,
  p_storage_path    text,
  p_original_name   text,
  p_mime_type       text,
  p_size_bytes      bigint,
  p_unit_id         uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account    smartgov.accounts%rowtype;
  v_usg        boolean;
  v_scope      text := 'unit';
  v_unit_id    uuid;
  v_scope_id   uuid;
  v_id         uuid;
  v_title      text := btrim(coalesce(p_title, ''));
  v_number     text := btrim(coalesce(p_resolution_no, ''));
  v_summary    text := btrim(coalesce(p_short_summary, ''));
  v_body       text := btrim(coalesce(p_body, ''));
  v_path       text := nullif(btrim(coalesce(p_storage_path, '')), '');
  v_name       text := nullif(btrim(coalesce(p_original_name, '')), '');
  v_budget     numeric;
  v_upload     smartgov.document_uploads%rowtype;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if v_account.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;

  if length(v_title) < 4 or length(v_title) > 160 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_title');
  end if;
  if v_number = '' or length(v_number) > 80 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_resolution_no');
  end if;
  if p_date_passed is null or p_date_passed > current_date then
    return jsonb_build_object('ok', false, 'reason', 'invalid_date_passed');
  end if;
  if length(v_summary) < 10 or length(v_summary) > 1000 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_summary');
  end if;
  if length(v_body) < 10 or length(v_body) > 20000 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_body');
  end if;

  v_budget := coalesce(p_proposed_budget, 0);
  if v_budget < 0 or v_budget > 1000000000000 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_budget');
  end if;

  if (v_path is null) <> (v_name is null) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  v_usg := smartgov.is_usg_side(v_account);

  if v_usg then
    if p_unit_id is not null then
      if not exists (
        select 1 from public.governance_units u
         where u.id = p_unit_id and u.organization_id = v_account.organization_id
      ) then
        return jsonb_build_object('ok', false, 'reason', 'not_found');
      end if;
      v_scope := 'unit';
      v_unit_id := p_unit_id;
    else
      v_scope := 'org';
      v_unit_id := null;
    end if;
  else
    v_unit_id := smartgov.my_lsg_unit(v_account);
    if v_unit_id is null then
      return jsonb_build_object('ok', false, 'reason', 'no_unit');
    end if;
    v_scope := 'unit';
  end if;

  v_scope_id := coalesce(v_unit_id, v_account.organization_id);

  if v_path is not null then
    if p_size_bytes is null or p_size_bytes < 1 or p_size_bytes > 10485760 then
      return jsonb_build_object('ok', false, 'reason', 'invalid_request');
    end if;

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
    if v_upload.resolution is not null then
      return jsonb_build_object('ok', false, 'reason', 'already_uploaded');
    end if;
    if v_upload.original_name <> v_name or v_upload.uploaded_by <> v_account.id then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
    if nullif(split_part(v_path, '/', 4), '')::uuid <> v_scope_id then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
  end if;

  insert into smartgov.resolutions
    (organization_id, unit_id, created_by, title, resolution_no, date_passed,
     short_summary, body, proposed_budget, scope, storage_path, original_name,
     mime_type, size_bytes)
  values
    (v_account.organization_id, v_unit_id, v_account.id, v_title, v_number,
     p_date_passed, v_summary, v_body, v_budget, v_scope, v_path, v_name,
     nullif(btrim(coalesce(p_mime_type, '')), ''), p_size_bytes)
  returning id into v_id;

  if v_path is not null then
    update smartgov.document_uploads
       set resolution = v_id
     where storage_path = v_path
       and organization_id = v_account.organization_id;
  end if;

  perform smartgov.review_resolution_notice(
    v_id, v_account.organization_id, v_account.id, v_title);

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

revoke all on function smartgov.create_resolution_v2(text, text, text, date, text, text, numeric, text, text, text, bigint, uuid) from public;

-- ---------------------------------------------------------------------------
-- Read paths now expose the extra fields and the attachment flag.
-- ---------------------------------------------------------------------------
create or replace function smartgov.list_resolutions(p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_usg     boolean;
  v_unit_id uuid;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if v_account.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;

  v_usg := smartgov.is_usg_side(v_account);
  v_unit_id := smartgov.my_lsg_unit(v_account);

  return jsonb_build_object(
    'ok', true,
    'canReview', v_usg,
    'rows', coalesce((
      select jsonb_agg(row order by row->>'createdAt' desc)
      from (
        select jsonb_build_object(
          'id', r.id,
          'title', r.title,
          'resolutionNo', r.resolution_no,
          'datePassed', r.date_passed,
          'shortSummary', r.short_summary,
          'proposedBudget', r.proposed_budget,
          'status', r.status,
          'scope', r.scope,
          'unitId', r.unit_id,
          'unitName', u.name,
          'hasAttachment', r.storage_path is not null,
          'createdAt', r.created_at,
          'decidedAt', r.decided_at,
          'decisionRemark', r.decision_remark
        ) as row
        from smartgov.resolutions r
        left join public.governance_units u on u.id = r.unit_id
        where r.organization_id = v_account.organization_id
          and (
            v_usg
            or r.unit_id = v_unit_id
            or (r.scope = 'org' and r.status in ('approved', 'published'))
          )
      ) s
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function smartgov.list_resolutions(text) from public;

create or replace function smartgov.get_resolution(
  p_session_token text,
  p_resolution_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_usg     boolean;
  v_unit_id uuid;
  v_row     smartgov.resolutions%rowtype;
  v_name    text;
  v_visible boolean;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if v_account.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;

  v_usg := smartgov.is_usg_side(v_account);
  v_unit_id := smartgov.my_lsg_unit(v_account);

  select r.* into v_row
    from smartgov.resolutions r
   where r.id = p_resolution_id
     and r.organization_id = v_account.organization_id;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  v_visible := v_usg
    or v_row.unit_id = v_unit_id
    or (v_row.scope = 'org' and v_row.status in ('approved', 'published'));

  if not v_visible then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  select u.name into v_name
    from public.governance_units u
   where u.id = v_row.unit_id;

  return jsonb_build_object(
    'ok', true,
    'canReview', v_usg,
    'item', jsonb_build_object(
      'id', v_row.id,
      'title', v_row.title,
      'resolutionNo', v_row.resolution_no,
      'datePassed', v_row.date_passed,
      'shortSummary', v_row.short_summary,
      'body', v_row.body,
      'proposedBudget', v_row.proposed_budget,
      'status', v_row.status,
      'scope', v_row.scope,
      'unitId', v_row.unit_id,
      'unitName', v_name,
      'storagePath', v_row.storage_path,
      'originalName', v_row.original_name,
      'mimeType', v_row.mime_type,
      'sizeBytes', v_row.size_bytes,
      'createdAt', v_row.created_at,
      'decidedAt', v_row.decided_at,
      'decisionRemark', v_row.decision_remark,
      'timeline', coalesce((
        select jsonb_agg(jsonb_build_object(
          'decision', rr.decision,
          'remark', rr.remark,
          'reviewerName', a.display_name,
          'createdAt', rr.created_at
        ) order by rr.created_at asc)
        from smartgov.resolution_reviews rr
        left join smartgov.accounts a on a.id = rr.reviewer_id
        where rr.resolution_id = v_row.id
      ), '[]'::jsonb)
    )
  );
end;
$$;

revoke all on function smartgov.get_resolution(text, uuid) from public;

-- ---------------------------------------------------------------------------
-- Attachment download metadata.
-- ---------------------------------------------------------------------------
create or replace function smartgov.get_resolution_file(
  p_session_token text,
  p_resolution_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_usg     boolean;
  v_unit_id uuid;
  v_row     smartgov.resolutions%rowtype;
  v_upload  smartgov.document_uploads%rowtype;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  select r.* into v_row
    from smartgov.resolutions r
   where r.id = p_resolution_id
     and r.organization_id = v_account.organization_id;

  if not found or v_row.storage_path is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  v_usg := smartgov.is_usg_side(v_account);
  v_unit_id := smartgov.my_lsg_unit(v_account);

  if not (
    v_usg
    or v_row.unit_id = v_unit_id
    or (v_row.scope = 'org' and v_row.status in ('approved', 'published'))
  ) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  select du.* into v_upload
    from smartgov.document_uploads du
   where du.storage_path = v_row.storage_path
     and du.resolution = v_row.id
     and du.confirmed_at is not null;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
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

revoke all on function smartgov.get_resolution_file(text, uuid) from public;

-- ---------------------------------------------------------------------------
-- PostgREST forwarders.
-- ---------------------------------------------------------------------------
create or replace function public.create_resolution_v2(
  p_session_token text,
  p_title text,
  p_resolution_no text,
  p_date_passed date,
  p_short_summary text,
  p_body text,
  p_proposed_budget numeric,
  p_storage_path text,
  p_original_name text,
  p_mime_type text,
  p_size_bytes bigint,
  p_unit_id uuid
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.create_resolution_v2(
  p_session_token, p_title, p_resolution_no, p_date_passed, p_short_summary,
  p_body, p_proposed_budget, p_storage_path, p_original_name, p_mime_type,
  p_size_bytes, p_unit_id); $$;
revoke all on function public.create_resolution_v2(text, text, text, date, text, text, numeric, text, text, text, bigint, uuid) from public;
grant execute on function public.create_resolution_v2(text, text, text, date, text, text, numeric, text, text, text, bigint, uuid) to anon, authenticated;

create or replace function public.claim_resolution_upload(p_session_token text, p_storage_path text, p_original_name text, p_mime_type text, p_size_bytes bigint)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.claim_resolution_upload(p_session_token, p_storage_path, p_original_name, p_mime_type, p_size_bytes); $$;
revoke all on function public.claim_resolution_upload(text, text, text, text, bigint) from public;
grant execute on function public.claim_resolution_upload(text, text, text, text, bigint) to anon, authenticated;

create or replace function public.get_resolution_file(p_session_token text, p_resolution_id uuid)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.get_resolution_file(p_session_token, p_resolution_id); $$;
revoke all on function public.get_resolution_file(text, uuid) from public;
grant execute on function public.get_resolution_file(text, uuid) to anon, authenticated;
