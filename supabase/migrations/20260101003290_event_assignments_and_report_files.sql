-- 03290 -- Event assignees and directly-uploaded accomplishment files.
--
-- Two additions to the accomplishment tab:
--
--   1. The USG can name who may file an accomplishment report for an event.
--      `event_assignees` is a per-event list of accounts. Once an event has at
--      least one assignee, only those accounts (and the USG office itself) may
--      file for it. Events with no assignees keep the old rule so nothing that
--      already shipped stops working.
--
--   2. A report can carry uploaded files, not just a link to a catalog
--      document. The bytes use the same large-object pipeline as every other
--      document (`claim -> chunk -> commit`), with their own path shape:
--
--          <org>/accomplishments/<eventId>/<nonce>/<originalName>
--
--      The staged upload is ownerless until the report is filed, then the
--      `document_uploads.accomplishment_report` owner column is stamped and a
--      metadata row is written to `accomplishment_report_files`.
--
-- Nothing here uses RLS policies or table grants: every reachable surface is a
-- `security definer` function that derives the caller from the session token and
-- is exposed through an explicit `public.*` forwarder.

-- ---------------------------------------------------------- event assignees

create table if not exists smartgov.event_assignees (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references smartgov.events (id) on delete cascade,
  account_id      uuid not null references smartgov.accounts (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  assigned_by     uuid references smartgov.accounts (id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (event_id, account_id)
);

create index if not exists event_assignees_account_idx
  on smartgov.event_assignees (account_id, organization_id);
create index if not exists event_assignees_event_idx
  on smartgov.event_assignees (event_id);

alter table smartgov.event_assignees enable row level security;
revoke all on smartgov.event_assignees from public, anon, authenticated;

create or replace function smartgov.is_event_assignee(p_account uuid, p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
  select exists (
    select 1 from smartgov.event_assignees a
     where a.event_id = p_event_id
       and a.account_id = p_account
  );
$$;
revoke all on function smartgov.is_event_assignee(uuid, uuid) from public;

-- Whether this account may file an accomplishment report for this event.
--
-- The USG office always may. Everyone else needs an assignment. An event that
-- has nobody assigned keeps the pre-03290 behaviour (its own LSG creator/unit),
-- so existing data does not become unfillable overnight.
create or replace function smartgov.can_file_accomplishment(
  p_account smartgov.accounts,
  p_event_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
  select exists (
    select 1
      from smartgov.events e
     where e.id = p_event_id
       and e.organization_id = p_account.organization_id
       and e.cancelled_at is null
       and (
         smartgov.is_usg_side(p_account)
         or smartgov.is_event_assignee(p_account.id, e.id)
         or (
           not exists (
             select 1 from smartgov.event_assignees a where a.event_id = e.id
           )
           and e.source = 'lsg'
           and e.honor_status <> 'not_honored'
           and (e.created_by = p_account.id
                or e.unit_id = smartgov.my_lsg_unit(p_account))
         )
       )
  );
$$;
revoke all on function smartgov.can_file_accomplishment(smartgov.accounts, uuid) from public;

-- ---------------------------------------------------------- read / write assignees

create or replace function smartgov.list_event_assignees(
  p_session_token text,
  p_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_usg     boolean;
  v_event   smartgov.events%rowtype;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if v_account.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;

  select * into v_event
    from smartgov.events e
   where e.id = p_event_id
     and e.organization_id = v_account.organization_id;
  if v_event.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  v_usg := smartgov.is_usg_side(v_account);

  return jsonb_build_object(
    'ok', true,
    'canAssign', v_usg and v_event.cancelled_at is null,
    'assignees', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'accountId', a.account_id,
          'displayName', coalesce(nullif(acc.display_name, ''), acc.email),
          'email', acc.email
        ) order by coalesce(nullif(acc.display_name, ''), acc.email)
      )
        from smartgov.event_assignees a
        join smartgov.accounts acc on acc.id = a.account_id
       where a.event_id = v_event.id
    ), '[]'::jsonb),
    'candidates', case when v_usg then coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'accountId', acc.id,
          'displayName', coalesce(nullif(acc.display_name, ''), acc.email),
          'email', acc.email
        ) order by coalesce(nullif(acc.display_name, ''), acc.email)
      )
        from smartgov.accounts acc
       where acc.organization_id = v_account.organization_id
         and acc.status = 'active'
    ), '[]'::jsonb) else '[]'::jsonb end
  );
