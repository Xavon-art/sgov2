

alter table smartgov.document_uploads
  add column if not exists personal_request     uuid references smartgov.personal_requests (id) on delete cascade,
  add column if not exists task_requirement     uuid references smartgov.task_requirements (id) on delete cascade,
  add column if not exists resolution           uuid references smartgov.resolutions (id) on delete cascade,
  add column if not exists accomplishment_report uuid references smartgov.accomplishment_reports (id) on delete cascade;

alter table smartgov.personal_requests
  add column if not exists unit_id         uuid references public.governance_units (id) on delete cascade,
  add column if not exists subject         text,
  add column if not exists title           text,
  add column if not exists needed_on       date,
  add column if not exists needed_time     time,
  add column if not exists needed_timezone text,
  add column if not exists link_url        text not null default '',
  add column if not exists storage_path    text,
  add column if not exists original_name   text,
  add column if not exists mime_type       text,
  add column if not exists size_bytes      bigint,
  add column if not exists decision_note   text not null default '';

alter table smartgov.resolutions
  add column if not exists resolution_no text,
  add column if not exists date_passed  date,
  add column if not exists short_summary text,
  add column if not exists storage_path text,
  add column if not exists original_name text,
  add column if not exists mime_type    text,
  add column if not exists size_bytes   bigint;

alter table smartgov.task_assignments
  add column if not exists response_path  text,
  add column if not exists response_name  text,
  add column if not exists response_mime  text,
  add column if not exists response_bytes bigint,
  add column if not exists responded_by   uuid references smartgov.accounts (id) on delete set null,
  add column if not exists responded_at   timestamptz;

create table if not exists smartgov.event_files (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references smartgov.events (id) on delete cascade,
  storage_path  text,
  url           text,
  original_name text not null,
  mime_type     text,
  size_bytes    bigint,
  uploaded_by   uuid references smartgov.accounts (id) on delete set null,
  created_at    timestamptz not null default now()
);

create table if not exists smartgov.event_scopes (
  id        uuid primary key default gen_random_uuid(),
  event_id  uuid not null references smartgov.events (id) on delete cascade,
  unit_type text,
  unit_id   uuid references public.governance_units (id) on delete cascade
);

create table if not exists smartgov.accomplishment_report_files (
  id            uuid primary key default gen_random_uuid(),
  report_id     uuid not null references smartgov.accomplishment_reports (id) on delete cascade,
  organization_id uuid not null,
  storage_path  text not null unique,
  original_name text not null,
  mime_type     text not null default 'application/octet-stream',
  size_bytes    bigint not null,
  uploaded_by   uuid references smartgov.accounts (id) on delete set null,
  created_at    timestamptz not null default now()
);

create table if not exists smartgov.filed_document_catalog (
  document_key   text primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  source_kind    text not null,
  source_id      text not null,
  source_status  text,
  group_kind     text not null,
  group_id       uuid,
  group_label    text not null default '',
  origin_unit_id uuid references public.governance_units (id) on delete set null,
  title          text not null,
  description    text not null default '',
  keywords       text not null default '',
  type           text not null default 'FILE',
  status         text not null default 'pending',
  submitted_at   timestamptz not null default now(),
  storage_oid    bigint,
  mime_type      text not null default 'application/octet-stream',
  original_name  text not null default 'document',
  size_bytes     bigint,
  download_url   text,
  external_url   text,
  created_by     uuid references smartgov.accounts (id) on delete set null,
  uploaded_by    uuid references smartgov.accounts (id) on delete set null,
  visible_to_org boolean not null default false,
  search_vector  tsvector,
  unique (source_kind, source_id)
);

create index if not exists filed_document_catalog_org_idx
  on smartgov.filed_document_catalog (organization_id, submitted_at desc);
create index if not exists filed_document_catalog_group_idx
  on smartgov.filed_document_catalog (organization_id, group_kind, group_id);
create index if not exists filed_document_catalog_unit_idx
  on smartgov.filed_document_catalog (organization_id, origin_unit_id);
create index if not exists filed_document_catalog_search_idx
  on smartgov.filed_document_catalog using gin (search_vector);

