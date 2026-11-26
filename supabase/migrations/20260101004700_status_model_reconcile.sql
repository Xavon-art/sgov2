-- Reconcile the status model after 04600.
--
-- 04600 referenced a column that does not exist on task_requirement_submissions
-- and therefore rolled back. This migration is the idempotent replacement: it
-- maps the legacy rows that are safe to remap, adds the missing task review
-- fields, and re-issues the functions whose bodies still speak the old words.

alter table smartgov.task_assignments
  drop constraint if exists task_assignments_status_check;

alter table smartgov.task_assignments
  add column if not exists submitted_at     timestamptz,
  add column if not exists late             boolean not null default false,
  add column if not exists review_opened_at timestamptz;

update smartgov.task_assignments
   set status = case status
                  when 'assigned'    then 'pending'
                  when 'in_progress' then 'draft'
                  when 'submitted'   then 'under_review'
                  when 'done'        then 'approved'
                  else status
                end
 where status in ('assigned', 'in_progress', 'submitted', 'done');

alter table smartgov.task_assignments
  alter column status set default 'pending';

alter table smartgov.task_assignments
  add constraint task_assignments_status_check
  check (status in ('pending', 'draft', 'under_review', 'returned', 'approved', 'rejected', 'overdue'));

drop index if exists smartgov.task_assignments_open_idx;
create index if not exists task_assignments_open_idx
  on smartgov.task_assignments (task_id)
  where status <> 'approved';

update smartgov.task_assignments ta
   set submitted_at = coalesce(ta.submitted_at, ta.responded_at, ta.updated_at),
       late = (
         select t.due_date is not null
            and coalesce(ta.submitted_at, ta.responded_at, ta.updated_at)
                > (t.due_date + coalesce(t.due_time, '23:59:59'::time))
           from smartgov.tasks t
          where t.id = ta.task_id
       )
 where ta.status = 'under_review'
   and ta.submitted_at is null;

alter table smartgov.task_requirement_submissions
  drop constraint if exists task_requirement_submissions_review_status_check;

update smartgov.task_requirement_submissions
   set review_status = 'rejected'
 where review_status = 'flagged';

alter table smartgov.task_requirement_submissions
  add constraint task_requirement_submissions_review_status_check
  check (review_status in ('pending', 'approved', 'rejected', 'returned'));

alter table smartgov.task_requirement_reviews
  drop constraint if exists task_requirement_reviews_verdict_check;

update smartgov.task_requirement_reviews
   set verdict = 'rejected'
 where verdict = 'flagged';

alter table smartgov.task_requirement_reviews
  add constraint task_requirement_reviews_verdict_check
  check (verdict in ('approved', 'rejected', 'returned'));

alter table smartgov.personal_requests
  drop constraint if exists personal_requests_status_check;

update smartgov.personal_requests
   set status = case status
                  when 'submitted'            then 'pending'
                  when 'granted'              then 'approved'
                  when 'declined'             then 'rejected'
                  when 'needs_revision'       then 'returned'
                  when 'submission_required'  then 'returned'
                  when 'withdrawn'            then 'rejected'
                  when 'expired'              then 'rejected'
                  when 'under_review'         then 'returned'
                  else status
                end
 where status in (
   'submitted', 'granted', 'declined', 'needs_revision',
   'submission_required', 'withdrawn', 'expired', 'under_review'
 );

alter table smartgov.personal_requests
  alter column status set default 'pending';

alter table smartgov.personal_requests
  add constraint personal_requests_status_check
  check (status in ('pending', 'draft', 'under_review', 'returned', 'approved', 'rejected', 'overdue'));

alter table smartgov.resolutions
  drop constraint if exists resolutions_status_check;

update smartgov.resolutions
   set status = case status
                  when 'submitted' then 'pending'
                  when 'published' then 'approved'
                  else status
                end
 where status in ('submitted', 'published');

alter table smartgov.resolutions
  alter column status set default 'pending';

alter table smartgov.resolutions
  add constraint resolutions_status_check
  check (status in ('pending', 'draft', 'under_review', 'returned', 'approved', 'rejected', 'overdue'));