end;
$$;
revoke all on function smartgov.list_event_assignees(text, uuid) from public;

create or replace function smartgov.set_event_assignees(
  p_session_token text,
  p_event_id uuid,
  p_account_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account  smartgov.accounts%rowtype;
  v_event    smartgov.events%rowtype;
  v_input    uuid[] := coalesce(p_account_ids, '{}'::uuid[]);
  v_clean    uuid[] := '{}'::uuid[];
  v_id       uuid;
  v_count    int := 0;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if v_account.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;

  if not smartgov.is_usg_side(v_account) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  select * into v_event
    from smartgov.events e
   where e.id = p_event_id
     and e.organization_id = v_account.organization_id;
  if v_event.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_event.cancelled_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'event_not_available');
  end if;

  if array_length(v_input, 1) > 200 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_assignees');
  end if;

  -- Validate and de-duplicate. One bad id refuses the whole write rather than
  -- leaving a half-applied roster.
  foreach v_id in array v_input loop
    if v_id is null then
      continue;
    end if;
    if not exists (
      select 1 from smartgov.accounts a
       where a.id = v_id
         and a.organization_id = v_account.organization_id
         and a.status = 'active'
    ) then
      return jsonb_build_object('ok', false, 'reason', 'invalid_assignees');
    end if;
    if not (v_id = any(v_clean)) then
      v_clean := array_append(v_clean, v_id);
    end if;
  end loop;

  -- Notify only the accounts that are newly added.
  for v_id in
    select u from unnest(v_clean) u
     except
    select a.account_id from smartgov.event_assignees a where a.event_id = v_event.id
  loop
    insert into smartgov.notifications (account_id, organization_id, kind, title, body, link)
    values (
      v_id, v_account.organization_id, 'event_assigned',
      'You were added to an event',
      v_event.title || ' - you can now file an accomplishment report for it.',
      '/usg/events?tab=accomplishment'
    );
  end loop;

  delete from smartgov.event_assignees a
   where a.event_id = v_event.id
     and not (a.account_id = any(v_clean));

  insert into smartgov.event_assignees (event_id, account_id, organization_id, assigned_by)
  select v_event.id, u, v_account.organization_id, v_account.id
    from unnest(v_clean) u
  on conflict (event_id, account_id) do nothing;

  select count(*) into v_count
    from smartgov.event_assignees a
   where a.event_id = v_event.id;

  insert into smartgov.audit_log (organization_id, actor_id, action, target_type, target_id, detail)
  values (
    v_account.organization_id, v_account.id, 'event.assignees_updated', 'event', v_event.id,
    jsonb_build_object('count', v_count)
  );

  return jsonb_build_object('ok', true, 'count', v_count);
end;
$$;
revoke all on function smartgov.set_event_assignees(text, uuid, uuid[]) from public;

-- ---------------------------------------------------------- list_events v3
-- Same contract as 03160 plus the assignment flags the accomplishment tab
-- needs. An assigned account can see the event even when its unit is outside
-- the event scope; otherwise USG could assign someone who cannot find it.

