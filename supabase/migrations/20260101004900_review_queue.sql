alter table smartgov.task_assignments
  add column if not exists submitted_by uuid references smartgov.accounts (id) on delete set null,
  add column if not exists review_opened_by uuid references smartgov.accounts (id) on delete set null,
  add column if not exists decision_by uuid references smartgov.accounts (id) on delete set null,
  add column if not exists decision_at timestamptz,
  add column if not exists decision_note text not null default '';

create table if not exists smartgov.review_timeline (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  task_id uuid not null references smartgov.tasks (id) on delete cascade,
  unit_id uuid not null references public.governance_units (id) on delete cascade,
  stage text not null check (stage in ('assigned', 'draft', 'submitted', 'under_review', 'decision')),
  status text,
  note text not null default '',
  actor_id uuid references smartgov.accounts (id) on delete set null,
  dedupe_key text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists review_timeline_item_idx
  on smartgov.review_timeline (task_id, unit_id, created_at);

revoke all on smartgov.review_timeline from public, anon, authenticated;

create or replace function smartgov.review_timeline_add(
  p_task_id uuid,
  p_unit_id uuid,
  p_stage text,
  p_status text,
  p_note text,
  p_actor_id uuid,
  p_dedupe_key text default null,
  p_created_at timestamptz default now()
)
returns void
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from smartgov.tasks where id = p_task_id;
  if v_org is null then return; end if;

  insert into smartgov.review_timeline
    (organization_id, task_id, unit_id, stage, status, note, actor_id, dedupe_key, created_at)
  values
    (v_org, p_task_id, p_unit_id, p_stage, p_status,
     left(coalesce(p_note, ''), 2000), p_actor_id,
     coalesce(nullif(btrim(coalesce(p_dedupe_key, '')), ''), gen_random_uuid()::text),
     coalesce(p_created_at, now()))
  on conflict (dedupe_key) do nothing;
end;
$$;

insert into smartgov.review_timeline
  (organization_id, task_id, unit_id, stage, status, note, actor_id, dedupe_key, created_at)
select t.organization_id, ta.task_id, ta.unit_id, 'assigned', 'pending', '', t.created_by,
       ta.task_id::text || ':' || ta.unit_id::text || ':assigned', ta.assigned_at
  from smartgov.task_assignments ta
  join smartgov.tasks t on t.id = ta.task_id
 where ta.assigned_at is not null
on conflict (dedupe_key) do nothing;

insert into smartgov.review_timeline
  (organization_id, task_id, unit_id, stage, status, note, actor_id, dedupe_key, created_at)
select t.organization_id, ta.task_id, ta.unit_id, 'draft', 'draft', '', ta.responded_by,
       ta.task_id::text || ':' || ta.unit_id::text || ':draft', ta.responded_at
  from smartgov.task_assignments ta
  join smartgov.tasks t on t.id = ta.task_id
 where ta.responded_at is not null
on conflict (dedupe_key) do nothing;

insert into smartgov.review_timeline
  (organization_id, task_id, unit_id, stage, status, note, actor_id, dedupe_key, created_at)
select t.organization_id, ta.task_id, ta.unit_id, 'submitted', 'under_review', '',
       coalesce(ta.submitted_by, ta.responded_by),
       ta.task_id::text || ':' || ta.unit_id::text || ':submitted', ta.submitted_at
  from smartgov.task_assignments ta
  join smartgov.tasks t on t.id = ta.task_id
 where ta.submitted_at is not null
on conflict (dedupe_key) do nothing;

insert into smartgov.review_timeline
  (organization_id, task_id, unit_id, stage, status, note, actor_id, dedupe_key, created_at)
select t.organization_id, ta.task_id, ta.unit_id, 'under_review', 'under_review', '',
       ta.review_opened_by,
       ta.task_id::text || ':' || ta.unit_id::text || ':under_review', ta.review_opened_at
  from smartgov.task_assignments ta
  join smartgov.tasks t on t.id = ta.task_id
 where ta.review_opened_at is not null
on conflict (dedupe_key) do nothing;

insert into smartgov.review_timeline
  (organization_id, task_id, unit_id, stage, status, note, actor_id, dedupe_key, created_at)
select t.organization_id, ta.task_id, ta.unit_id, 'decision', ta.status, ta.decision_note,
       coalesce(ta.decision_by, (
         select s.reviewed_by
           from smartgov.task_requirement_submissions s
           join smartgov.task_requirements rq on rq.id = s.requirement_id
          where rq.task_id = ta.task_id and s.unit_id = ta.unit_id and s.reviewed_by is not null
          limit 1
       ), t.created_by),
       ta.task_id::text || ':' || ta.unit_id::text || ':decision', coalesce(ta.decision_at, ta.updated_at)
  from smartgov.task_assignments ta
  join smartgov.tasks t on t.id = ta.task_id
 where ta.status in ('approved', 'returned', 'rejected')
on conflict (dedupe_key) do nothing;

create or replace function smartgov.open_task_review(
  p_session_token text,
  p_task_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_item record;
  v_opened integer := 0;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then return jsonb_build_object('ok', false, 'reason', 'unauthenticated'); end if;
  if not smartgov.is_usg(v_account.id, v_account.organization_id) then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if not exists (select 1 from smartgov.tasks t where t.id = p_task_id and t.organization_id = v_account.organization_id) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  for v_item in
    select ta.task_id, ta.unit_id
      from smartgov.task_assignments ta
     where ta.task_id = p_task_id
       and ta.status = 'under_review'
       and ta.review_opened_at is null
  loop
    update smartgov.task_assignments
       set review_opened_at = now(), review_opened_by = v_account.id, updated_at = now()
     where task_id = v_item.task_id
       and unit_id = v_item.unit_id
       and status = 'under_review'
       and review_opened_at is null;
    if found then
      v_opened := v_opened + 1;
      perform smartgov.review_timeline_add(
        v_item.task_id, v_item.unit_id, 'under_review', 'under_review', '', v_account.id,
        v_item.task_id::text || ':' || v_item.unit_id::text || ':under_review', now()
      );
      insert into smartgov.audit_log (organization_id, actor_id, action, target_type, target_id, detail)
      values (v_account.organization_id, v_account.id, 'task.review_opened', 'task', v_item.task_id,
              jsonb_build_object('unitId', v_item.unit_id));
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'opened', v_opened);
end;
$$;

create or replace function smartgov.open_assignment_review(
  p_session_token text,
  p_task_id uuid,
  p_unit_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_task smartgov.tasks%rowtype;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then return jsonb_build_object('ok', false, 'reason', 'unauthenticated'); end if;
  if not smartgov.is_usg(v_account.id, v_account.organization_id) then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;

  select t.* into v_task from smartgov.tasks t
   where t.id = p_task_id and t.organization_id = v_account.organization_id;
  if v_task.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if not exists (select 1 from smartgov.task_assignments ta where ta.task_id = p_task_id and ta.unit_id = p_unit_id) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  update smartgov.task_assignments
     set review_opened_at = coalesce(review_opened_at, now()),
         review_opened_by = coalesce(review_opened_by, v_account.id),
         updated_at = now()
   where task_id = p_task_id
     and unit_id = p_unit_id
     and status = 'under_review';

  if found then
    perform smartgov.review_timeline_add(
      p_task_id, p_unit_id, 'under_review', 'under_review', '', v_account.id,
      p_task_id::text || ':' || p_unit_id::text || ':under_review', now()
    );
    insert into smartgov.audit_log (organization_id, actor_id, action, target_type, target_id, detail)
    values (v_account.organization_id, v_account.id, 'task.review_opened', 'task', p_task_id,
            jsonb_build_object('unitId', p_unit_id));
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.open_assignment_review(
  p_session_token text, p_task_id uuid, p_unit_id uuid
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.open_assignment_review($1, $2, $3); $$;

revoke all on function public.open_assignment_review(text, uuid, uuid) from public;
grant execute on function public.open_assignment_review(text, uuid, uuid) to anon, authenticated, service_role;

create or replace function smartgov.submit_assignment_response(
  p_session_token text,
  p_task_id uuid,
  p_unit_id uuid,
  p_note text,
  p_storage_path text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_task smartgov.tasks%rowtype;
  v_assign smartgov.task_assignments%rowtype;
  v_units uuid[];
  v_note text := btrim(coalesce(p_note, ''));
  v_doc smartgov.document_uploads%rowtype;
  v_task_id uuid;
  v_unit_id uuid;
  v_version int;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then return jsonb_build_object('ok', false, 'reason', 'unauthenticated'); end if;
  if length(v_note) > 4000 then return jsonb_build_object('ok', false, 'reason', 'invalid_request'); end if;

  select t.* into v_task
    from smartgov.tasks t
   where t.id = p_task_id and t.organization_id = v_account.organization_id;
  if v_task.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if smartgov.task_is_locked(p_task_id) then return jsonb_build_object('ok', false, 'reason', 'task_closed'); end if;

  select coalesce(array_agg(u), '{}'::uuid[]) into v_units
    from smartgov.lsg_unit_ids(v_account.id, v_account.organization_id) u;
  if not (p_unit_id = any (v_units)) then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;

  select ta.* into v_assign
    from smartgov.task_assignments ta
   where ta.task_id = p_task_id and ta.unit_id = p_unit_id
   for update;
  if v_assign.task_id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_assign.status = 'under_review' then return jsonb_build_object('ok', false, 'reason', 'under_review'); end if;
  if v_assign.status = 'approved' then return jsonb_build_object('ok', false, 'reason', 'already_done'); end if;

  if p_storage_path is not null and btrim(p_storage_path) <> '' then
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
    if v_doc.storage_path is null then return jsonb_build_object('ok', false, 'reason', 'missing_document'); end if;

    if v_assign.response_path is not null and v_assign.response_path <> v_doc.storage_path then
      delete from smartgov.document_uploads where storage_path = v_assign.response_path;
    end if;
  end if;

  if v_note = '' and (p_storage_path is null or btrim(p_storage_path) = '') then
    return jsonb_build_object('ok', false, 'reason', 'answer_required');
  end if;

  update smartgov.task_assignments
     set status = 'draft',
         note = v_note,
         response_path = case when p_storage_path is null or btrim(p_storage_path) = '' then null else v_doc.storage_path end,
         response_name = case when p_storage_path is null or btrim(p_storage_path) = '' then null else v_doc.original_name end,
         response_mime = case when p_storage_path is null or btrim(p_storage_path) = '' then null else v_doc.mime_type end,
         response_bytes = case when p_storage_path is null or btrim(p_storage_path) = '' then null else v_doc.size_bytes end,
         responded_by = v_account.id,
         responded_at = now(),
         submitted_at = null,
         submitted_by = null,
         late = false,
         review_opened_at = null,
         review_opened_by = null,
         decision_by = null,
         decision_at = null,
         decision_note = '',
         updated_by = v_account.id,
         updated_at = now()
   where task_id = p_task_id and unit_id = p_unit_id;

  perform smartgov.review_timeline_add(
    p_task_id, p_unit_id, 'draft', 'draft', v_note, v_account.id,
    'draft:' || gen_random_uuid()::text, now()
  );

  return jsonb_build_object('ok', true, 'status', 'draft');
end;
$$;

create or replace function smartgov.submit_assignment_for_review(
  p_session_token text,
  p_task_id uuid,
  p_unit_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_task smartgov.tasks%rowtype;
  v_assign smartgov.task_assignments%rowtype;
  v_units uuid[];
  v_late boolean;
  v_due timestamptz;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then return jsonb_build_object('ok', false, 'reason', 'unauthenticated'); end if;

  select t.* into v_task
    from smartgov.tasks t
   where t.id = p_task_id and t.organization_id = v_account.organization_id;
  if v_task.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if smartgov.task_is_locked(p_task_id) then return jsonb_build_object('ok', false, 'reason', 'task_closed'); end if;

  select coalesce(array_agg(u), '{}'::uuid[]) into v_units
    from smartgov.lsg_unit_ids(v_account.id, v_account.organization_id) u;
  if not (p_unit_id = any (v_units)) then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;

  select ta.* into v_assign
    from smartgov.task_assignments ta
   where ta.task_id = p_task_id and ta.unit_id = p_unit_id
   for update;
  if v_assign.task_id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_assign.status = 'approved' then return jsonb_build_object('ok', false, 'reason', 'already_done'); end if;
  if v_assign.status = 'under_review' then return jsonb_build_object('ok', false, 'reason', 'under_review'); end if;
  if v_assign.status not in ('pending', 'draft', 'returned') then return jsonb_build_object('ok', false, 'reason', 'invalid_request'); end if;

  if exists (
    select 1
      from smartgov.task_requirements rq
     where rq.task_id = p_task_id
       and rq.required
       and not exists (
         select 1
           from smartgov.task_requirement_submissions s
          where s.requirement_id = rq.id
            and s.unit_id = p_unit_id
            and (btrim(s.link_url) <> '' or s.storage_path is not null)
       )
  ) then
    return jsonb_build_object('ok', false, 'reason', 'missing_requirements');
  end if;

  v_due := smartgov.task_due_at(p_task_id);
  v_late := v_due is not null and now() > v_due;

  update smartgov.task_assignments
     set status = 'under_review',
         submitted_at = now(),
         submitted_by = v_account.id,
         late = v_late,
         review_opened_at = null,
         review_opened_by = null,
         decision_by = null,
         decision_at = null,
         decision_note = '',
         updated_by = v_account.id,
         updated_at = now()
   where task_id = p_task_id and unit_id = p_unit_id;

  perform smartgov.review_timeline_add(
    p_task_id, p_unit_id, 'submitted', 'under_review', '', v_account.id,
    'submitted:' || gen_random_uuid()::text, now()
  );

  insert into smartgov.notifications (account_id, organization_id, kind, title, body, link)
  select a.id, v_account.organization_id, 'task_submitted', 'Task submitted for review',
         v_task.title || ' from ' || coalesce(
           (select gu.name from public.governance_units gu where gu.id = p_unit_id), 'a unit'
         ) || ' is waiting for review.',
         '/usg/request'
    from smartgov.accounts a
   where a.organization_id = v_account.organization_id
     and a.status = 'active'
     and smartgov.is_usg(a.id, a.organization_id);

  return jsonb_build_object('ok', true, 'status', 'under_review', 'late', v_late);
end;
$$;

create or replace function smartgov.review_requirement_answer(
  p_session_token text,
  p_requirement_id uuid,
  p_unit_id uuid,
  p_verdict text,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_req smartgov.task_requirements%rowtype;
  v_sub smartgov.task_requirement_submissions%rowtype;
  v_assign smartgov.task_assignments%rowtype;
  v_task smartgov.tasks%rowtype;
  v_note text;
  v_verdict text := lower(trim(coalesce(p_verdict, '')));
  v_required integer;
  v_approved integer;
  v_has_rejected boolean;
  v_has_returned boolean;
  v_item_status text := 'under_review';
  v_unit_name text;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then return jsonb_build_object('ok', false, 'reason', 'unauthenticated'); end if;
  if not smartgov.is_usg(v_account.id, v_account.organization_id) then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;

  if v_verdict = 'flagged' then v_verdict := 'rejected'; end if;
  if v_verdict not in ('approved', 'rejected', 'returned') then return jsonb_build_object('ok', false, 'reason', 'invalid_request'); end if;

  v_note := btrim(coalesce(p_note, ''));
  if v_verdict in ('returned', 'rejected') and length(v_note) < 2 then
    return jsonb_build_object('ok', false, 'reason', 'note_required');
  end if;
  if length(v_note) > 2000 then return jsonb_build_object('ok', false, 'reason', 'invalid_request'); end if;

  select rq.* into v_req
    from smartgov.task_requirements rq
    join smartgov.tasks t on t.id = rq.task_id
   where rq.id = p_requirement_id
     and t.organization_id = v_account.organization_id;
  if v_req.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;

  select s.* into v_sub
    from smartgov.task_requirement_submissions s
   where s.requirement_id = p_requirement_id and s.unit_id = p_unit_id;
  if v_sub.requirement_id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;

  select ta.* into v_assign
    from smartgov.task_assignments ta
   where ta.task_id = v_req.task_id and ta.unit_id = p_unit_id;
  if v_assign.task_id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_assign.status <> 'under_review' then return jsonb_build_object('ok', false, 'reason', 'not_under_review'); end if;

  select t.* into v_task from smartgov.tasks t where t.id = v_req.task_id;
  select gu.name into v_unit_name from public.governance_units gu where gu.id = p_unit_id;

  update smartgov.task_assignments
     set review_opened_at = coalesce(review_opened_at, now()),
         review_opened_by = coalesce(review_opened_by, v_account.id),
         updated_at = now()
   where task_id = v_req.task_id and unit_id = p_unit_id and review_opened_at is null;
  if found then
    perform smartgov.review_timeline_add(
      v_req.task_id, p_unit_id, 'under_review', 'under_review', '', v_account.id,
      v_req.task_id::text || ':' || p_unit_id::text || ':under_review', now()
    );
  end if;

  update smartgov.task_requirement_submissions
     set review_status = v_verdict,
         review_note = v_note,
         reviewed_by = v_account.id,
         reviewed_at = now()
   where requirement_id = p_requirement_id and unit_id = p_unit_id;

  insert into smartgov.task_requirement_reviews
    (requirement_id, unit_id, verdict, note, reviewer_id)
  values
    (p_requirement_id, p_unit_id, v_verdict, v_note, v_account.id);

  insert into smartgov.audit_log (organization_id, actor_id, action, target_type, target_id, detail)
  values
    (v_task.organization_id, v_account.id, 'task_requirement.reviewed', 'task_requirement', v_req.id,
     jsonb_build_object('taskId', v_req.task_id, 'unitId', p_unit_id, 'verdict', v_verdict, 'note', v_note));

  insert into smartgov.notifications (account_id, organization_id, kind, title, body, link)
  select distinct a.id, v_task.organization_id, 'task_requirement_' || v_verdict,
         'Requirement ' || v_verdict,
         v_task.title || ' / ' || v_req.label || ' was ' || v_verdict || '.' ||
         case when v_note = '' then '' else ' Remark: ' || v_note end,
         '/lsg/request'
    from smartgov.unit_memberships m
    join smartgov.roster r on r.id = m.roster_id and r.account_id is not null
    join smartgov.accounts a on a.id = r.account_id
   where m.unit_id = p_unit_id
     and (m.end_date is null or m.end_date >= current_date)
     and a.status = 'active';

  if v_assign.submitted_by is not null then
    insert into smartgov.notifications (account_id, organization_id, kind, title, body, link)
    values
      (v_assign.submitted_by, v_task.organization_id, 'task_requirement_' || v_verdict,
       'Requirement ' || v_verdict,
       v_task.title || ' / ' || v_req.label || ' was ' || v_verdict || '.' ||
       case when v_note = '' then '' else ' Remark: ' || v_note end,
       '/lsg/request')
    on conflict do nothing;
  end if;

  select count(*),
         count(*) filter (where s.review_status = 'approved'),
         coalesce(bool_or(s.review_status = 'rejected'), false),
         coalesce(bool_or(s.review_status = 'returned'), false)
    into v_required, v_approved, v_has_rejected, v_has_returned
    from smartgov.task_requirements rq
    left join smartgov.task_requirement_submissions s
      on s.requirement_id = rq.id and s.unit_id = p_unit_id
   where rq.task_id = v_req.task_id and rq.required;

  if v_required = v_approved then
    v_item_status := 'approved';
  elsif v_has_rejected then
    v_item_status := 'rejected';
  elsif v_has_returned then
    v_item_status := 'returned';
  else
    v_item_status := 'under_review';
  end if;

  if v_item_status <> 'under_review' then
    update smartgov.task_assignments
       set status = v_item_status,
           decision_by = v_account.id,
           decision_at = now(),
           decision_note = v_note,
           updated_at = now()
     where task_id = v_req.task_id
       and unit_id = p_unit_id
       and status = 'under_review';

    if found then
      perform smartgov.review_timeline_add(
        v_req.task_id, p_unit_id, 'decision', v_item_status, v_note, v_account.id,
        'decision:' || gen_random_uuid()::text, now()
      );
      insert into smartgov.audit_log (organization_id, actor_id, action, target_type, target_id, detail)
      values
        (v_task.organization_id, v_account.id, 'task.decided', 'task', v_req.task_id,
         jsonb_build_object('unitId', p_unit_id, 'status', v_item_status, 'note', v_note));
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'verdict', v_verdict,
    'itemStatus', v_item_status,
    'unitName', v_unit_name
  );
end;
$$;

create or replace function smartgov.list_review_queue(
  p_session_token text,
  p_status text,
  p_campus text,
  p_unit_id uuid,
  p_due_from date,
  p_due_to date,
  p_overdue boolean,
  p_late boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_status text := nullif(btrim(coalesce(p_status, '')), '');
  v_campus text := nullif(btrim(coalesce(p_campus, '')), '');
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then return jsonb_build_object('ok', false, 'reason', 'unauthenticated'); end if;
  if not smartgov.is_usg(v_account.id, v_account.organization_id) then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;

  return jsonb_build_object(
    'ok', true,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'taskId', t.id,
        'unitId', ta.unit_id,
        'taskTitle', t.title,
        'unitName', gu.name,
        'campusName', coalesce(parent.name, ''),
        'departmentName', case when gu.unit_type::text = 'department' then gu.name else '' end,
        'status', ta.status,
        'submittedAt', ta.submitted_at,
        'submittedBy', (select a.display_name from smartgov.accounts a where a.id = ta.submitted_by),
        'reviewOpenedAt', ta.review_opened_at,
        'reviewDueAt', smartgov.review_due_at(ta.task_id, ta.unit_id),
        'late', ta.late,
        'dueAt', smartgov.task_due_at(t.id),
        'overdue', smartgov.task_due_at(t.id) is not null
                   and smartgov.task_due_at(t.id) < now()
                   and ta.status not in ('approved', 'rejected'),
        'note', ta.note,
        'responseName', ta.response_name,
        'responseMime', ta.response_mime,
        'responseBytes', ta.response_bytes,
        'hasResponse', ta.response_path is not null,
        'requirements', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', rq.id,
            'label', rq.label,
            'instructions', rq.instructions,
            'required', rq.required,
            'linkUrl', s.link_url,
            'storagePath', s.storage_path,
            'originalName', s.original_name,
            'mimeType', s.mime_type,
            'respondedAt', s.responded_at,
            'reviewStatus', s.review_status,
            'reviewNote', s.review_note
          ) order by rq.position, rq.created_at)
            from smartgov.task_requirements rq
            left join smartgov.task_requirement_submissions s
              on s.requirement_id = rq.id and s.unit_id = ta.unit_id
           where rq.task_id = t.id
        ), '[]'::jsonb)
      ) order by ta.submitted_at asc nulls last, t.created_at asc)
        from smartgov.task_assignments ta
        join smartgov.tasks t on t.id = ta.task_id
        join public.governance_units gu on gu.id = ta.unit_id
        left join public.governance_units parent on parent.id = gu.parent_id
       where t.organization_id = v_account.organization_id
         and (v_status is null or v_status = 'all' or ta.status = v_status)
         and (p_unit_id is null or ta.unit_id = p_unit_id)
         and (v_campus is null or gu.name ilike '%' || v_campus || '%' or parent.name ilike '%' || v_campus || '%')
         and (p_due_from is null or smartgov.task_due_at(t.id)::date >= p_due_from)
         and (p_due_to is null or smartgov.task_due_at(t.id)::date <= p_due_to)
         and (p_overdue is null or ((smartgov.task_due_at(t.id) is not null and smartgov.task_due_at(t.id) < now()) = p_overdue))
         and (p_late is null or coalesce(ta.late, false) = p_late)
    ), '[]'::jsonb),
    'extensions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id,
        'taskId', e.task_id,
        'taskTitle', t.title,
        'unitId', e.unit_id,
        'unitName', gu.name,
        'campusName', coalesce(parent.name, ''),
        'requestedDueAt', e.requested_due_at,
        'reason', e.reason,
        'createdAt', e.created_at,
        'status', e.status
      ) order by e.created_at asc)
        from smartgov.task_extensions e
        join smartgov.tasks t on t.id = e.task_id
        join public.governance_units gu on gu.id = e.unit_id
        left join public.governance_units parent on parent.id = gu.parent_id
       where t.organization_id = v_account.organization_id
         and e.status = 'pending'
         and (p_unit_id is null or e.unit_id = p_unit_id)
         and (v_campus is null or gu.name ilike '%' || v_campus || '%' or parent.name ilike '%' || v_campus || '%')
         and (p_due_from is null or smartgov.task_due_at(t.id)::date >= p_due_from)
         and (p_due_to is null or smartgov.task_due_at(t.id)::date <= p_due_to)
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function smartgov.list_item_timeline(
  p_session_token text,
  p_task_id uuid,
  p_unit_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_usg boolean;
  v_units uuid[];
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then return jsonb_build_object('ok', false, 'reason', 'unauthenticated'); end if;

  v_usg := smartgov.is_usg(v_account.id, v_account.organization_id);
  select coalesce(array_agg(u), '{}'::uuid[]) into v_units
    from smartgov.lsg_unit_ids(v_account.id, v_account.organization_id) u;

  if not exists (select 1 from smartgov.tasks t where t.id = p_task_id and t.organization_id = v_account.organization_id) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if not v_usg and not (p_unit_id = any (v_units)) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  return jsonb_build_object(
    'ok', true,
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', tl.id,
        'stage', tl.stage,
        'status', tl.status,
        'note', tl.note,
        'actorName', coalesce(a.display_name, 'System'),
        'createdAt', tl.created_at
      ) order by tl.created_at asc, tl.id asc)
        from smartgov.review_timeline tl
        left join smartgov.accounts a on a.id = tl.actor_id
       where tl.task_id = p_task_id
         and tl.unit_id = p_unit_id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.list_review_queue(
  p_session_token text,
  p_status text,
  p_campus text,
  p_unit_id uuid,
  p_due_from date,
  p_due_to date,
  p_overdue boolean,
  p_late boolean
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.list_review_queue($1, $2, $3, $4, $5, $6, $7, $8); $$;

create or replace function public.list_item_timeline(
  p_session_token text, p_task_id uuid, p_unit_id uuid
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.list_item_timeline($1, $2, $3); $$;

revoke all on function public.list_review_queue(text, text, text, uuid, date, date, boolean, boolean) from public;
grant execute on function public.list_review_queue(text, text, text, uuid, date, date, boolean, boolean) to anon, authenticated, service_role;
revoke all on function public.list_item_timeline(text, uuid, uuid) from public;
grant execute on function public.list_item_timeline(text, uuid, uuid) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
