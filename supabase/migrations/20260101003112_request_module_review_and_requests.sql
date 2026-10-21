-- Request module: answering requirements, reviewing answers, closing tasks, and
-- the personal-request flow.
--
-- 03111 built the thread and the authoring path. This file is the other half:
-- a unit answering the office's checklist, the office ruling on each answer, the
-- office closing a task, and the LSG's own channel upward.
--
-- One rule carries through from the previous file. Every unit id that arrives in
-- a body is a claim; it is checked against the caller's own memberships before
-- it is believed. The only exception is the office, and even there it is checked
-- against the organisation rather than trusted.

-- ------------------------------------------------------- answer a requirement
--
-- An answer is a link or an uploaded file, never neither. Re-answering replaces
-- the row in place and resets the verdict to 'pending', which is deliberate: the
-- office rules on the current answer, and a stale verdict on a replaced answer
-- is worse than no verdict at all.
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

  -- The office does not answer its own checklist. It may, however, supply a
  -- unit's answer on the unit's behalf only by being that unit's officer, which
  -- is a different thing and is handled by the branch below.
  select coalesce(array_agg(u), '{}'::uuid[]) into v_units
    from smartgov.lsg_unit_ids(v_account.id, v_account.organization_id) u;

  if p_unit_id is not null then
    if not (p_unit_id = any (v_units)) then
      -- Only the office may post for a unit it does not sit in, and it must own
      -- the unit. This is how the office fixes a misfiled upload.
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

  -- The unit must actually hold an assignment on this task.
  if not exists (select 1 from smartgov.task_assignments ta
                  where ta.task_id = v_req.task_id and ta.unit_id = v_unit) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
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

  -- The accepted-type list is enforced here, not in the client. An empty list
  -- means the office will take anything.
  if v_path is not null and jsonb_typeof(v_req.accepted_types) = 'array'
     and jsonb_array_length(v_req.accepted_types) > 0 then
    declare
      v_ext text;
      v_ok  boolean := false;
      v_t   text;
    begin
      v_ext := lower(coalesce(
        nullif(regexp_replace(coalesce(p_original_name, ''), '^.*\.', ''), ''),
        ''
      ));
      for v_t in select jsonb_array_elements_text(v_req.accepted_types) loop
        if lower(btrim(v_t)) = v_ext then
          v_ok := true;
        end if;
      end loop;
      if not v_ok then
        return jsonb_build_object('ok', false, 'reason', 'unaccepted_type');
      end if;
    end;
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

  -- Answering an assignment moves it forward, if it has not started yet.
  update smartgov.task_assignments
     set status = 'in_progress', updated_at = now()
   where task_id = v_req.task_id and unit_id = v_unit and status = 'pending';

  return jsonb_build_object('ok', true, 'unitId', v_unit, 'status', 'pending');
end;
$$;

revoke all on function smartgov.submit_requirement_answer(text, uuid, uuid, text, text, text, text, bigint) from public;

-- ---------------------------------------------------------- review an answer
--
-- The office's three verdicts, each with a note that is kept. A return without
-- a reason is not a decision, so the note is required for 'returned' and
-- 'flagged' and optional for 'approved'.
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
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if not smartgov.is_usg(v_account.id, v_account.organization_id) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if p_verdict not in ('approved', 'flagged', 'returned') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  v_note := btrim(coalesce(p_note, ''));
  if p_verdict in ('returned', 'flagged') and length(v_note) < 2 then
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
     set review_status = p_verdict,
         review_note   = v_note,
         reviewed_by   = v_account.id,
         reviewed_at   = now()
   where requirement_id = p_requirement_id and unit_id = p_unit_id;

  insert into smartgov.task_requirement_reviews
    (requirement_id, unit_id, verdict, note, reviewer_id)
  values
    (p_requirement_id, p_unit_id, p_verdict, v_note, v_account.id);

  -- A return sends the unit back to work on that assignment.
  if p_verdict = 'returned' then
    update smartgov.task_assignments
       set status = 'in_progress', updated_at = now()
     where task_id = v_req.task_id and unit_id = p_unit_id;
  end if;

  return jsonb_build_object('ok', true, 'verdict', p_verdict);