create or replace function smartgov.submit_requirement_answer(
  p_session_token  text,
  p_requirement_id uuid,
  p_unit_id        uuid,
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
  v_req     smartgov.task_requirements%rowtype;
  v_task    smartgov.tasks%rowtype;
  v_usg     boolean;
  v_units   uuid[];
  v_unit    uuid;
  v_link    text;
  v_path    text;
  v_ext     text;
  v_ok      boolean := false;
  v_t       text;
  v_status  text;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  select rq.* into v_req
    from smartgov.task_requirements rq
    join smartgov.tasks t on t.id = rq.task_id
   where rq.id = p_requirement_id
     and t.organization_id = v_account.organization_id;

  if v_req.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  select t.* into v_task from smartgov.tasks t where t.id = v_req.task_id;
  v_usg := smartgov.is_usg(v_account.id, v_account.organization_id);

  select coalesce(array_agg(u), '{}'::uuid[]) into v_units
    from smartgov.lsg_unit_ids(v_account.id, v_account.organization_id) u;

  if p_unit_id is not null then
    if not (p_unit_id = any (v_units)) then
      if not (v_usg and exists (
        select 1 from public.governance_units gu
         where gu.id = p_unit_id and gu.organization_id = v_account.organization_id
      )) then
        return jsonb_build_object('ok', false, 'reason', 'forbidden');
      end if;
    end if;
    v_unit := p_unit_id;
  elsif array_length(v_units, 1) is not null then
    v_unit := v_units[1];
  else
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  select ta.status into v_status
    from smartgov.task_assignments ta
   where ta.task_id = v_req.task_id and ta.unit_id = v_unit;

  if v_status is null then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if v_status = 'under_review' then
    return jsonb_build_object('ok', false, 'reason', 'under_review');
  end if;
  if v_status = 'approved' then
    return jsonb_build_object('ok', false, 'reason', 'already_done');
  end if;

  if v_task.closed_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'task_closed');
  end if;
  if v_task.auto_close and v_task.due_date is not null
     and (v_task.due_date + coalesce(v_task.due_time, '23:59:59'::time)) < now() then
    return jsonb_build_object('ok', false, 'reason', 'past_deadline');
  end if;

  v_link := btrim(coalesce(p_link_url, ''));
  v_path := nullif(btrim(coalesce(p_storage_path, '')), '');

  if v_link = '' and v_path is null then
    return jsonb_build_object('ok', false, 'reason', 'answer_required');
  end if;
  if v_link <> '' and v_path is not null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;
  if length(v_link) > 2000 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  if v_path is not null and jsonb_typeof(v_req.accepted_types) = 'array'
     and jsonb_array_length(v_req.accepted_types) > 0 then
    v_ext := lower(coalesce(
      nullif(regexp_replace(coalesce(p_original_name, ''), '^.*\.', ''), ''), ''));
    for v_t in select jsonb_array_elements_text(v_req.accepted_types) loop
      if lower(btrim(v_t)) = v_ext then
        v_ok := true;
      end if;
    end loop;
    if not v_ok then
      return jsonb_build_object('ok', false, 'reason', 'unaccepted_type');
    end if;
  end if;

  insert into smartgov.task_requirement_submissions
    (requirement_id, unit_id, review_status, review_note, reviewed_by, reviewed_at,
     link_url, storage_path, original_name, mime_type, size_bytes,
     responded_by, responded_at)
  values
    (p_requirement_id, v_unit, 'pending', '', null, null,
     v_link, v_path, nullif(btrim(coalesce(p_original_name, '')), ''),
     nullif(btrim(coalesce(p_mime_type, '')), ''), p_size_bytes,
     v_account.id, now())
  on conflict (requirement_id, unit_id) do update
    set review_status = 'pending',
        review_note   = '',
        reviewed_by   = null,
        reviewed_at   = null,
        link_url      = excluded.link_url,
        storage_path  = excluded.storage_path,
        original_name = excluded.original_name,
        mime_type     = excluded.mime_type,
        size_bytes    = excluded.size_bytes,
        responded_by  = excluded.responded_by,
        responded_at  = now();

  update smartgov.task_assignments
     set status = 'draft', updated_at = now()
   where task_id = v_req.task_id and unit_id = v_unit
     and status in ('pending', 'draft', 'returned');

  return jsonb_build_object('ok', true, 'unitId', v_unit, 'status', 'draft');
end;
$$;

revoke all on function smartgov.submit_requirement_answer(text, uuid, uuid, text, text, text, text, bigint) from public;