alter table smartgov.filed_document_catalog enable row level security;
revoke all on smartgov.filed_document_catalog from public, anon, authenticated;

alter table smartgov.event_files enable row level security;
alter table smartgov.event_scopes enable row level security;
alter table smartgov.accomplishment_report_files enable row level security;
revoke all on smartgov.event_files from public, anon, authenticated;
revoke all on smartgov.event_scopes from public, anon, authenticated;
revoke all on smartgov.accomplishment_report_files from public, anon, authenticated;

create or replace function smartgov.catalog_status(p_status text)
returns text
language sql
immutable
as $$
  select case
    when lower(coalesce(p_status, '')) in
      ('approved', 'published', 'granted', 'honored', 'done', 'acknowledged', 'claimed')
      then 'approved'
    when lower(coalesce(p_status, '')) in
      ('rejected', 'returned', 'declined', 'withdrawn', 'expired', 'not_honored', 'cancelled', 'flagged')
      then 'rejected'
    else 'pending'
  end;
$$;
revoke all on function smartgov.catalog_status(text) from public;

create or replace function smartgov.refresh_filed_document_catalog()
returns void
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
begin
  delete from smartgov.filed_document_catalog where true;

  insert into smartgov.filed_document_catalog (
    document_key, organization_id, source_kind, source_id, source_status,
    group_kind, group_id, group_label, origin_unit_id,
    title, description, keywords, type, status, submitted_at,
    storage_oid, mime_type, original_name, size_bytes,
    download_url, external_url, created_by, uploaded_by, visible_to_org,
    search_vector
  )
  select
    md5(s.source_kind || ':' || s.source_id),
    s.organization_id,
    s.source_kind,
    s.source_id,
    s.source_status,
    s.group_kind,
    s.group_id,
    coalesce(nullif(btrim(s.group_label), ''), 'Filed document'),
    s.origin_unit_id,
    s.title,
    coalesce(s.description, ''),
    coalesce(s.keywords, ''),
    coalesce(nullif(btrim(s.type), ''), 'FILE'),
    smartgov.catalog_status(s.source_status),
    coalesce(s.submitted_at, now()),
    s.storage_oid,
    coalesce(nullif(btrim(s.mime_type), ''), 'application/octet-stream'),
    coalesce(nullif(btrim(s.original_name), ''), s.title, 'document'),
    s.size_bytes,
    case when s.storage_oid is not null
         then '/api/catalog-files/' || md5(s.source_kind || ':' || s.source_id)
         else null end,
    nullif(btrim(coalesce(s.external_url, '')), ''),
    s.created_by,
    s.uploaded_by,
    coalesce(s.visible_to_org, false),
    setweight(to_tsvector('english'::regconfig, coalesce(s.title, '')), 'A') ||
    setweight(to_tsvector('english'::regconfig, coalesce(s.group_label, '')), 'B') ||
    setweight(to_tsvector('english'::regconfig,
      coalesce(s.description, '') || ' ' || coalesce(s.keywords, '') || ' ' ||
      coalesce(s.original_name, '')), 'C')
  from (
    select
      p.organization_id,
      'requirement_submission'::text as source_kind,
      isub.id::text as source_id,
      coalesce(c.approval_status, 'pending') as source_status,
      coalesce(c.group_kind, 'requirement') as group_kind,
      coalesce(c.group_id, ri.id) as group_id,
      coalesce(c.group_label, ri.label) as group_label,
      p.unit_id as origin_unit_id,
      coalesce(nullif(btrim(c.title), ''), isub.original_name, ri.label) as title,
      coalesce(c.description, '') as description,
      coalesce(c.keywords, '') as keywords,
      case when isub.original_name ~ '\.' then upper(regexp_replace(isub.original_name, '^.*\.', '')) else 'FILE' end as type,
      isub.submitted_at,
      d.large_object_oid as storage_oid,
      isub.mime_type,
      isub.original_name,
      isub.size_bytes,
      null::text as external_url,
      p.created_by,
      d.uploaded_by,
      coalesce(c.approval_status, 'pending') = 'approved' as visible_to_org
    from smartgov.item_submissions isub
    join smartgov.proposal_versions pv on pv.id = isub.version_id
    join smartgov.proposals p on p.id = pv.proposal_id
    join smartgov.requirement_items ri on ri.id = isub.requirement_item_id
    join smartgov.document_uploads d on d.storage_path = isub.storage_path
    left join smartgov.document_catalog c on c.submission_id = isub.id
    where isub.submission_kind = 'file'
      and d.large_object_oid is not null

    union all

    select
      r.organization_id,
      'resolution'::text,
      r.id::text,
      r.status,
      'resolution'::text,
      r.id,
      coalesce(nullif(btrim(r.resolution_no), ''), 'Resolution'),
      r.unit_id,
      r.title,
      coalesce(nullif(btrim(r.short_summary), ''), left(coalesce(r.body, ''), 500)),
      'resolution ' || coalesce(r.resolution_no, '') || ' ' || coalesce(r.title, ''),
      'RESOLUTION',
      r.created_at,
      du.large_object_oid,
      coalesce(r.mime_type, 'application/pdf'),
      coalesce(r.original_name, r.title || '.pdf'),
      coalesce(r.size_bytes, 0),
      null::text,
      r.created_by,
      r.created_by,
      (r.scope = 'org' and r.status in ('approved', 'published'))
    from smartgov.resolutions r
    left join smartgov.document_uploads du
      on du.storage_path = r.storage_path
     and du.resolution = r.id
     and du.confirmed_at is not null

    union all

    select
      pr.organization_id,
      'personal_request'::text,
      pr.id::text,
      pr.status,
      'request'::text,
      pr.id,
      coalesce(nullif(btrim(coalesce(pr.subject, pr.title, '')), ''), 'Personal request'),
      pr.unit_id,
      coalesce(nullif(btrim(coalesce(pr.subject, pr.title, '')), ''), 'Personal request'),
      coalesce(pr.purpose, '') || ' ' || coalesce(pr.cover_letter, ''),
      'personal request ' || coalesce(pr.subject, pr.title, '') || ' ' || coalesce(pr.purpose, ''),
      'REQUEST',
      pr.created_at,
      du.large_object_oid,
      pr.mime_type,
      pr.original_name,
      pr.size_bytes,
      nullif(btrim(coalesce(pr.link_url, '')), ''),
      pr.created_by,
      pr.created_by,
      false
    from smartgov.personal_requests pr
    left join smartgov.document_uploads du
      on du.storage_path = pr.storage_path
     and du.personal_request = pr.id
     and du.confirmed_at is not null

    union all

    select
      e.organization_id,
      'event'::text,
      e.id::text,
      e.status,
      'event'::text,
      e.id,
      e.title,
      e.unit_id,
      e.title,
      coalesce(e.description, ''),
      'event ' || coalesce(e.title, '') || ' ' || coalesce(e.description, ''),
      'EVENT',
      e.created_at,
      null::bigint,
      null::text,
      null::text,
      null::bigint,
      null::text,
      e.created_by,
      e.created_by,
      (e.source = 'lsg' or e.scope in ('university', 'org'))
    from smartgov.events e

    union all

    select
      e.organization_id,
      'event_file'::text,
      ef.id::text,
      e.status,
      'event'::text,
      e.id,
      e.title,
      e.unit_id,
      coalesce(ef.original_name, e.title),
      coalesce(e.description, '') || ' ' || coalesce(e.title, ''),
      'event ' || coalesce(e.title, '') || ' ' || coalesce(ef.original_name, ''),
      case when ef.original_name ~ '\.' then upper(regexp_replace(ef.original_name, '^.*\.', '')) else 'FILE' end,
      ef.created_at,
      du.large_object_oid,
      ef.mime_type,
      ef.original_name,
      ef.size_bytes,
      nullif(btrim(coalesce(ef.url, '')), ''),
      e.created_by,
      ef.uploaded_by,
      (e.source = 'lsg' or e.scope in ('university', 'org'))
    from smartgov.event_files ef
    join smartgov.events e on e.id = ef.event_id
    left join smartgov.document_uploads du
      on du.storage_path = ef.storage_path
     and du.confirmed_at is not null

    union all

    select
      r.organization_id,
      'accomplishment_file'::text,
      f.id::text,
      r.status,
      'event'::text,
      e.id,
      e.title || ' — accomplishment report',
      coalesce(r.reporting_unit_id, e.unit_id),
      f.original_name,
      coalesce(nullif(btrim(r.highlights), ''), left(coalesce(r.narrative, ''), 500)),
      'accomplishment report ' || coalesce(e.title, '') || ' ' || coalesce(r.highlights, ''),
      case when f.original_name ~ '\.' then upper(regexp_replace(f.original_name, '^.*\.', '')) else 'FILE' end,
      f.created_at,
      du.large_object_oid,
      f.mime_type,
      f.original_name,
      f.size_bytes,
      null::text,
      r.created_by,
      f.uploaded_by,
      (r.reporting_side = 'usg')
    from smartgov.accomplishment_report_files f
    join smartgov.accomplishment_reports r on r.id = f.report_id
    join smartgov.events e on e.id = r.event_id
    left join smartgov.document_uploads du
      on du.storage_path = f.storage_path
     and du.confirmed_at is not null

    union all

    select
      t.organization_id,
      'task_requirement_file'::text,
      s.requirement_id::text || ':' || s.unit_id::text,
      s.review_status,
      'requirement'::text,
      rq.id,
      t.title || ' — ' || rq.label,
      s.unit_id,
      coalesce(nullif(btrim(coalesce(s.original_name, '')), ''), t.title || ' — ' || rq.label),
      coalesce(rq.instructions, '') || ' ' || coalesce(s.review_note, ''),
      'task requirement ' || coalesce(rq.label, '') || ' ' || coalesce(t.title, ''),
      case when coalesce(s.original_name, '') ~ '\.' then upper(regexp_replace(s.original_name, '^.*\.', '')) else 'FILE' end,
      coalesce(s.responded_at, s.reviewed_at, now()),
      du.large_object_oid,
      s.mime_type,
      s.original_name,
      s.size_bytes,
      nullif(btrim(coalesce(s.link_url, '')), ''),
      t.created_by,
      s.responded_by,
      false
    from smartgov.task_requirement_submissions s
    join smartgov.task_requirements rq on rq.id = s.requirement_id
    join smartgov.tasks t on t.id = rq.task_id
    left join smartgov.document_uploads du
      on du.storage_path = s.storage_path
     and du.confirmed_at is not null
    where s.storage_path is not null or nullif(btrim(coalesce(s.link_url, '')), '') is not null

    union all

    select
      t.organization_id,
      'task_assignment_response'::text,
      ta.task_id::text || ':' || ta.unit_id::text,
      ta.status,
      'task'::text,
      t.id,
      t.title || ' — assignment response',
      ta.unit_id,
      coalesce(nullif(btrim(coalesce(ta.response_name, '')), ''), t.title || ' — response'),
      coalesce(t.details, '') || ' ' || coalesce(ta.note, ''),
      'task response ' || coalesce(t.title, '') || ' ' || coalesce(ta.note, ''),
      case when coalesce(ta.response_name, '') ~ '\.' then upper(regexp_replace(ta.response_name, '^.*\.', '')) else 'FILE' end,
      coalesce(ta.responded_at, ta.updated_at),
      du.large_object_oid,
      ta.response_mime,
      ta.response_name,
      ta.response_bytes,
      null::text,
      t.created_by,
      ta.responded_by,
      false
    from smartgov.task_assignments ta
    join smartgov.tasks t on t.id = ta.task_id
    left join smartgov.document_uploads du
      on du.storage_path = ta.response_path
     and du.confirmed_at is not null
    where ta.response_path is not null
  ) s;