end;
$$;

revoke all on function smartgov.review_requirement_answer(text, uuid, uuid, text, text) from public;

-- ------------------------------------------------------------- move an assignment
--
-- The unit's own status control: pending -> in_progress -> submitted. It cannot
-- reach 'done'; that is the office's grant, and it is the whole reason the status
-- ladder exists rather than a boolean.
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
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if p_status not in ('pending', 'in_progress', 'submitted') then
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
  if v_now = 'done' then
    return jsonb_build_object('ok', false, 'reason', 'already_done');
  end if;

  update smartgov.task_assignments
     set status = p_status,
         note = btrim(coalesce(p_note, '')),
         updated_at = now()
   where task_id = p_task_id and unit_id = p_unit_id;

  return jsonb_build_object('ok', true, 'status', p_status);
end;
$$;

revoke all on function smartgov.update_assignment_status(text, uuid, uuid, text, text) from public;

-- ------------------------------------------------------------ the office's grant
--
-- The only path to 'done'. Kept separate from the unit's status control so no
-- unit can mark its own homework complete.
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
     set status = 'done',
         note = btrim(coalesce(p_note, '')),
         updated_at = now()
   where task_id = p_task_id and unit_id = p_unit_id;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  return jsonb_build_object('ok', true, 'status', 'done');
end;
$$;

revoke all on function smartgov.confirm_assignment_done(text, uuid, uuid, text) from public;

-- ---------------------------------------------------------------- close a task
--
-- Closing stops new answers and new messages on every unit at once, and it
-- carries a statement so the units are told why rather than finding the door
-- shut. Undone assignments are left as they are -- closing is not an approval.
create or replace function smartgov.close_task(
  p_session_token text,
  p_task_id       uuid,
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
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if not smartgov.is_usg(v_account.id, v_account.organization_id) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  select t.* into v_task
    from smartgov.tasks t
   where t.id = p_task_id and t.organization_id = v_account.organization_id;

  if v_task.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if v_task.closed_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'already_closed');
  end if;

  update smartgov.tasks
     set closed_at = now(),
         closed_by = v_account.id,
         closing_note = btrim(coalesce(p_note, ''))
   where id = p_task_id;

  return jsonb_build_object('ok', true, 'closedAt', now());
end;
$$;

revoke all on function smartgov.close_task(text, uuid, text) from public;

-- --------------------------------------------------------------- list my tasks
--
-- One list for both sides, scoped by who is asking. The office sees every task
-- it authored; a unit sees every task assigned to it. That single function is
-- what lets the two dashboards share one screen component.
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
                       where ta.task_id = t.id and ta.status = 'done'),
        -- For a unit, its own row; for the office, null.
        'myStatus', case when v_usg then null else (
          select ta.status from smartgov.task_assignments ta
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

-- ------------------------------------------------------------ personal requests
--
-- The LSG's channel upward: one unit, one covering letter, one document, one
-- needed-by date. Filing is the unit's alone -- the office cannot file on its
-- behalf, because the point of the channel is that the ask is the unit's.
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
  -- A request needed in the past is not a request.
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
  -- A partial file is a bug in the upload path, not a valid row.
  if v_path is not null and nullif(btrim(coalesce(p_original_name, '')), '') is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  insert into smartgov.personal_requests
    (organization_id, unit_id, created_by, subject, cover_letter, purpose,
     needed_on, needed_time, needed_timezone, link_url, storage_path,
     original_name, mime_type, size_bytes)
  values
    (v_account.organization_id, v_unit, v_account.id, v_subject, v_letter,
     btrim(coalesce(p_purpose, '')), p_needed_on, p_needed_time,
     nullif(btrim(coalesce(p_needed_timezone, '')), ''), v_link, v_path,
     nullif(btrim(coalesce(p_original_name, '')), ''),
     nullif(btrim(coalesce(p_mime_type, '')), ''), p_size_bytes)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'requestId', v_id);