create or replace function smartgov.list_events(p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_usg     boolean;
  v_unit    uuid;
  v_type    text;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if v_account.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;

  v_usg := smartgov.is_usg_side(v_account);
  v_unit := smartgov.my_lsg_unit(v_account);
  select u.unit_type into v_type from public.governance_units u where u.id = v_unit;

  return jsonb_build_object(
    'ok', true,
    'events', coalesce((
      select jsonb_agg(row order by (row->>'eventDate') asc, (row->>'createdAt') desc)
      from (
        select jsonb_build_object(
          'id', e.id,
          'title', e.title,
          'description', e.description,
          'eventDate', e.event_date,
          'eventTime', e.event_time,
          'timezone', e.event_timezone,
          'venue', e.venue,
          'scope', e.scope,
          'unitId', e.unit_id,
          'status', e.status,
          'honorStatus', e.honor_status,
          'honorReason', e.honor_reason,
          'source', e.source,
          'supportFiles', e.support_files,
          'files', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', f.id, 'name', f.original_name, 'url', f.url,
              'mimeType', f.mime_type, 'sizeBytes', f.size_bytes
            ) order by f.created_at)
            from smartgov.event_files f where f.event_id = e.id
          ), '[]'::jsonb),
          'scopes', coalesce((
            select jsonb_agg(jsonb_build_object('unitType', s.unit_type, 'unitId', s.unit_id))
            from smartgov.event_scopes s where s.event_id = e.id
          ), '[]'::jsonb),
          'assignees', coalesce((
            select jsonb_agg(jsonb_build_object(
              'accountId', a.account_id,
              'displayName', coalesce(nullif(acc.display_name, ''), acc.email)
            ) order by coalesce(nullif(acc.display_name, ''), acc.email))
            from smartgov.event_assignees a
            join smartgov.accounts acc on acc.id = a.account_id
            where a.event_id = e.id
          ), '[]'::jsonb),
          'assigneeCount', (
            select count(*)::int from smartgov.event_assignees a where a.event_id = e.id
          ),
          'canAssign', v_usg and e.cancelled_at is null,
          'isAssignedToMe', smartgov.is_event_assignee(v_account.id, e.id),
          'canReport',
            e.cancelled_at is null
            and (
              (v_usg and e.source = 'usg'
               and e.scope in ('university', 'unit_type', 'units', 'unit'))
              or ((not v_usg) and (
                smartgov.is_event_assignee(v_account.id, e.id)
                or (
                  not exists (select 1 from smartgov.event_assignees a where a.event_id = e.id)
                  and e.source = 'lsg'
                  and e.honor_status <> 'not_honored'
                  and (e.created_by = v_account.id or e.unit_id = v_unit)
                )
              ))
            ),
          'claimNote', e.claim_note,
          'decisionNote', e.decision_note,
          'linkedRequest', e.linked_request,
          'cancelledAt', e.cancelled_at,
          'updatedAt', e.updated_at,
          'createdAt', e.created_at,
          'createdBy', e.created_by,
          'canDecide', v_usg and e.source = 'lsg' and e.honor_status = 'pending',
          'canEdit', (e.created_by = v_account.id or v_usg) and e.cancelled_at is null,
          'canClaim', (not v_usg) and e.source = 'lsg' and e.unit_id = v_unit and e.honor_status = 'not_honored'
        ) as row
        from smartgov.events e
        where e.organization_id = v_account.organization_id
          and (
            v_usg
            or smartgov.is_event_assignee(v_account.id, e.id)
            or e.source = 'lsg'
            or e.scope in ('university', 'org')
            or (e.scope = 'unit' and e.unit_id = v_unit)
            or (e.scope = 'unit_type' and exists (
                  select 1 from smartgov.event_scopes s
                   where s.event_id = e.id and lower(s.unit_type) = lower(coalesce(v_type, ''))))
            or (e.scope = 'units' and exists (
                  select 1 from smartgov.event_scopes s
                   where s.event_id = e.id and s.unit_id = v_unit))
          )
          and (
            v_usg
            or smartgov.is_event_assignee(v_account.id, e.id)
            or e.source = 'usg'
            or e.created_by = v_account.id
            or e.unit_id = v_unit
          )
      ) q
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function smartgov.list_events(text) from public;

-- ---------------------------------------------------------- report file bytes