create or replace function smartgov.review_requirement_answer(
  p_session_token  text,
  p_requirement_id uuid,
  p_unit_id        uuid,
  p_verdict        text,
  p_note           text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_req     smartgov.task_requirements%rowtype;
  v_sub     smartgov.task_requirement_submissions%rowtype;
  v_note    text;
  v_verdict text := lower(trim(coalesce(p_verdict, '')));
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if not smartgov.is_usg(v_account.id, v_account.organization_id) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if v_verdict = 'flagged' then v_verdict := 'rejected'; end if;
  if v_verdict not in ('approved', 'rejected', 'returned') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  v_note := btrim(coalesce(p_note, ''));
  if v_verdict in ('returned', 'rejected') and length(v_note) < 2 then
    return jsonb_build_object('ok', false, 'reason', 'note_required');
  end if;
  if length(v_note) > 2000 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  select rq.* into v_req
    from smartgov.task_requirements rq
    join smartgov.tasks t on t.id = rq.task_id
   where rq.id = p_requirement_id
     and t.organization_id = v_account.organization_id;

  if v_req.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  select s.* into v_sub
    from smartgov.task_requirement_submissions s
   where s.requirement_id = p_requirement_id and s.unit_id = p_unit_id;

  if v_sub.requirement_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  update smartgov.task_requirement_submissions
     set review_status = v_verdict,
         review_note   = v_note,
         reviewed_by   = v_account.id,
         reviewed_at   = now()
   where requirement_id = p_requirement_id and unit_id = p_unit_id;

  insert into smartgov.task_requirement_reviews
    (requirement_id, unit_id, verdict, note, reviewer_id)
  values
    (p_requirement_id, p_unit_id, v_verdict, v_note, v_account.id);

  if v_verdict = 'returned' then
    update smartgov.task_assignments
       set status = 'returned', updated_at = now()
     where task_id = v_req.task_id and unit_id = p_unit_id
       and status <> 'approved';
  end if;

  return jsonb_build_object('ok', true, 'verdict', v_verdict);
end;
$$;

revoke all on function smartgov.review_requirement_answer(text, uuid, uuid, text, text) from public;

create or replace function smartgov.update_assignment_status(
  p_session_token text,
  p_task_id       uuid,
  p_unit_id       uuid,
  p_status        text,
  p_note          text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_units   uuid[];
  v_now     text;
  v_status  text := lower(trim(coalesce(p_status, '')));
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if v_status not in ('pending', 'draft') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  if not exists (select 1 from smartgov.tasks t
                  where t.id = p_task_id
                    and t.organization_id = v_account.organization_id) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  select coalesce(array_agg(u), '{}'::uuid[]) into v_units
    from smartgov.lsg_unit_ids(v_account.id, v_account.organization_id) u;

  if not (p_unit_id = any (v_units)) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  select ta.status into v_now
    from smartgov.task_assignments ta
   where ta.task_id = p_task_id and ta.unit_id = p_unit_id;

  if v_now is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_now = 'approved' then
    return jsonb_build_object('ok', false, 'reason', 'already_done');
  end if;
  if v_now = 'under_review' then
    return jsonb_build_object('ok', false, 'reason', 'under_review');
  end if;

  update smartgov.task_assignments
     set status = v_status,
         note = btrim(coalesce(p_note, '')),
         updated_at = now()
   where task_id = p_task_id and unit_id = p_unit_id;

  return jsonb_build_object('ok', true, 'status', v_status);
end;
$$;

revoke all on function smartgov.update_assignment_status(text, uuid, uuid, text, text) from public;

create or replace function smartgov.confirm_assignment_done(
  p_session_token text,
  p_task_id       uuid,
  p_unit_id       uuid,
  p_note          text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if not smartgov.is_usg(v_account.id, v_account.organization_id) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if not exists (select 1 from smartgov.tasks t
                  where t.id = p_task_id
                    and t.organization_id = v_account.organization_id) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  update smartgov.task_assignments
     set status = 'approved',
         note = btrim(coalesce(p_note, '')),
         updated_at = now()
   where task_id = p_task_id and unit_id = p_unit_id;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  return jsonb_build_object('ok', true, 'status', 'approved');
end;
$$;

revoke all on function smartgov.confirm_assignment_done(text, uuid, uuid, text) from public;

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

  if v_assign.status = 'under_review' then
    return jsonb_build_object('ok', false, 'reason', 'under_review');
  end if;
  if v_assign.status = 'approved' then
    return jsonb_build_object('ok', false, 'reason', 'already_done');
  end if;

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
     set status = 'draft',
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
         submitted_at = null,
         late = false,
         review_opened_at = null,
         updated_by = v_account.id,
         updated_at = now()
   where task_id = p_task_id and unit_id = p_unit_id;

  return jsonb_build_object('ok', true, 'status', 'draft');
end;
$$;

revoke all on function smartgov.submit_assignment_response(text, uuid, uuid, text, text) from public;

create or replace function smartgov.submit_assignment_for_review(
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
  v_assign  smartgov.task_assignments%rowtype;
  v_units   uuid[];
  v_late    boolean;
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
  if v_assign.status = 'approved' then
    return jsonb_build_object('ok', false, 'reason', 'already_done');
  end if;
  if v_assign.status = 'under_review' then
    return jsonb_build_object('ok', false, 'reason', 'already_submitted');
  end if;
  if v_assign.status not in ('pending', 'draft', 'returned') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

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

  v_late := v_task.due_date is not null
            and now() > (v_task.due_date + coalesce(v_task.due_time, '23:59:59'::time));

  update smartgov.task_assignments
     set status = 'under_review',
         submitted_at = now(),
         late = v_late,
         review_opened_at = null,
         updated_by = v_account.id,
         updated_at = now()
   where task_id = p_task_id and unit_id = p_unit_id;

  insert into smartgov.notifications (account_id, organization_id, kind, title, body, link)
  select a.id, v_account.organization_id, 'task_submitted', 'Task submitted for review',
         v_task.title || ' from ' || coalesce(
           (select gu.name from public.governance_units gu where gu.id = p_unit_id),
           'a unit'
         ) || ' is waiting for review.',
         '/usg/requests'
    from smartgov.accounts a
   where a.organization_id = v_account.organization_id
     and a.status = 'active'
     and smartgov.is_usg(a.id, a.organization_id);

  return jsonb_build_object('ok', true, 'status', 'under_review', 'late', v_late);
end;
$$;

revoke all on function smartgov.submit_assignment_for_review(text, uuid, uuid) from public;

create or replace function smartgov.withdraw_assignment_submission(
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
  v_assign  smartgov.task_assignments%rowtype;
  v_units   uuid[];
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  select coalesce(array_agg(u), '{}'::uuid[]) into v_units
    from smartgov.lsg_unit_ids(v_account.id, v_account.organization_id) u;

  if not (p_unit_id = any (v_units)) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  select ta.* into v_assign
    from smartgov.task_assignments ta
    join smartgov.tasks t on t.id = ta.task_id
   where ta.task_id = p_task_id
     and ta.unit_id = p_unit_id
     and t.organization_id = v_account.organization_id
   for update of ta;

  if v_assign.task_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_assign.status <> 'under_review' then
    return jsonb_build_object('ok', false, 'reason', 'not_under_review');
  end if;
  if v_assign.review_opened_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'review_started');
  end if;

  update smartgov.task_assignments
     set status = 'draft',
         submitted_at = null,
         late = false,
         review_opened_at = null,
         updated_by = v_account.id,
         updated_at = now()
   where task_id = p_task_id and unit_id = p_unit_id;

  return jsonb_build_object('ok', true, 'status', 'draft');
end;
$$;

revoke all on function smartgov.withdraw_assignment_submission(text, uuid, uuid) from public;

create or replace function smartgov.open_task_review(
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
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if not smartgov.is_usg(v_account.id, v_account.organization_id) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if not exists (
    select 1 from smartgov.tasks t
     where t.id = p_task_id and t.organization_id = v_account.organization_id
  ) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  update smartgov.task_assignments
     set review_opened_at = coalesce(review_opened_at, now())
   where task_id = p_task_id and status = 'under_review';

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function smartgov.open_task_review(text, uuid) from public;

create or replace function public.submit_assignment_for_review(
  p_session_token text, p_task_id uuid, p_unit_id uuid
) returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.submit_assignment_for_review($1, $2, $3); $$;

revoke all on function public.submit_assignment_for_review(text, uuid, uuid) from public;
grant execute on function public.submit_assignment_for_review(text, uuid, uuid) to anon, authenticated, service_role;

create or replace function public.withdraw_assignment_submission(
  p_session_token text, p_task_id uuid, p_unit_id uuid
) returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.withdraw_assignment_submission($1, $2, $3); $$;

revoke all on function public.withdraw_assignment_submission(text, uuid, uuid) from public;
grant execute on function public.withdraw_assignment_submission(text, uuid, uuid) to anon, authenticated, service_role;

create or replace function public.open_task_review(
  p_session_token text, p_task_id uuid
) returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.open_task_review($1, $2); $$;

revoke all on function public.open_task_review(text, uuid) from public;
grant execute on function public.open_task_review(text, uuid) to anon, authenticated, service_role;

create or replace function smartgov.task_detail(
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
    'task', jsonb_build_object(
      'id', v_task.id,
      'title', v_task.title,
      'details', v_task.details,
      'dueDate', v_task.due_date,
      'dueTime', v_task.due_time,
      'dueTimezone', v_task.due_timezone,
      'priority', v_task.priority,
      'autoClose', v_task.auto_close,
      'closed', v_task.closed_at is not null,
      'closedAt', v_task.closed_at,
      'closingNote', v_task.closing_note,
      'overdue', (v_task.due_date is not null
                  and (v_task.due_date + coalesce(v_task.due_time, '23:59:59'::time)) < now()
                  and v_task.closed_at is null),
      'daysLeft', case when v_task.due_date is null then null
                       else (v_task.due_date - current_date) end,
      'doneUnits', (select count(*) from smartgov.task_assignments ta
                     where ta.task_id = v_task.id and ta.status = 'approved'),
      'totalUnits', (select count(*) from smartgov.task_assignments ta where ta.task_id = v_task.id)
    ),
    'canClose', v_usg,
    'isUsg', v_usg,
    'myUnitIds', to_jsonb(v_units),
    'assignments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'unitId', ta.unit_id,
        'unitName', (select gu.name from public.governance_units gu where gu.id = ta.unit_id),
        'status', ta.status,
        'note', ta.note,
        'submittedAt', ta.submitted_at,
        'late', ta.late,
        'reviewOpenedAt', ta.review_opened_at,
        'updatedAt', ta.updated_at,
        'mine', (ta.unit_id = any (v_units))
      ) order by (select gu.name from public.governance_units gu where gu.id = ta.unit_id))
        from smartgov.task_assignments ta
       where ta.task_id = p_task_id
         and (v_usg or ta.unit_id = any (v_units))
    ), '[]'::jsonb),
    'requirements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', rq.id,
        'position', rq.position,
        'label', rq.label,
        'instructions', rq.instructions,
        'acceptedTypes', rq.accepted_types,
        'required', rq.required,
        'sampleFile', rq.sample_file,
        'myAnswer', (
          select jsonb_build_object(
            'reviewStatus', s.review_status,
            'reviewNote', s.review_note,
            'reviewedAt', s.reviewed_at,
            'linkUrl', s.link_url,
            'storagePath', s.storage_path,
            'originalName', s.original_name,
            'mimeType', s.mime_type,
            'sizeBytes', s.size_bytes,
            'respondedAt', s.responded_at
          )
            from smartgov.task_requirement_submissions s
           where s.requirement_id = rq.id and s.unit_id = any (v_units)
           limit 1
        ),
        'verdicts', case when v_usg then coalesce((
          select jsonb_agg(jsonb_build_object(
            'unitId', s.unit_id,
            'unitName', (select gu.name from public.governance_units gu where gu.id = s.unit_id),
            'reviewStatus', s.review_status,
            'reviewNote', s.review_note,
            'linkUrl', s.link_url,
            'storagePath', s.storage_path,
            'originalName', s.original_name,
            'respondedAt', s.responded_at
          ) order by (select gu.name from public.governance_units gu where gu.id = s.unit_id))
            from smartgov.task_requirement_submissions s
           where s.requirement_id = rq.id
        ), '[]'::jsonb) else '[]'::jsonb end
      ) order by rq.position, rq.created_at)
        from smartgov.task_requirements rq
       where rq.task_id = p_task_id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function smartgov.task_detail(text, uuid) from public;

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
        'submittedAt', ta.submitted_at,
        'late', ta.late,
        'reviewOpenedAt', ta.review_opened_at,
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