end;
$$;

revoke all on function smartgov.refresh_filed_document_catalog() from public;

create or replace function smartgov.get_personal_request_file(
  p_session_token text,
  p_request_id    uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_usg     boolean;
  v_units   uuid[];
  v_row     record;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  select pr.id, pr.organization_id, pr.unit_id, pr.created_by,
         pr.storage_path, pr.original_name, pr.mime_type, pr.size_bytes,
         du.large_object_oid
    into v_row
    from smartgov.personal_requests pr
    left join smartgov.document_uploads du
      on du.storage_path = pr.storage_path
     and du.personal_request = pr.id
     and du.confirmed_at is not null
   where pr.id = p_request_id
     and pr.organization_id = v_account.organization_id;

  if v_row.id is null or v_row.storage_path is null or v_row.large_object_oid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  v_usg := smartgov.is_usg_side(v_account);
  select coalesce(array_agg(u), '{}'::uuid[]) into v_units
    from smartgov.lsg_unit_ids(v_account.id, v_account.organization_id) u;

  if not (v_usg
          or v_row.created_by = v_account.id
          or (v_row.unit_id is not null and v_row.unit_id = any (v_units))) then
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

revoke all on function smartgov.get_personal_request_file(text, uuid) from public;

create or replace function smartgov.get_catalog_document(
  p_session_token text,
  p_document_key  text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account   smartgov.accounts%rowtype;
  v_usg       boolean;
  v_units     uuid[];
  v_unit_id   uuid;
  v_unit_type text;
  v_row       smartgov.filed_document_catalog%rowtype;
  v_gate      jsonb;
  v_oid       bigint;
  v_name      text;
  v_mime      text;
  v_size      bigint;
  v_req_id    uuid;
  v_req_unit  uuid;
  v_visible   boolean;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if v_account.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;

  perform smartgov.refresh_filed_document_catalog();

  select * into v_row
    from smartgov.filed_document_catalog
   where document_key = p_document_key
     and organization_id = v_account.organization_id;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if v_row.external_url is not null and v_row.external_url <> '' then
    return jsonb_build_object(
      'ok', true,
      'title', v_row.title,
      'downloadUrl', null,
      'externalUrl', v_row.external_url,
      'sourceKind', v_row.source_kind,
      'sourceId', v_row.source_id
    );
  end if;

  if v_row.storage_oid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  v_usg := smartgov.is_usg_side(v_account);
  v_unit_id := smartgov.my_lsg_unit(v_account);
  select gu.unit_type into v_unit_type
    from public.governance_units gu
   where gu.id = v_unit_id;
  select coalesce(array_agg(u), '{}'::uuid[]) into v_units
    from smartgov.lsg_unit_ids(v_account.id, v_account.organization_id) u;

  v_visible := v_usg
            or v_row.created_by = v_account.id
            or v_row.uploaded_by = v_account.id
            or (v_row.origin_unit_id is not null and v_row.origin_unit_id = any (v_units))
            or v_row.visible_to_org
            or (v_row.group_kind = 'event' and exists (
                 select 1 from smartgov.event_scopes es
                  where es.event_id = v_row.group_id
                    and lower(coalesce(es.unit_type, '')) = lower(coalesce(v_unit_type, ''))
               ))
            or (v_row.source_kind = 'accomplishment_file' and smartgov.is_event_assignee(v_account.id, v_row.group_id));

  if not v_visible then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  v_oid  := v_row.storage_oid;
  v_name := v_row.original_name;
  v_mime := v_row.mime_type;
  v_size := v_row.size_bytes;

  case v_row.source_kind
    when 'requirement_submission' then
      v_gate := smartgov.get_document(p_session_token, v_row.source_id::uuid);
      v_oid := coalesce((v_gate ->> 'oid')::bigint, v_oid);
      v_name := coalesce(v_gate ->> 'originalName', v_name);
      v_mime := coalesce(v_gate ->> 'mimeType', v_mime);
      v_size := coalesce((v_gate ->> 'sizeBytes')::bigint, v_size);
    when 'resolution' then
      v_gate := smartgov.get_resolution_file(p_session_token, v_row.source_id::uuid);
      v_oid := coalesce((v_gate ->> 'oid')::bigint, v_oid);
      v_name := coalesce(v_gate ->> 'originalName', v_name);
      v_mime := coalesce(v_gate ->> 'mimeType', v_mime);
      v_size := coalesce((v_gate ->> 'sizeBytes')::bigint, v_size);
    when 'personal_request' then
      v_gate := smartgov.get_personal_request_file(p_session_token, v_row.source_id::uuid);
      v_oid := coalesce((v_gate ->> 'oid')::bigint, v_oid);
      v_name := coalesce(v_gate ->> 'originalName', v_name);
      v_mime := coalesce(v_gate ->> 'mimeType', v_mime);
      v_size := coalesce((v_gate ->> 'sizeBytes')::bigint, v_size);
    when 'accomplishment_file' then
      v_gate := smartgov.get_accomplishment_file(p_session_token, v_row.source_id::uuid);
      v_oid := coalesce((v_gate ->> 'oid')::bigint, v_oid);
      v_name := coalesce(v_gate ->> 'originalName', v_name);
      v_mime := coalesce(v_gate ->> 'mimeType', v_mime);
      v_size := coalesce((v_gate ->> 'sizeBytes')::bigint, v_size);
    when 'task_requirement_file' then
      if v_row.source_id ~ '^[0-9a-fA-F-]{36}:[0-9a-fA-F-]{36}$' then
        v_req_id := split_part(v_row.source_id, ':', 1)::uuid;
        v_req_unit := split_part(v_row.source_id, ':', 2)::uuid;
        v_gate := smartgov.get_task_requirement_file(p_session_token, v_req_id, v_req_unit);
        v_oid := coalesce((v_gate ->> 'largeObjectOid')::bigint, v_oid);
        v_name := coalesce(v_gate ->> 'originalName', v_name);
        v_mime := coalesce(v_gate ->> 'mimeType', v_mime);
        v_size := coalesce((v_gate ->> 'sizeBytes')::bigint, v_size);
      end if;
    when 'task_assignment_response' then
      if v_row.source_id ~ '^[0-9a-fA-F-]{36}:[0-9a-fA-F-]{36}$' then
        v_req_id := split_part(v_row.source_id, ':', 1)::uuid;
        v_req_unit := split_part(v_row.source_id, ':', 2)::uuid;
        v_gate := smartgov.get_task_assignment_file(p_session_token, v_req_id, v_req_unit);
        v_oid := coalesce((v_gate ->> 'largeObjectOid')::bigint, v_oid);
        v_name := coalesce(v_gate ->> 'originalName', v_name);
        v_mime := coalesce(v_gate ->> 'mimeType', v_mime);
        v_size := coalesce((v_gate ->> 'sizeBytes')::bigint, v_size);
      end if;
    else
      null;
  end case;

  if v_gate is not null and coalesce((v_gate ->> 'ok')::boolean, false) is not true then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_oid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  return jsonb_build_object(
    'ok', true,
    'oid', v_oid,
    'originalName', v_name,
    'mimeType', v_mime,
    'sizeBytes', v_size,
    'title', v_row.title,
    'downloadUrl', v_row.download_url,
    'externalUrl', v_row.external_url,
    'sourceKind', v_row.source_kind,
    'sourceId', v_row.source_id
  );
end;
$$;

revoke all on function smartgov.get_catalog_document(text, text) from public;

drop function if exists public.search_documents(text, text, text, text, int);
drop function if exists smartgov.search_documents(text, text, text, text, int);

create or replace function smartgov.search_documents(
  p_session_token text,
  p_query         text default null,
  p_type          text default null,
  p_status        text default null,
  p_limit         int default 50,
  p_group_kind    text default null,
  p_group_id      uuid default null,
  p_origin_unit_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account    smartgov.accounts%rowtype;
  v_usg        boolean;
  v_units      uuid[];
  v_unit_id    uuid;
  v_unit_type  text;
  v_q          text := nullif(btrim(coalesce(p_query, '')), '');
  v_type       text := nullif(upper(btrim(coalesce(p_type, ''))), '');
  v_status     text := nullif(lower(btrim(coalesce(p_status, ''))), '');
  v_group_kind text := nullif(lower(btrim(coalesce(p_group_kind, ''))), '');
  v_limit      int  := least(greatest(coalesce(p_limit, 50), 1), 100);
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
  if v_group_kind is not null and v_group_kind not in ('requirement', 'resolution', 'event', 'request', 'task') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  perform smartgov.refresh_filed_document_catalog();

  v_usg := smartgov.is_usg_side(v_account);
  v_unit_id := smartgov.my_lsg_unit(v_account);
  select gu.unit_type into v_unit_type
    from public.governance_units gu
   where gu.id = v_unit_id;
  select coalesce(array_agg(u), '{}'::uuid[]) into v_units
    from smartgov.lsg_unit_ids(v_account.id, v_account.organization_id) u;

  return jsonb_build_object(
    'ok', true,
    'canApprove', v_usg,
    'rows', coalesce((
      select jsonb_agg(row order by row->>'submittedAt' desc)
      from (
        select jsonb_build_object(
          'documentKey', c.document_key,
          'submissionId', case
                            when c.source_kind = 'requirement_submission' then c.source_id
                            else c.document_key end,
          'sourceKind', c.source_kind,
          'sourceId', c.source_id,
          'title', c.title,
          'description', c.description,
          'keywords', c.keywords,
          'groupKind', c.group_kind,
          'groupLabel', c.group_label,
          'originUnitId', c.origin_unit_id,
          'unitName', (select gu.name from public.governance_units gu where gu.id = c.origin_unit_id),
          'type', c.type,
          'status', c.status,
          'submittedAt', c.submitted_at,
          'downloadUrl', c.download_url,
          'externalUrl', c.external_url,
          'canEdit', (
            c.source_kind = 'requirement_submission'
            and (
              v_usg
              or c.created_by = v_account.id
              or c.uploaded_by = v_account.id
            )
          ),
          'approvalRemark', (
            select dc.approval_remark
              from smartgov.document_catalog dc
             where c.source_kind = 'requirement_submission'
               and dc.submission_id = c.source_id::uuid
          )
        ) as row
        from smartgov.filed_document_catalog c
        where c.organization_id = v_account.organization_id
          and (
            v_usg
            or c.created_by = v_account.id
            or c.uploaded_by = v_account.id
            or (c.origin_unit_id is not null and c.origin_unit_id = any (v_units))
            or c.visible_to_org
            or (c.group_kind = 'event' and exists (
                 select 1 from smartgov.event_scopes es
                  where es.event_id = c.group_id
                    and lower(coalesce(es.unit_type, '')) = lower(coalesce(v_unit_type, ''))
               ))
            or (c.source_kind = 'accomplishment_file' and smartgov.is_event_assignee(v_account.id, c.group_id))
          )
          and (v_status is null or c.status = v_status)
          and (v_type is null or c.type = v_type)
          and (v_group_kind is null or c.group_kind = v_group_kind)
          and (p_group_id is null or c.group_id = p_group_id)
          and (p_origin_unit_id is null or c.origin_unit_id = p_origin_unit_id)
          and (
            v_q is null
            or c.search_vector @@ plainto_tsquery('english'::regconfig, v_q)
            or c.title ilike '%' || v_q || '%'
            or c.description ilike '%' || v_q || '%'
            or c.keywords ilike '%' || v_q || '%'
            or c.group_label ilike '%' || v_q || '%'
            or c.original_name ilike '%' || v_q || '%'
          )
        order by c.submitted_at desc
        limit v_limit
      ) s
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function smartgov.search_documents(text, text, text, text, int, text, uuid, uuid) from public;

create or replace function public.search_documents(
  p_session_token text,
  p_query text default null,
  p_type text default null,
  p_status text default null,
  p_limit int default 50,
  p_group_kind text default null,
  p_group_id uuid default null,
  p_origin_unit_id uuid default null
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.search_documents(p_session_token, p_query, p_type, p_status, p_limit, p_group_kind, p_group_id, p_origin_unit_id); $$;
revoke all on function public.search_documents(text, text, text, text, int, text, uuid, uuid) from public;
grant execute on function public.search_documents(text, text, text, text, int, text, uuid, uuid) to anon, authenticated;

create or replace function public.get_personal_request_file(p_session_token text, p_request_id uuid)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.get_personal_request_file(p_session_token, p_request_id); $$;
revoke all on function public.get_personal_request_file(text, uuid) from public;
grant execute on function public.get_personal_request_file(text, uuid) to anon, authenticated;

create or replace function public.get_catalog_document(p_session_token text, p_document_key text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.get_catalog_document(p_session_token, p_document_key); $$;
revoke all on function public.get_catalog_document(text, text) from public;
grant execute on function public.get_catalog_document(text, text) to anon, authenticated;