-- A staged upload has no owner until the report exists. The owner column is
-- added to `document_uploads` and the at-most-one-owner rule is restated to
-- include it.
alter table smartgov.document_uploads
  add column if not exists accomplishment_report uuid
  references smartgov.accomplishment_reports (id) on delete cascade;

alter table smartgov.document_uploads
  drop constraint if exists document_uploads_owner_exclusive;

alter table smartgov.document_uploads
  add constraint document_uploads_owner_exclusive check (
    (case when requirement_item     is null then 0 else 1 end)
  + (case when proposal_requirement is null then 0 else 1 end)
  + (case when task_requirement     is null then 0 else 1 end)
  + (case when personal_request     is null then 0 else 1 end)
  + (case when accomplishment_report is null then 0 else 1 end)
  <= 1
  );

create index if not exists document_uploads_accomplishment_idx
  on smartgov.document_uploads (accomplishment_report)
  where accomplishment_report is not null;

create table if not exists smartgov.accomplishment_report_files (
  id              uuid primary key default gen_random_uuid(),
  report_id       uuid not null references smartgov.accomplishment_reports (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  storage_path    text not null unique
    references smartgov.document_uploads (storage_path) on delete cascade,
  original_name   text not null check (length(original_name) between 1 and 128),
  mime_type       text not null default 'application/octet-stream',
  size_bytes      bigint not null check (size_bytes between 1 and 10485760),
  uploaded_by     uuid references smartgov.accounts (id) on delete set null,
  created_at      timestamptz not null default now()
);

create index if not exists accomplishment_report_files_report_idx
  on smartgov.accomplishment_report_files (report_id, created_at);

alter table smartgov.accomplishment_report_files enable row level security;
revoke all on smartgov.accomplishment_report_files from public, anon, authenticated;

-- Reserve a path for a report attachment. Mirrors the other claim functions:
-- the path is rebuilt from its parsed parts and compared character for
-- character, the organization comes from the prefix, and the caller must be
-- allowed to file for the event.
create or replace function smartgov.claim_accomplishment_upload(
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
  v_org     uuid;
  v_event   uuid;
  v_nonce   uuid;
  v_oid     bigint;
  v_written bigint;
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

  -- The three uuid segments are checked before casting: a caller that reaches
  -- this function directly must not be able to turn a malformed path into a
  -- cast error.
  if p_storage_path !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/accomplishments/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  v_org := split_part(p_storage_path, '/', 1)::uuid;
  if v_org <> v_account.organization_id then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  v_event := split_part(p_storage_path, '/', 3)::uuid;
  v_nonce := split_part(p_storage_path, '/', 4)::uuid;

  if p_storage_path <> v_account.organization_id::text || '/accomplishments/'
                       || v_event::text || '/' || v_nonce::text || '/' || p_original_name then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  if not exists (
    select 1 from smartgov.events e
     where e.id = v_event
       and e.organization_id = v_account.organization_id
  ) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if not smartgov.can_file_accomplishment(v_account, v_event) then
    return jsonb_build_object('ok', false, 'reason', 'not_assigned');
  end if;

  -- Resume an in-flight reservation for this exact path instead of making a
  -- second one.
  select d.large_object_oid into v_oid
    from smartgov.document_uploads d
   where d.storage_path = p_storage_path
     and d.confirmed_at is null
     and d.organization_id = v_account.organization_id
   limit 1;

  if v_oid is null then
    v_oid := lo_create(0);
    insert into smartgov.document_uploads (
      storage_path, organization_id, uploaded_by, original_name,
      mime_type, size_bytes, large_object_oid, written_bytes
    ) values (
      p_storage_path, v_account.organization_id, v_account.id, p_original_name,
      coalesce(nullif(btrim(p_mime_type), ''), 'application/octet-stream'),
      p_size_bytes, v_oid, 0
    );
    return jsonb_build_object('ok', true, 'storagePath', p_storage_path, 'writtenBytes', 0);
  end if;

  select d.written_bytes into v_written
    from smartgov.document_uploads d
   where d.storage_path = p_storage_path
   limit 1;

  return jsonb_build_object(
    'ok', true,
    'storagePath', p_storage_path,
    'writtenBytes', coalesce(v_written, 0),
    'resumed', true
  );
end;
$$;
revoke all on function smartgov.claim_accomplishment_upload(text, text, text, text, bigint) from public;

-- ---------------------------------------------------------- submit v2
-- The 03250 submission plus two things: the assignment gate, and an optional
-- array of uploaded paths to attach. The five-argument entry point stays and
-- delegates, so an older client keeps working.

create or replace function smartgov.submit_accomplishment_report_v2(
  p_session_token text,
  p_event_id uuid,
  p_narrative text,
  p_highlights text default '',
  p_attachment_submission_id uuid default null,
  p_file_paths text[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account   smartgov.accounts%rowtype;
  v_event     smartgov.events%rowtype;
  v_usg       boolean;
  v_unit      uuid;
  v_root_unit uuid;
  v_side      text;
  v_reporting_unit uuid;
  v_narrative text := btrim(coalesce(p_narrative, ''));
  v_highlights text := btrim(coalesce(p_highlights, ''));
  v_doc       jsonb;
  v_existing_id uuid;
  v_existing_status text;
  v_existing_side text;
  v_id        uuid;
  v_paths     text[] := '{}'::text[];
  v_path      text;
  v_docrow    smartgov.document_uploads%rowtype;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if v_account.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;
  if length(v_narrative) < 10 or length(v_narrative) > 12000 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_narrative');
  end if;
  if length(v_highlights) > 2000 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_highlights');
  end if;

  select e.* into v_event
    from smartgov.events e
   where e.id = p_event_id
     and e.organization_id = v_account.organization_id;
  if v_event.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_event.cancelled_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'event_not_available');
  end if;

  v_usg := smartgov.is_usg_side(v_account);
  v_unit := smartgov.my_lsg_unit(v_account);

  if v_usg then
    if v_event.source <> 'usg'
       or v_event.scope not in ('university', 'unit_type', 'units', 'unit') then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
    v_side := 'usg';
    select gu.id into v_root_unit
      from public.governance_units gu
     where gu.organization_id = v_account.organization_id
       and gu.unit_type = 'usg'
     order by gu.created_at asc nulls last
     limit 1;
    v_reporting_unit := v_root_unit;
  else
    if not smartgov.can_file_accomplishment(v_account, p_event_id) then
      -- When the USG has named filers, the refusal is about the assignment;
      -- otherwise the event simply is not this unit's to report on.
      if exists (select 1 from smartgov.event_assignees a where a.event_id = p_event_id) then
        return jsonb_build_object('ok', false, 'reason', 'not_assigned');
      end if;
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
    v_side := 'lsg';
    v_reporting_unit := coalesce(v_unit, v_event.unit_id);
  end if;

  if p_attachment_submission_id is not null then
    v_doc := smartgov.get_document(p_session_token, p_attachment_submission_id);
    if coalesce((v_doc ->> 'ok')::boolean, false) is not true then
      return jsonb_build_object('ok', false, 'reason', 'attachment_not_allowed');
    end if;
  end if;

  -- Validate every uploaded path before touching any existing rows, so a bad
  -- path cannot wipe the files already attached to a returned report.
  if p_file_paths is not null and array_length(p_file_paths, 1) is not null then
    if array_length(p_file_paths, 1) > 10 then
      return jsonb_build_object('ok', false, 'reason', 'invalid_request');
    end if;

    foreach v_path in array p_file_paths loop
      v_path := btrim(coalesce(v_path, ''));
      if v_path = '' or v_path = any(v_paths) then
        return jsonb_build_object('ok', false, 'reason', 'invalid_request');
      end if;

      select d.* into v_docrow
        from smartgov.document_uploads d
       where d.storage_path = v_path
         and d.organization_id = v_account.organization_id
         and d.uploaded_by = v_account.id
         and d.large_object_oid is not null
         and d.confirmed_at is not null
         and d.written_bytes = d.size_bytes
         and d.requirement_item is null
         and d.proposal_requirement is null
         and d.task_requirement is null
         and d.personal_request is null
         and d.accomplishment_report is null
       limit 1;

      if v_docrow.storage_path is null then
        return jsonb_build_object('ok', false, 'reason', 'missing_document');
      end if;

      v_paths := array_append(v_paths, v_path);
    end loop;
  end if;

  select r.id, r.status, r.reporting_side
    into v_existing_id, v_existing_status, v_existing_side
  from smartgov.accomplishment_reports r
  where r.event_id = p_event_id
    and r.reporting_unit_id is not distinct from v_reporting_unit
  limit 1;

  if v_existing_id is not null then
    if v_existing_status = 'returned' and v_existing_side = v_side then
      update smartgov.accomplishment_reports
         set narrative = v_narrative,
             highlights = v_highlights,
             attachment_submission_id = p_attachment_submission_id,
             status = 'submitted',
             decision_remark = null,
             reviewed_by = null,
             reviewed_at = null,
             updated_at = now()
       where id = v_existing_id;
      v_id := v_existing_id;

      -- A non-empty new set replaces the old one; an empty set keeps it.
      -- Dropping the document row cascades the metadata row and unlinks the
      -- large object, so a replaced file does not leave its bytes behind.
      if array_length(v_paths, 1) is not null then
        delete from smartgov.document_uploads d
         where d.accomplishment_report = v_id
           and not (d.storage_path = any(v_paths));
      end if;
    else
      return jsonb_build_object('ok', false, 'reason', 'duplicate_report');
    end if;
  else
    insert into smartgov.accomplishment_reports
      (organization_id, event_id, reporting_unit_id, reporting_side, created_by,
       narrative, highlights, attachment_submission_id)
    values
      (v_account.organization_id, p_event_id, v_reporting_unit, v_side, v_account.id,
       v_narrative, v_highlights, p_attachment_submission_id)
    returning id into v_id;
  end if;

  if array_length(v_paths, 1) is not null then
    foreach v_path in array v_paths loop
      insert into smartgov.accomplishment_report_files (
        report_id, organization_id, storage_path,
        original_name, mime_type, size_bytes, uploaded_by
      )
      select v_id, d.organization_id, d.storage_path,
             d.original_name, d.mime_type, d.size_bytes, d.uploaded_by
        from smartgov.document_uploads d
       where d.storage_path = v_path
      on conflict (storage_path) do nothing;

      update smartgov.document_uploads d
         set accomplishment_report = v_id
       where d.storage_path = v_path;
    end loop;
  end if;

  return jsonb_build_object('ok', true, 'id', v_id, 'updated', v_existing_id is not null);
end;
$$;
revoke all on function smartgov.submit_accomplishment_report_v2(text, uuid, text, text, uuid, text[]) from public;

-- The old five-argument entry point keeps its contract.
create or replace function smartgov.submit_accomplishment_report(
  p_session_token text,
  p_event_id uuid,
  p_narrative text,
  p_highlights text default '',
  p_attachment_submission_id uuid default null
)
returns jsonb
language sql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
  select smartgov.submit_accomplishment_report_v2(
    p_session_token, p_event_id, p_narrative, p_highlights,
    p_attachment_submission_id, '{}'::text[]
  );
$$;
revoke all on function smartgov.submit_accomplishment_report(text, uuid, text, text, uuid) from public;

-- ---------------------------------------------------------- report reads, with files

create or replace function smartgov.list_accomplishment_reports(
  p_session_token text,
  p_event_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_usg     boolean;
  v_unit    uuid;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if v_account.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;

  v_usg := smartgov.is_usg_side(v_account);
  v_unit := smartgov.my_lsg_unit(v_account);

  return jsonb_build_object(
    'ok', true,
    'canReview', v_usg,
    'rows', coalesce((
      select jsonb_agg(row order by row ->> 'submittedAt' desc)
      from (
        select jsonb_build_object(
          'id', r.id,
          'eventId', r.event_id,
          'eventTitle', e.title,
          'unitName', coalesce(u.name, 'Organization-wide'),
          'status', r.status,
          'submittedAt', r.created_at,
          'canReview', v_usg and r.reporting_side = 'lsg',
          'files', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', f.id, 'name', f.original_name,
              'mimeType', f.mime_type, 'sizeBytes', f.size_bytes
            ) order by f.created_at)
            from smartgov.accomplishment_report_files f
            where f.report_id = r.id
          ), '[]'::jsonb)
        ) as row
        from smartgov.accomplishment_reports r
        join smartgov.events e on e.id = r.event_id
        left join public.governance_units u on u.id = r.reporting_unit_id
        where r.organization_id = v_account.organization_id
          and (
            v_usg
            or (r.reporting_side = 'lsg' and r.reporting_unit_id = v_unit)
            or r.created_by = v_account.id
            or smartgov.is_event_assignee(v_account.id, r.event_id)
          )
          and (p_event_id is null or r.event_id = p_event_id)
      ) s
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function smartgov.list_accomplishment_reports(text, uuid) from public;

create or replace function smartgov.get_accomplishment_report(
  p_session_token text,
  p_report_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_usg     boolean;
  v_unit    uuid;
  v_row     smartgov.accomplishment_reports%rowtype;
  v_event_title text;
  v_unit_name text;
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
  v_unit := smartgov.my_lsg_unit(v_account);

  select r.* into v_row
    from smartgov.accomplishment_reports r
   where r.id = p_report_id
     and r.organization_id = v_account.organization_id;
  if v_row.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  v_visible := v_usg
            or (v_row.reporting_side = 'lsg' and v_row.reporting_unit_id = v_unit)
            or v_row.created_by = v_account.id
            or smartgov.is_event_assignee(v_account.id, v_row.event_id);
  if not v_visible then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  select e.title into v_event_title
    from smartgov.events e
   where e.id = v_row.event_id;
  select u.name into v_unit_name
    from public.governance_units u
   where u.id = v_row.reporting_unit_id;

  return jsonb_build_object(
    'ok', true,
    'canReview', v_usg and v_row.reporting_side = 'lsg',
    'item', jsonb_build_object(
      'id', v_row.id,
      'eventId', v_row.event_id,
      'eventTitle', v_event_title,
      'reportingUnitId', v_row.reporting_unit_id,
      'unitName', coalesce(v_unit_name, 'Organization-wide'),
      'status', v_row.status,
      'submittedAt', v_row.created_at,
      'narrative', v_row.narrative,
      'highlights', v_row.highlights,
      'attachmentSubmissionId', v_row.attachment_submission_id,
      'decisionRemark', v_row.decision_remark,
      'reviewedAt', v_row.reviewed_at,
      'files', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', f.id, 'name', f.original_name,
          'mimeType', f.mime_type, 'sizeBytes', f.size_bytes
        ) order by f.created_at)
        from smartgov.accomplishment_report_files f
        where f.report_id = v_row.id
      ), '[]'::jsonb),
      'timeline', coalesce((
        select jsonb_agg(jsonb_build_object(
          'decision', rr.decision,
          'remark', rr.remark,
          'reviewerName', a.display_name,
          'createdAt', rr.created_at
        ) order by rr.created_at asc)
        from smartgov.accomplishment_report_reviews rr
        left join smartgov.accounts a on a.id = rr.reviewer_id
        where rr.report_id = v_row.id
      ), '[]'::jsonb)
    )
  );