create or replace function smartgov.list_my_tasks(
  p_session_token text,
  p_status        text
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
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  v_usg := smartgov.is_usg(v_account.id, v_account.organization_id);

  select coalesce(array_agg(u), '{}'::uuid[]) into v_units
    from smartgov.lsg_unit_ids(v_account.id, v_account.organization_id) u;

  return jsonb_build_object(
    'ok', true,
    'isUsg', v_usg,
    'tasks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id,
        'title', t.title,
        'details', t.details,
        'dueDate', t.due_date,
        'dueTime', t.due_time,
        'dueTimezone', t.due_timezone,
        'priority', t.priority,
        'autoClose', t.auto_close,
        'closed', t.closed_at is not null,
        'createdAt', t.created_at,
        'overdue', (t.due_date is not null
                    and (t.due_date + coalesce(t.due_time, '23:59:59'::time)) < now()
                    and t.closed_at is null),
        'daysLeft', case when t.due_date is null then null
                         else (t.due_date - current_date) end,
        'totalUnits', (select count(*) from smartgov.task_assignments ta where ta.task_id = t.id),
        'doneUnits', (select count(*) from smartgov.task_assignments ta
                       where ta.task_id = t.id and ta.status = 'approved'),
        'myStatus', case when v_usg then null else (
          select ta.status from smartgov.task_assignments ta
           where ta.task_id = t.id and ta.unit_id = any (v_units) limit 1) end,
        'mySubmittedAt', case when v_usg then null else (
          select ta.submitted_at from smartgov.task_assignments ta
           where ta.task_id = t.id and ta.unit_id = any (v_units) limit 1) end,
        'myLate', case when v_usg then null else (
          select ta.late from smartgov.task_assignments ta
           where ta.task_id = t.id and ta.unit_id = any (v_units) limit 1) end,
        'myReviewOpenedAt', case when v_usg then null else (
          select ta.review_opened_at from smartgov.task_assignments ta
           where ta.task_id = t.id and ta.unit_id = any (v_units) limit 1) end,
        'unitNames', coalesce((
          select jsonb_agg(gu.name order by gu.name)
            from smartgov.task_assignments ta
            join public.governance_units gu on gu.id = ta.unit_id
           where ta.task_id = t.id
             and (v_usg or ta.unit_id = any (v_units))
        ), '[]'::jsonb)
      ) order by
          (t.closed_at is not null),
          coalesce(t.due_date, '9999-12-31'::date),
          t.created_at desc)
        from smartgov.tasks t
       where t.organization_id = v_account.organization_id
         and (v_usg or exists (
           select 1 from smartgov.task_assignments ta
            where ta.task_id = t.id and ta.unit_id = any (v_units)))
         and (
           p_status is null or p_status = ''
           or (p_status = 'open'   and t.closed_at is null)
           or (p_status = 'closed' and t.closed_at is not null)
           or (p_status = 'overdue' and t.closed_at is null and t.due_date is not null
               and (t.due_date + coalesce(t.due_time, '23:59:59'::time)) < now())
         )
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function smartgov.list_my_tasks(text, text) from public;

