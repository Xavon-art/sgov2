-- Request module: align the assignment status vocabulary.
--
-- 03112 introduced two statuses the table would not accept. `task_assignments`
-- was built in 02400 with the ladder `assigned -> in_progress -> done` and a
-- check constraint to match, and the Phase 2 functions I wrote used `pending`
-- and `submitted` instead. The check constraint rejected every write, which is
-- how this was caught: the unit-side tests failed with a constraint violation
-- rather than a logic error.
--
-- The fix goes in two directions, and both are deliberate.
--
--   * `assigned` is the real name of the first rung, so the code adopts it.
--     Renaming the table's vocabulary to match new code would have been the
--     wrong way round -- `list_tasks` and the existing records already speak it.
--
--   * `submitted` is genuinely missing. Under the old three-rung ladder a unit
--     could only be `in_progress` or `done`, and `done` is the office's to
--     grant, so there was no state meaning "the unit says it is finished and
--     the office has not ruled". That gap is real, so the constraint is widened
--     rather than the feature dropped. Existing rows are unaffected: the new
--     value is added, none is removed.
--
-- Nothing here touches data. It is a constraint widening plus the two functions
-- that wrote the wrong words.

-- ------------------------------------------------------------------ the ladder
alter table smartgov.task_assignments
  drop constraint if exists task_assignments_status_check;

alter table smartgov.task_assignments
  add constraint task_assignments_status_check
  check (status in ('assigned', 'in_progress', 'submitted', 'done'));

-- A partial index, because the one question asked of this column in a loop is
-- "which units are still not done", and that is the smaller half.
create index if not exists task_assignments_open_idx
  on smartgov.task_assignments (task_id)
  where status <> 'done';

-- ------------------------------------------------------------ submit an answer
--
-- Rewritten in full rather than patched: the status words appear in the body and
-- in the guard. Re-issuing the whole function keeps one readable definition
-- instead of a chain of alters.
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

  -- Answering moves an untouched assignment onto the ladder, but never moves it
  -- backwards: a unit that has already said it is finished stays finished.
  update smartgov.task_assignments
     set status = 'in_progress', updated_at = now()
   where task_id = v_req.task_id and unit_id = v_unit
     and status = 'assigned';

  return jsonb_build_object('ok', true, 'unitId', v_unit, 'status', 'pending');
end;
$$;

revoke all on function smartgov.submit_requirement_answer(text, uuid, uuid, text, text, text, text, bigint) from public;

-- ------------------------------------------------------------- the unit's ladder
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

  -- The unit's reachable rungs. `done` is absent on purpose: it is the office's
  -- grant, and its absence here is what makes that true rather than a rule
  -- enforced elsewhere.
  if p_status not in ('assigned', 'in_progress', 'submitted') then
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

-- ------------------------------------------------------- the return sends it back
--
-- Re-issued because of one word: a return now puts the unit back on
-- `in_progress`, which is the rung the table actually has.
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

  if p_verdict = 'returned' then
    update smartgov.task_assignments
       set status = 'in_progress', updated_at = now()
     where task_id = v_req.task_id and unit_id = p_unit_id
       and status <> 'done';
  end if;

  return jsonb_build_object('ok', true, 'verdict', p_verdict);
end;
$$;

revoke all on function smartgov.review_requirement_answer(text, uuid, uuid, text, text) from public;

grant execute on function public.submit_requirement_answer(text, uuid, uuid, text, text, text, text, bigint) to anon, authenticated, service_role;
grant execute on function public.update_assignment_status(text, uuid, uuid, text, text) to anon, authenticated, service_role;
grant execute on function public.review_requirement_answer(text, uuid, uuid, text, text) to anon, authenticated, service_role;