end;
$$;
revoke all on function smartgov.get_accomplishment_report(text, uuid) from public;

-- The download gate for one report attachment. Same visibility rule as the
-- report itself; returns the large-object id rather than a URL because the
-- route streams the bytes.
create or replace function smartgov.get_accomplishment_file(
  p_session_token text,
  p_file_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_usg     boolean;
  v_unit    uuid;
  v_row     record;
  v_visible boolean;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if v_account.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;

  select f.id, f.original_name, f.mime_type, f.size_bytes,
         r.organization_id, r.reporting_side, r.reporting_unit_id,
         r.created_by, r.event_id, d.large_object_oid
    into v_row
    from smartgov.accomplishment_report_files f
    join smartgov.accomplishment_reports r on r.id = f.report_id
    join smartgov.document_uploads d on d.storage_path = f.storage_path
   where f.id = p_file_id
     and r.organization_id = v_account.organization_id;

  if v_row.id is null or v_row.large_object_oid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  v_usg := smartgov.is_usg_side(v_account);
  v_unit := smartgov.my_lsg_unit(v_account);

  v_visible := v_usg
            or v_row.created_by = v_account.id
            or (v_row.reporting_side = 'lsg' and v_row.reporting_unit_id = v_unit)
            or smartgov.is_event_assignee(v_account.id, v_row.event_id);
  if not v_visible then
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
revoke all on function smartgov.get_accomplishment_file(text, uuid) from public;

-- ---------------------------------------------------------- public forwarders

create or replace function public.list_event_assignees(p_session_token text, p_event_id uuid)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.list_event_assignees(p_session_token, p_event_id); $$;
revoke all on function public.list_event_assignees(text, uuid) from public;
grant execute on function public.list_event_assignees(text, uuid) to anon, authenticated;

create or replace function public.set_event_assignees(
  p_session_token text, p_event_id uuid, p_account_ids uuid[]
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.set_event_assignees(p_session_token, p_event_id, p_account_ids); $$;
revoke all on function public.set_event_assignees(text, uuid, uuid[]) from public;
grant execute on function public.set_event_assignees(text, uuid, uuid[]) to anon, authenticated;

create or replace function public.claim_accomplishment_upload(
  p_session_token text, p_storage_path text, p_original_name text,
  p_mime_type text, p_size_bytes bigint
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.claim_accomplishment_upload(
  p_session_token, p_storage_path, p_original_name, p_mime_type, p_size_bytes
); $$;
revoke all on function public.claim_accomplishment_upload(text, text, text, text, bigint) from public;
grant execute on function public.claim_accomplishment_upload(text, text, text, text, bigint) to anon, authenticated;

create or replace function public.submit_accomplishment_report_v2(
  p_session_token text,
  p_event_id uuid,
  p_narrative text,
  p_highlights text default '',
  p_attachment_submission_id uuid default null,
  p_file_paths text[] default '{}'
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.submit_accomplishment_report_v2(
  p_session_token, p_event_id, p_narrative, p_highlights,
  p_attachment_submission_id, p_file_paths
); $$;
revoke all on function public.submit_accomplishment_report_v2(text, uuid, text, text, uuid, text[]) from public;
grant execute on function public.submit_accomplishment_report_v2(text, uuid, text, text, uuid, text[]) to anon, authenticated;

create or replace function public.get_accomplishment_file(p_session_token text, p_file_id uuid)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.get_accomplishment_file(p_session_token, p_file_id); $$;
revoke all on function public.get_accomplishment_file(text, uuid) from public;
grant execute on function public.get_accomplishment_file(text, uuid) to anon, authenticated;

-- These two changed body but not signature; re-grant so the allowlist is explicit.
create or replace function public.list_accomplishment_reports(
  p_session_token text,
  p_event_id uuid default null
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.list_accomplishment_reports(p_session_token, p_event_id); $$;
revoke all on function public.list_accomplishment_reports(text, uuid) from public;
grant execute on function public.list_accomplishment_reports(text, uuid) to anon, authenticated;

create or replace function public.get_accomplishment_report(
  p_session_token text,
  p_report_id uuid
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.get_accomplishment_report(p_session_token, p_report_id); $$;
revoke all on function public.get_accomplishment_report(text, uuid) from public;
grant execute on function public.get_accomplishment_report(text, uuid) to anon, authenticated;