create or replace function smartgov.list_tasks(p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_is_usg  boolean;
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  v_is_usg := v_account.account_scope = 'owner'
             or smartgov.is_org_reviewer(v_account.id, v_account.organization_id);

  return jsonb_build_object(
    'ok', true,
    'scope', case when v_is_usg then 'organization' else 'unit' end,
    'tasks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id,
        'title', t.title,
        'details', t.details,
        'dueDate', t.due_date,
        'priority', t.priority,
        'overdue', (t.due_date is not null
                    and t.due_date < current_date
                    and coalesce((
                      select min(ta.status) from smartgov.task_assignments ta
                       where ta.task_id = t.id), '') <> 'approved'),
        'daysLeft', case when t.due_date is null then null
                         else (t.due_date - current_date) end,
        'assignments', coalesce((
          select jsonb_agg(jsonb_build_object(
            'unitId', ta.unit_id,
            'unitName', (select gu.name from public.governance_units gu where gu.id = ta.unit_id),
            'status', ta.status,
            'note', ta.note
          ) order by (select gu.name from public.governance_units gu where gu.id = ta.unit_id))
            from smartgov.task_assignments ta
           where ta.task_id = t.id
             and (v_is_usg or ta.unit_id in (
                   select u from (
                     select smartgov.lsg_unit_ids(v_account.id, v_account.organization_id) as u
                   ) s
                 ))
        ), '[]'::jsonb),
        'doneUnits', (select count(*) from smartgov.task_assignments ta
                       where ta.task_id = t.id and ta.status = 'approved'),
        'totalUnits', (select count(*) from smartgov.task_assignments ta where ta.task_id = t.id)
      ) order by t.due_date nulls last, t.created_at desc)
        from smartgov.tasks t
       where t.organization_id = v_account.organization_id
         and (v_is_usg or exists (
               select 1 from smartgov.task_assignments ta
                where ta.task_id = t.id
                  and ta.unit_id in (
                    select u from (
                      select smartgov.lsg_unit_ids(v_account.id, v_account.organization_id) as u
                    ) s
                  )
         ))
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function smartgov.list_tasks(text) from public;