end;
$$;

revoke all on function smartgov.file_personal_request(text, uuid, text, text, text, date, time, text, text, text, text, text, bigint) from public;

-- ------------------------------------------------------------ list requests
--
-- The office sees every request in its organisation; a unit sees its own. The
-- `expired` flag is computed on read, never stored -- the same rule every other
-- deadline in this schema follows.
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
        'expired', (r.status = 'submitted'
                    and (r.needed_on + coalesce(r.needed_time, '23:59:59'::time)) < now()),
        'daysLeft', (r.needed_on - current_date)
      ) order by
          (r.status <> 'submitted'),
          coalesce(r.needed_on, '9999-12-31'::date),
          r.created_at desc)
        from smartgov.personal_requests r
       where r.organization_id = v_account.organization_id
         and (v_usg or r.unit_id = any (v_units))
         and (
           p_status is null or p_status = ''
           or p_status = r.status
           or (p_status = 'open' and r.status = 'submitted')
         )
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function smartgov.list_personal_requests(text, text) from public;

-- --------------------------------------------------------- decide a request
--
-- The office grants or declines, with a reason recorded either way. A unit may
-- also withdraw its own ask, which is not a decision by the office and is kept
-- distinct in the status.
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

  if p_decision = 'withdrawn' then
    -- Only the filing unit may withdraw, and only while it is still open.
    if not (v_req.unit_id = any (v_units)) then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
    if v_req.status <> 'submitted' then
      return jsonb_build_object('ok', false, 'reason', 'already_decided');
    end if;

    update smartgov.personal_requests
       set status = 'withdrawn', decision_note = v_note,
           decided_by = v_account.id, decided_at = now()
     where id = p_request_id;

    return jsonb_build_object('ok', true, 'status', 'withdrawn');
  end if;

  if p_decision not in ('granted', 'declined') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  if not v_usg then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if v_req.status <> 'submitted' then
    return jsonb_build_object('ok', false, 'reason', 'already_decided');
  end if;

  -- A decline without a reason is a door shut in silence.
  if p_decision = 'declined' and length(v_note) < 2 then
    return jsonb_build_object('ok', false, 'reason', 'note_required');
  end if;

  update smartgov.personal_requests
     set status = p_decision, decision_note = v_note,
         decided_by = v_account.id, decided_at = now()
   where id = p_request_id;

  return jsonb_build_object('ok', true, 'status', p_decision);
end;
$$;

revoke all on function smartgov.decide_personal_request(text, uuid, text, text) from public;

-- ------------------------------------------------------------------ wrappers
--
-- The public forwarders. Every smartgov function above is reachable only
-- through one of these, and each is granted to anon and authenticated because
-- the session token in the body is what actually authorises the call.
create or replace function public.list_task_thread(p_session_token text, p_task_id uuid)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.list_task_thread(p_session_token, p_task_id); $$;

create or replace function public.post_task_message(p_session_token text, p_task_id uuid, p_body text, p_unit_id uuid, p_reply_to uuid)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.post_task_message(p_session_token, p_task_id, p_body, p_unit_id, p_reply_to); $$;

create or replace function public.delete_task_message(p_session_token text, p_message_id uuid)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.delete_task_message(p_session_token, p_message_id); $$;

