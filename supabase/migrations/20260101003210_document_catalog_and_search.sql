-- 03210 -- Document catalog and search.
--
-- Every filed requirement is already a row in `item_submissions`, with the
-- bytes in `document_uploads` and the download gate in `get_document`. What the
-- federation lacked was a way to describe a document (title, description,
-- keywords, group) and to publish an approved catalog across the organisation.
--
-- The rules from the rest of the codebase are kept exactly:
--   * No RLS policy and no table grant. Every path in is a `security definer`
--     function that resolves the caller from the session token first, and the
--     only reachable surface is the explicit `public.*` allowlist at the bottom.
--   * Identity, role, unit and organisation are derived inside SQL from the
--     session. A caller can never name another organisation's row.
--   * Search returns metadata only. Bytes still travel through the existing
--     `/api/files/[submissionId]` gate, which this migration widens just enough
--     for an approved catalog row to be downloadable by any signed-in viewer.

-- ---------------------------------------------------------------------------
-- 1. Catalog metadata
-- ---------------------------------------------------------------------------
create table if not exists smartgov.document_catalog (
  submission_id   uuid primary key
    references smartgov.item_submissions (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  title           text not null check (length(btrim(title)) between 2 and 160),
  description     text not null default '' check (length(description) <= 2000),
  keywords        text not null default '' check (length(keywords) <= 500),
  group_kind      text not null default 'requirement'
    check (group_kind in ('requirement', 'resolution', 'event')),
  group_id        uuid,
  group_label     text check (group_label is null or length(btrim(group_label)) between 1 and 160),
  approval_status text not null default 'pending'
    check (approval_status in ('pending', 'approved', 'rejected')),
  approval_remark text,
  approved_by     uuid references smartgov.accounts (id) on delete set null,
  approved_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  search_vector   tsvector generated always as (
    to_tsvector('english'::regconfig,
      coalesce(title, '') || ' ' || coalesce(description, '') || ' ' ||
      coalesce(keywords, '') || ' ' || coalesce(group_label, ''))
  ) stored
);

create index if not exists document_catalog_org_status_idx
  on smartgov.document_catalog (organization_id, approval_status);
create index if not exists document_catalog_group_idx
  on smartgov.document_catalog (organization_id, group_kind, group_id);
create index if not exists document_catalog_search_idx
  on smartgov.document_catalog using gin (search_vector);

alter table smartgov.document_catalog enable row level security;
revoke all on smartgov.document_catalog from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. get_document -- unchanged scope, plus approved catalog rows
-- ---------------------------------------------------------------------------
-- The original gate answers "is this your own unit's / proposal's file?".
-- A catalog row the USG has approved is deliberately org-wide, so any signed-in
-- account in the organisation may download it. Nothing else changes: the
-- submission and its confirmed bytes must still both exist.
create or replace function smartgov.get_document(p_session_token text, p_submission_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_row     record;
  v_scope   boolean := false;
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  select isub.storage_path, isub.original_name, isub.mime_type, isub.size_bytes,
         d.large_object_oid, p.created_by, p.unit_id
    into v_row
    from smartgov.item_submissions isub
    join smartgov.proposal_versions pv on pv.id = isub.version_id
    join smartgov.proposals p on p.id = pv.proposal_id
    join smartgov.document_uploads d on d.storage_path = isub.storage_path
   where isub.id = p_submission_id
     and p.organization_id = v_account.organization_id;

  if v_row.storage_path is null or v_row.large_object_oid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  v_scope := v_account.account_scope = 'owner'
          or smartgov.is_org_reviewer(v_account.id, v_account.organization_id)
          or v_row.created_by = v_account.id
          or (v_row.unit_id is not null and v_row.unit_id in (
                select u from smartgov.lsg_unit_ids(v_account.id, v_account.organization_id) u
              ))
          or exists (
                select 1
                  from smartgov.document_catalog c
                 where c.submission_id = p_submission_id
                   and c.organization_id = v_account.organization_id
                   and c.approval_status = 'approved'
              );

  if not v_scope then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  return jsonb_build_object(
    'ok', true,
    'oid', v_row.large_object_oid,
    'originalName', v_row.original_name,
    'mimeType', v_row.mime_type,
    'sizeBytes', v_row.size_bytes
  );
end;
$$;

revoke all on function smartgov.get_document(text, uuid) from public;

-- ---------------------------------------------------------------------------
-- 3. search_documents
-- ---------------------------------------------------------------------------
create or replace function smartgov.search_documents(
  p_session_token text,
  p_query text default null,
  p_type text default null,
  p_status text default null,
  p_limit int default 50
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
  v_q       text := nullif(btrim(coalesce(p_query, '')), '');
  v_type    text := nullif(upper(btrim(coalesce(p_type, ''))), '');
  v_status  text := nullif(lower(btrim(coalesce(p_status, ''))), '');
  v_limit   int  := least(greatest(coalesce(p_limit, 50), 1), 100);
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if v_account.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;

  if v_status is not null and v_status not in ('pending', 'approved', 'rejected') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  v_usg := v_account.account_scope = 'owner'
        or smartgov.is_org_reviewer(v_account.id, v_account.organization_id);
  v_unit_id := smartgov.my_lsg_unit(v_account);

  return jsonb_build_object(
    'ok', true,
    'canApprove', v_usg,
    'rows', coalesce((
      select jsonb_agg(row order by row->>'submittedAt' desc)
      from (
        select jsonb_build_object(
          'submissionId', isub.id,
          'title', coalesce(nullif(btrim(c.title), ''), isub.original_name, ri.label),
          'description', coalesce(c.description, ''),
          'keywords', coalesce(c.keywords, ''),
          'groupKind', coalesce(c.group_kind, 'requirement'),
          'groupLabel', coalesce(c.group_label, ri.label),
          'type', case
                    when isub.original_name ~ '\.' then upper(regexp_replace(isub.original_name, '^.*\.', ''))
                    else 'FILE'
                  end,
          'unitName', u.name,
          'status', coalesce(c.approval_status, 'pending'),
          'submittedAt', isub.submitted_at,
          'canEdit', (
            v_usg
            or p.created_by = v_account.id
            or d.uploaded_by = v_account.id
          ),
          'approvalRemark', c.approval_remark
        ) as row
        from smartgov.item_submissions isub
        join smartgov.proposal_versions pv on pv.id = isub.version_id
        join smartgov.proposals p on p.id = pv.proposal_id
        join smartgov.requirement_items ri on ri.id = isub.requirement_item_id
        join smartgov.document_uploads d on d.storage_path = isub.storage_path
        left join smartgov.document_catalog c on c.submission_id = isub.id
        left join public.governance_units u on u.id = p.unit_id
        where p.organization_id = v_account.organization_id
          and isub.submission_kind = 'file'
          and d.large_object_oid is not null
          and (
            v_usg
            or p.created_by = v_account.id
            or d.uploaded_by = v_account.id
            or (p.unit_id is not null and p.unit_id = v_unit_id)
            or coalesce(c.approval_status, 'pending') = 'approved'
          )
          and (v_status is null or coalesce(c.approval_status, 'pending') = v_status)
          and (
            v_type is null
            or (case
                  when isub.original_name ~ '\.' then upper(regexp_replace(isub.original_name, '^.*\.', ''))
                  else 'FILE'
                end) = v_type
          )
          and (
            v_q is null
            or c.search_vector @@ plainto_tsquery('english'::regconfig, v_q)
            or to_tsvector('english'::regconfig,
                 coalesce(isub.original_name, '') || ' ' || coalesce(ri.label, '') || ' ' ||
                 coalesce(p.title, '')) @@ plainto_tsquery('english'::regconfig, v_q)
          )
        order by coalesce(c.approved_at, isub.submitted_at) desc, isub.submitted_at desc
        limit v_limit
      ) s
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function smartgov.search_documents(text, text, text, text, int) from public;

-- ---------------------------------------------------------------------------
-- 4. set_document_metadata
-- ---------------------------------------------------------------------------
create or replace function smartgov.set_document_metadata(
  p_session_token text,
  p_submission_id uuid,
  p_title text,
  p_description text,
  p_keywords text,
  p_group_kind text,
  p_group_id uuid,
  p_group_label text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account   smartgov.accounts%rowtype;
  v_usg       boolean;
  v_row       record;
  v_title     text := btrim(coalesce(p_title, ''));
  v_desc      text := btrim(coalesce(p_description, ''));
  v_keywords  text := btrim(coalesce(p_keywords, ''));
  v_kind      text := lower(btrim(coalesce(p_group_kind, 'requirement')));
  v_label     text := nullif(btrim(coalesce(p_group_label, '')), '');
  v_group_id  uuid := p_group_id;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if v_account.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;

  if length(v_title) < 2 or length(v_title) > 160 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_title');
  end if;
  if length(v_desc) > 2000 or length(v_keywords) > 500 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;
  if v_kind not in ('requirement', 'resolution', 'event') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;
  if v_label is not null and length(v_label) > 160 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  select isub.id, isub.requirement_item_id, isub.original_name,
         p.created_by, p.unit_id, ri.label as item_label, d.uploaded_by
    into v_row
    from smartgov.item_submissions isub
    join smartgov.proposal_versions pv on pv.id = isub.version_id
    join smartgov.proposals p on p.id = pv.proposal_id
    join smartgov.requirement_items ri on ri.id = isub.requirement_item_id
    join smartgov.document_uploads d on d.storage_path = isub.storage_path
   where isub.id = p_submission_id
     and isub.submission_kind = 'file'
     and p.organization_id = v_account.organization_id;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  v_usg := v_account.account_scope = 'owner'
        or smartgov.is_org_reviewer(v_account.id, v_account.organization_id);

  if not (
    v_usg
    or v_row.created_by = v_account.id
    or v_row.uploaded_by = v_account.id
  ) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if v_kind = 'requirement' then
    if v_group_id is null then
      v_group_id := v_row.requirement_item_id;
    elsif not exists (
      select 1 from smartgov.requirement_items ri
       where ri.id = v_group_id
         and ri.organization_id = v_account.organization_id
    ) then
      return jsonb_build_object('ok', false, 'reason', 'not_found');
    end if;
    if v_label is null then
      v_label := v_row.item_label;
    end if;
  elsif v_kind = 'resolution' then
    if v_group_id is not null and not exists (
      select 1 from smartgov.resolutions r
       where r.id = v_group_id
         and r.organization_id = v_account.organization_id
    ) then
      return jsonb_build_object('ok', false, 'reason', 'not_found');
    end if;
  elsif v_kind = 'event' then
    if v_group_id is not null and not exists (
      select 1 from smartgov.events e
       where e.id = v_group_id
         and e.organization_id = v_account.organization_id
    ) then
      return jsonb_build_object('ok', false, 'reason', 'not_found');
    end if;
  end if;

  insert into smartgov.document_catalog (
    submission_id, organization_id, title, description, keywords,
    group_kind, group_id, group_label
  ) values (
    p_submission_id, v_account.organization_id, v_title, v_desc, v_keywords,
    v_kind, v_group_id, v_label
  )
  on conflict (submission_id) do update
    set title = excluded.title,
        description = excluded.description,
        keywords = excluded.keywords,
        group_kind = excluded.group_kind,
        group_id = excluded.group_id,
        group_label = excluded.group_label,
        -- Any descriptive change goes back through approval; an approved title
        -- that later said something else would be a trust bug.
        approval_status = 'pending',
        approval_remark = null,
        approved_by = null,
        approved_at = null,
        updated_at = now();

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function smartgov.set_document_metadata(text, uuid, text, text, text, text, uuid, text) from public;

-- ---------------------------------------------------------------------------
-- 5. approve_document
-- ---------------------------------------------------------------------------
create or replace function smartgov.approve_document(
  p_session_token text,
  p_submission_id uuid,
  p_decision text,
  p_remark text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account  smartgov.accounts%rowtype;
  v_row      record;
  v_decision text := lower(btrim(coalesce(p_decision, '')));
  v_remark   text := nullif(btrim(coalesce(p_remark, '')), '');
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if v_account.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;

  if not (v_account.account_scope = 'owner'
          or smartgov.is_org_reviewer(v_account.id, v_account.organization_id)) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if v_decision not in ('pending', 'approved', 'rejected') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;
  if v_decision = 'rejected' and v_remark is null then
    return jsonb_build_object('ok', false, 'reason', 'remark_required');
  end if;

  select isub.id, isub.requirement_item_id, isub.original_name,
         ri.label as item_label
    into v_row
    from smartgov.item_submissions isub
    join smartgov.proposal_versions pv on pv.id = isub.version_id
    join smartgov.proposals p on p.id = pv.proposal_id
    join smartgov.requirement_items ri on ri.id = isub.requirement_item_id
    join smartgov.document_uploads d on d.storage_path = isub.storage_path
   where isub.id = p_submission_id
     and isub.submission_kind = 'file'
     and d.large_object_oid is not null
     and p.organization_id = v_account.organization_id;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  insert into smartgov.document_catalog (
    submission_id, organization_id, title, group_kind, group_id, group_label,
    approval_status, approval_remark, approved_by, approved_at
  ) values (
    p_submission_id, v_account.organization_id,
    coalesce(nullif(btrim(v_row.original_name), ''), v_row.item_label),
    'requirement', v_row.requirement_item_id, v_row.item_label,
    v_decision, v_remark,
    case when v_decision = 'approved' then v_account.id else null end,
    case when v_decision = 'approved' then now() else null end
  )
  on conflict (submission_id) do update
    set approval_status = excluded.approval_status,
        approval_remark = excluded.approval_remark,
        approved_by = excluded.approved_by,
        approved_at = excluded.approved_at,
        updated_at = now();

  return jsonb_build_object('ok', true, 'submissionId', p_submission_id, 'status', v_decision);
end;
$$;

revoke all on function smartgov.approve_document(text, uuid, text, text) from public;

-- ---------------------------------------------------------------------------
-- 6. PostgREST forwarders
-- ---------------------------------------------------------------------------
create or replace function public.search_documents(
  p_session_token text,
  p_query text default null,
  p_type text default null,
  p_status text default null,
  p_limit int default 50
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.search_documents(p_session_token, p_query, p_type, p_status, p_limit); $$;
revoke all on function public.search_documents(text, text, text, text, int) from public;
grant execute on function public.search_documents(text, text, text, text, int) to anon, authenticated;

create or replace function public.set_document_metadata(
  p_session_token text,
  p_submission_id uuid,
  p_title text,
  p_description text,
  p_keywords text,
  p_group_kind text,
  p_group_id uuid,
  p_group_label text
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.set_document_metadata(
  p_session_token, p_submission_id, p_title, p_description, p_keywords,
  p_group_kind, p_group_id, p_group_label
); $$;
revoke all on function public.set_document_metadata(text, uuid, text, text, text, text, uuid, text) from public;
grant execute on function public.set_document_metadata(text, uuid, text, text, text, text, uuid, text) to anon, authenticated;

create or replace function public.approve_document(
  p_session_token text,
  p_submission_id uuid,
  p_decision text,
  p_remark text
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.approve_document(p_session_token, p_submission_id, p_decision, p_remark); $$;
revoke all on function public.approve_document(text, uuid, text, text) from public;
grant execute on function public.approve_document(text, uuid, text, text) to anon, authenticated;