create or replace function smartgov.update_task_status(
  p_session_token text,
  p_task_id       uuid,
  p_unit_id       uuid,
  p_status        text,
  p_note          text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_task    smartgov.tasks%rowtype;
  v_is_usg  boolean;
  v_status  text := lower(trim(coalesce(p_status, '')));
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if v_status not in ('pending', 'draft', 'under_review', 'returned', 'approved', 'rejected') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  select t.* into v_task
    from smartgov.tasks t
   where t.id = p_task_id
     and t.organization_id = v_account.organization_id;

  if v_task.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  v_is_usg := v_account.account_scope = 'owner'
             or smartgov.is_org_reviewer(v_account.id, v_account.organization_id);

  if not v_is_usg then
    if not exists (
      select 1 from smartgov.task_assignments ta
       where ta.task_id = p_task_id
         and ta.unit_id = p_unit_id
         and ta.unit_id in (
           select u from (
             select smartgov.lsg_unit_ids(v_account.id, v_account.organization_id) as u
           ) s
         )
    ) then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
    if v_status not in ('pending', 'draft') then
      return jsonb_build_object('ok', false, 'reason', 'not_your_decision');
    end if;
  end if;

  update smartgov.task_assignments
     set status = v_status,
         note = btrim(coalesce(p_note, '')),
         updated_by = v_account.id,
         updated_at = now()
   where task_id = p_task_id and unit_id = p_unit_id;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  return jsonb_build_object('ok', true, 'taskId', p_task_id, 'unitId', p_unit_id, 'status', v_status);
end;
$$;

revoke all on function smartgov.update_task_status(text, uuid, uuid, text, text) from public;

create or replace function smartgov.list_personal_requests(
  p_session_token text,
  p_status        text
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
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  v_usg := smartgov.is_usg(v_account.id, v_account.organization_id);

  select coalesce(array_agg(u), '{}'::uuid[]) into v_units
    from smartgov.lsg_unit_ids(v_account.id, v_account.organization_id) u;

  return jsonb_build_object(
    'ok', true,
    'isUsg', v_usg,
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'unitId', r.unit_id,
        'unitName', (select gu.name from public.governance_units gu where gu.id = r.unit_id),
        'subject', r.subject,
        'coverLetter', r.cover_letter,
        'purpose', r.purpose,
        'neededOn', r.needed_on,
        'neededTime', r.needed_time,
        'neededTimezone', r.needed_timezone,
        'linkUrl', r.link_url,
        'originalName', r.original_name,
        'storagePath', r.storage_path,
        'mimeType', r.mime_type,
        'sizeBytes', r.size_bytes,
        'status', r.status,
        'decisionNote', r.decision_note,
        'decidedAt', r.decided_at,
        'createdAt', r.created_at,
        'mine', (r.unit_id = any (v_units)),
        'expired', (r.status = 'pending'
                    and r.needed_on is not null
                    and (r.needed_on + coalesce(r.needed_time, '23:59:59'::time)) < now()),
        'daysLeft', (r.needed_on - current_date)
      ) order by
          (r.status <> 'pending'),
          coalesce(r.needed_on, '9999-12-31'::date),
          r.created_at desc)
        from smartgov.personal_requests r
       where r.organization_id = v_account.organization_id
         and (v_usg or r.unit_id = any (v_units))
         and (
           p_status is null or p_status = ''
           or p_status = r.status
           or (p_status = 'open' and r.status = 'pending')
         )
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function smartgov.list_personal_requests(text, text) from public;

create or replace function smartgov.decide_personal_request(
  p_session_token text,
  p_request_id    uuid,
  p_decision      text,
  p_note          text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_req     smartgov.personal_requests%rowtype;
  v_usg     boolean;
  v_units   uuid[];
  v_note    text;
  v_decision text := lower(trim(coalesce(p_decision, '')));
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  select r.* into v_req
    from smartgov.personal_requests r
   where r.id = p_request_id and r.organization_id = v_account.organization_id;

  if v_req.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  v_usg := smartgov.is_usg(v_account.id, v_account.organization_id);

  select coalesce(array_agg(u), '{}'::uuid[]) into v_units
    from smartgov.lsg_unit_ids(v_account.id, v_account.organization_id) u;

  v_note := btrim(coalesce(p_note, ''));
  if length(v_note) > 2000 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  if v_decision = 'withdrawn' then
    if not (v_req.unit_id = any (v_units)) then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
    if v_req.status <> 'pending' then
      return jsonb_build_object('ok', false, 'reason', 'already_decided');
    end if;

    update smartgov.personal_requests
       set status = 'rejected', decision_note = v_note,
           decided_by = v_account.id, decided_at = now()
     where id = p_request_id;

    return jsonb_build_object('ok', true, 'status', 'rejected');
  end if;

  if v_decision = 'granted' then v_decision := 'approved'; end if;
  if v_decision = 'declined' then v_decision := 'rejected'; end if;
  if v_decision in ('needs_revision', 'submission_required') then v_decision := 'returned'; end if;

  if v_decision not in ('approved', 'rejected', 'returned') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  if not v_usg then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if v_req.status <> 'pending' then
    return jsonb_build_object('ok', false, 'reason', 'already_decided');
  end if;

  if v_decision in ('rejected', 'returned') and length(v_note) < 2 then
    return jsonb_build_object('ok', false, 'reason', 'note_required');
  end if;

  update smartgov.personal_requests
     set status = v_decision, decision_note = v_note,
         decided_by = v_account.id, decided_at = now()
   where id = p_request_id;

  return jsonb_build_object('ok', true, 'status', v_decision);
end;
$$;

revoke all on function smartgov.decide_personal_request(text, uuid, text, text) from public;

create or replace function smartgov.resubmit_personal_request(
  p_session_token text,
  p_request_id    uuid,
  p_note          text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account  smartgov.accounts%rowtype;
  v_req      smartgov.personal_requests%rowtype;
  v_units    uuid[];
  v_note     text;
  v_combined text;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  select r.* into v_req
    from smartgov.personal_requests r
   where r.id = p_request_id and r.organization_id = v_account.organization_id;

  if v_req.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  select coalesce(array_agg(u), '{}'::uuid[]) into v_units
    from smartgov.lsg_unit_ids(v_account.id, v_account.organization_id) u;

  if not (v_req.unit_id = any (v_units)) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if v_req.status not in ('returned', 'needs_revision', 'submission_required') then
    return jsonb_build_object('ok', false, 'reason', 'already_decided');
  end if;

  v_note := btrim(coalesce(p_note, ''));
  if length(v_note) > 2000 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  v_combined := btrim(coalesce(v_req.decision_note, ''));
  if v_note <> '' then
    if v_combined <> '' then
      v_combined := v_combined || E'\n\nLSG response: ' || v_note;
    else
      v_combined := v_note;
    end if;
  end if;

  update smartgov.personal_requests
     set status = 'pending', decision_note = nullif(v_combined, ''),
         decided_by = null, decided_at = null
   where id = p_request_id;

  return jsonb_build_object('ok', true, 'status', 'pending');
end;
$$;

revoke all on function smartgov.resubmit_personal_request(text, uuid, text) from public;

create or replace function smartgov.review_resolution(
  p_session_token text,
  p_resolution_id uuid,
  p_decision      text,
  p_remark        text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account  smartgov.accounts%rowtype;
  v_row      smartgov.resolutions%rowtype;
  v_decision text := lower(trim(coalesce(p_decision, '')));
  v_remark   text := nullif(trim(coalesce(p_remark, '')), '');
  v_final    boolean;
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

  if v_decision = 'published' then v_decision := 'approved'; end if;
  if v_decision not in ('under_review', 'approved', 'rejected', 'returned') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  if v_decision in ('returned', 'rejected') and v_remark is null then
    return jsonb_build_object('ok', false, 'reason', 'remark_required');
  end if;

  select r.* into v_row
  from smartgov.resolutions r
  where r.id = p_resolution_id
    and r.organization_id = v_account.organization_id;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  insert into smartgov.resolution_reviews (resolution_id, reviewer_id, decision, remark)
  values (v_row.id, v_account.id, v_decision, v_remark);

  v_final := v_decision in ('approved', 'rejected', 'returned');

  update smartgov.resolutions
     set status = v_decision,
         decision_remark = case when v_final then v_remark else decision_remark end,
         decided_by = case when v_final then v_account.id else decided_by end,
         decided_at = case when v_final then now() else decided_at end
   where id = v_row.id;

  return jsonb_build_object('ok', true, 'id', v_row.id, 'status', v_decision);
end;
$$;

revoke all on function smartgov.review_resolution(text, uuid, text, text) from public;

create or replace function smartgov.decide_event(
  p_session_token text,
  p_event_id uuid,
  p_decision text,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account  smartgov.accounts%rowtype;
  v_event    smartgov.events%rowtype;
  v_decision text := lower(trim(coalesce(p_decision, '')));
  v_note     text := btrim(coalesce(p_note, ''));
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if not smartgov.is_usg_side(v_account) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if v_decision = 'approved' then v_decision := 'honored'; end if;
  if v_decision = 'rejected' then v_decision := 'not_honored'; end if;
  if v_decision not in ('honored', 'not_honored') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;
  if v_decision = 'not_honored' and length(v_note) < 3 then
    return jsonb_build_object('ok', false, 'reason', 'reason_required');
  end if;

  select * into v_event from smartgov.events
   where id = p_event_id and organization_id = v_account.organization_id;
  if v_event.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_event.source <> 'lsg' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  update smartgov.events
     set status = case when v_decision = 'honored' then 'honored' else 'rejected' end,
         honor_status = v_decision,
         honor_reason = case when v_decision = 'not_honored' then v_note else null end,
         decision_note = nullif(v_note, ''),
         decided_by = v_account.id,
         decided_at = now(),
         updated_at = now()
   where id = v_event.id;

  insert into smartgov.notifications (account_id, organization_id, kind, title, body, link)
  values (
    v_event.created_by, v_account.organization_id,
    case when v_decision = 'honored' then 'event_honored' else 'event_not_honored' end,
    case when v_decision = 'honored' then 'Event honoured' else 'Event not honoured' end,
    v_event.title || case when v_decision = 'not_honored' then ': ' || v_note else ' was honoured.' end,
    '/lsg/events'
  );

  insert into smartgov.audit_log (organization_id, actor_id, action, target_type, target_id, detail)
  values (v_account.organization_id, v_account.id,
          case when v_decision = 'honored' then 'event.honored' else 'event.not_honored' end,
          'event', v_event.id, jsonb_build_object('title', v_event.title, 'reason', v_note));

  return jsonb_build_object('ok', true, 'honorStatus', v_decision);
end;
$$;

revoke all on function smartgov.decide_event(text, uuid, text, text) from public;

-- Keep event creation working after personal requests moved from 'granted'
-- to 'approved': the linked-request guard accepts both spellings.

create or replace function smartgov.create_event_v2_base(
  p_session_token text,
  p_title text,
  p_description text,
  p_event_date date,
  p_event_time time,
  p_timezone text,
  p_venue text,
  p_scope text,
  p_unit_ids uuid[],
  p_unit_types text[],
  p_files jsonb,
  p_link_request uuid,
  p_claim_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account  smartgov.accounts%rowtype;
  v_usg      boolean;
  v_unit     uuid;
  v_id       uuid;
  v_scope    text := lower(trim(coalesce(p_scope, 'university')));
  v_file     jsonb;
  v_target   uuid;
  v_type     text;
  v_kind     text;
  v_title    text;
  v_body     text;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if v_account.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;
  if p_title is null or length(btrim(p_title)) < 3 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_title');
  end if;
  if p_event_date is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  v_usg := smartgov.is_usg_side(v_account);
  v_unit := smartgov.my_lsg_unit(v_account);

  if not v_usg and v_unit is null then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if v_scope = 'org' then v_scope := 'university'; end if;
  if v_usg and v_scope not in ('university', 'unit_type', 'units', 'unit') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  -- An LSG can only add an event for its own unit; it cannot mint a
  -- university-wide event or one for a sibling.
  if not v_usg then
    v_scope := 'unit';
  end if;

  if p_link_request is not null then
    if not exists (
      select 1 from smartgov.personal_requests r
       where r.id = p_link_request
         and r.status in ('approved', 'granted')
         and (v_usg or r.unit_id = v_unit)
    ) then
      return jsonb_build_object('ok', false, 'reason', 'invalid_request');
    end if;
  end if;

  insert into smartgov.events (
    organization_id, created_by, title, description, event_date, event_time,
    event_timezone, venue, scope, unit_id, status, honor_status, source,
    support_files, claim_note, linked_request
  )
  values (
    v_account.organization_id,
    v_account.id,
    btrim(p_title),
    nullif(btrim(coalesce(p_description, '')), ''),
    p_event_date,
    p_event_time,
    nullif(btrim(coalesce(p_timezone, '')), ''),
    nullif(btrim(coalesce(p_venue, '')), ''),
    v_scope,
    case when v_scope = 'unit' then coalesce(v_unit, p_unit_ids[1]) else null end,
    case when v_usg then 'upcoming' else 'claimed' end,
    case when v_usg then 'honored' else 'pending' end,
    case when v_usg then 'usg' else 'lsg' end,
    coalesce(p_files, '[]'::jsonb),
    nullif(btrim(coalesce(p_claim_note, '')), ''),
    p_link_request
  )
  returning id into v_id;

  -- Scope rows.
  if v_scope = 'unit_type' then
    foreach v_type in array coalesce(p_unit_types, '{}'::text[]) loop
      insert into smartgov.event_scopes (event_id, unit_type) values (v_id, lower(v_type));
    end loop;
  elsif v_scope = 'units' then
    foreach v_target in array coalesce(p_unit_ids, '{}'::uuid[]) loop
      if exists (
        select 1 from public.governance_units u
         where u.id = v_target and u.organization_id = v_account.organization_id
      ) then
        insert into smartgov.event_scopes (event_id, unit_id) values (v_id, v_target);
      end if;
    end loop;
  elsif v_scope = 'unit' and coalesce(v_unit, p_unit_ids[1]) is not null then
    insert into smartgov.event_scopes (event_id, unit_id)
    values (v_id, coalesce(v_unit, p_unit_ids[1]));
  end if;

  -- Support links, stored twice: the legacy jsonb for old readers and the
  -- structured table for the new detail panel.
  for v_file in select value from jsonb_array_elements(case when jsonb_typeof(coalesce(p_files, '[]'::jsonb)) = 'array' then coalesce(p_files, '[]'::jsonb) else '[]'::jsonb end) loop
    if length(btrim(coalesce(v_file->>'url', ''))) > 0 then
      insert into smartgov.event_files (event_id, url, original_name, uploaded_by)
      values (
        v_id,
        btrim(v_file->>'url'),
        coalesce(nullif(btrim(v_file->>'name'), ''), 'Support file'),
        v_account.id
      );
    end if;
  end loop;

  v_title := case when v_usg then 'New university event' else 'New event claim' end;
  v_body  := btrim(p_title) || ' Ã‚Â· ' || to_char(p_event_date, 'YYYY-MM-DD')
             || case when p_event_time is not null then ' ' || to_char(p_event_time, 'HH24:MI') else '' end;

  if v_usg then
    -- Notify the units the event is addressed to.
    for v_target in
      select distinct a.id
        from smartgov.accounts a
        join smartgov.roster r on r.account_id = a.id
        join smartgov.unit_memberships m on m.roster_id = r.id
        join public.governance_units u on u.id = m.unit_id
       where a.organization_id = v_account.organization_id
         and a.status = 'active'
         and (m.end_date is null or m.end_date >= current_date)
         and (
           v_scope = 'university'
           or (v_scope = 'unit_type' and lower(u.unit_type::text) = any (
                 select lower(t) from unnest(coalesce(p_unit_types, '{}'::text[])) t))
           or (v_scope = 'units' and u.id = any (coalesce(p_unit_ids, '{}'::uuid[])))
           or (v_scope = 'unit' and u.id = coalesce(v_unit, p_unit_ids[1]))
         )
    loop
      insert into smartgov.notifications (account_id, organization_id, kind, title, body, link)
      values (v_target, v_account.organization_id, 'event_published', v_title, v_body, '/lsg/events');
    end loop;
  else
    for v_target in
      select a.id from smartgov.accounts a
       where a.organization_id = v_account.organization_id
         and a.status = 'active'
         and (a.account_scope = 'owner' or smartgov.is_org_reviewer(a.id, a.organization_id))
    loop
      insert into smartgov.notifications (account_id, organization_id, kind, title, body, link)
      values (v_target, v_account.organization_id, 'event_claim', v_title, v_body, '/usg/events');
    end loop;
  end if;

  insert into smartgov.audit_log (organization_id, actor_id, action, target_type, target_id, detail)
  values (v_account.organization_id, v_account.id,
          case when v_usg then 'event.created' else 'event.claimed' end,
          'event', v_id,
          jsonb_build_object('title', btrim(p_title), 'scope', v_scope));

  return jsonb_build_object('ok', true, 'eventId', v_id);
end;
$$;