create or replace function public.react_to_message(p_session_token text, p_message_id uuid, p_reaction text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.react_to_message(p_session_token, p_message_id, p_reaction); $$;

create or replace function public.task_detail(p_session_token text, p_task_id uuid)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.task_detail(p_session_token, p_task_id); $$;

create or replace function public.create_task_v2(p_session_token text, p_title text, p_details text, p_due_date date, p_due_time time, p_due_timezone text, p_priority text, p_auto_close boolean, p_unit_ids jsonb, p_requirements jsonb)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.create_task_v2(p_session_token, p_title, p_details, p_due_date, p_due_time, p_due_timezone, p_priority, p_auto_close, p_unit_ids, p_requirements); $$;

create or replace function public.list_my_tasks(p_session_token text, p_status text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.list_my_tasks(p_session_token, p_status); $$;

create or replace function public.submit_requirement_answer(p_session_token text, p_requirement_id uuid, p_unit_id uuid, p_link_url text, p_storage_path text, p_original_name text, p_mime_type text, p_size_bytes bigint)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.submit_requirement_answer(p_session_token, p_requirement_id, p_unit_id, p_link_url, p_storage_path, p_original_name, p_mime_type, p_size_bytes); $$;

create or replace function public.review_requirement_answer(p_session_token text, p_requirement_id uuid, p_unit_id uuid, p_verdict text, p_note text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.review_requirement_answer(p_session_token, p_requirement_id, p_unit_id, p_verdict, p_note); $$;

create or replace function public.update_assignment_status(p_session_token text, p_task_id uuid, p_unit_id uuid, p_status text, p_note text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.update_assignment_status(p_session_token, p_task_id, p_unit_id, p_status, p_note); $$;

create or replace function public.confirm_assignment_done(p_session_token text, p_task_id uuid, p_unit_id uuid, p_note text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.confirm_assignment_done(p_session_token, p_task_id, p_unit_id, p_note); $$;

create or replace function public.close_task(p_session_token text, p_task_id uuid, p_note text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.close_task(p_session_token, p_task_id, p_note); $$;

create or replace function public.file_personal_request(p_session_token text, p_unit_id uuid, p_subject text, p_cover_letter text, p_purpose text, p_needed_on date, p_needed_time time, p_needed_timezone text, p_link_url text, p_storage_path text, p_original_name text, p_mime_type text, p_size_bytes bigint)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.file_personal_request(p_session_token, p_unit_id, p_subject, p_cover_letter, p_purpose, p_needed_on, p_needed_time, p_needed_timezone, p_link_url, p_storage_path, p_original_name, p_mime_type, p_size_bytes); $$;

create or replace function public.list_personal_requests(p_session_token text, p_status text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.list_personal_requests(p_session_token, p_status); $$;

create or replace function public.decide_personal_request(p_session_token text, p_request_id uuid, p_decision text, p_note text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.decide_personal_request(p_session_token, p_request_id, p_decision, p_note); $$;

-- --------------------------------------------------------------- grants
--
-- anon is granted because the login flow itself runs before a session exists;
-- every one of these functions rejects a null session on its first line, so the
-- grant buys reachability, not access.
grant execute on function public.list_task_thread(text, uuid) to anon, authenticated, service_role;
grant execute on function public.post_task_message(text, uuid, text, uuid, uuid) to anon, authenticated, service_role;
grant execute on function public.delete_task_message(text, uuid) to anon, authenticated, service_role;
grant execute on function public.react_to_message(text, uuid, text) to anon, authenticated, service_role;
grant execute on function public.task_detail(text, uuid) to anon, authenticated, service_role;
grant execute on function public.create_task_v2(text, text, text, date, time, text, text, boolean, jsonb, jsonb) to anon, authenticated, service_role;
grant execute on function public.list_my_tasks(text, text) to anon, authenticated, service_role;
grant execute on function public.submit_requirement_answer(text, uuid, uuid, text, text, text, text, bigint) to anon, authenticated, service_role;
grant execute on function public.review_requirement_answer(text, uuid, uuid, text, text) to anon, authenticated, service_role;
grant execute on function public.update_assignment_status(text, uuid, uuid, text, text) to anon, authenticated, service_role;
grant execute on function public.confirm_assignment_done(text, uuid, uuid, text) to anon, authenticated, service_role;
grant execute on function public.close_task(text, uuid, text) to anon, authenticated, service_role;
grant execute on function public.file_personal_request(text, uuid, text, text, text, date, time, text, text, text, text, text, bigint) to anon, authenticated, service_role;
grant execute on function public.list_personal_requests(text, text) to anon, authenticated, service_role;
grant execute on function public.decide_personal_request(text, uuid, text, text) to anon, authenticated, service_role;
