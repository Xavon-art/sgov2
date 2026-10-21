-- Request module: the functions behind threads, requirements, and personal requests.
--
-- The tables landed in 03110. This file is every path in and out of them, plus
-- the additive functions on `tasks` that the new UI needs (deadlines with a
-- time, requirements, auto-close).
--
-- One rule governs the whole file and it is worth stating once. Every function
-- resolves the caller from the session and decides scope from the caller's own
-- membership -- never from a parameter. A unit id arriving in a request body is
-- a claim, not a fact; it is checked against `smartgov.lsg_unit_ids` before it
-- is ever believed. That is why there is no function here that takes "the unit"
-- as an instruction rather than a subject.

-- ------------------------------------------------------------ who is who, once
--
-- Four small predicates, because the same three questions are asked in twenty
-- places and a scope check that drifts between callers is a leak.
--
--   is_usg()          the office: owner, or an invited officer seated in the USG unit
--   own_unit_ids()    every unit the caller currently sits in
--   sees_office()     may this caller read the office's side of a thread?
--   sees_unit()       may this caller read a unit's side?
--
-- They take the account row rather than a token so a caller that has already
-- authenticated does not authenticate again.

create or replace function smartgov.is_usg(p_account uuid, p_organization uuid)
returns boolean
language sql stable
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
  select exists (select 1 from smartgov.accounts a
                  where a.id = p_account
                    and a.organization_id = p_organization
                    and (a.account_scope = 'owner'
                         or smartgov.is_org_reviewer(a.id, a.organization_id)));
$$;

revoke all on function smartgov.is_usg(uuid, uuid) from public;

-- --------------------------------------------------------------- list one thread
--
-- The scoping decision, and it is the one that matters most in this file.
--
-- A message is visible to a caller when:
--   * it is a unit-wide message and the caller is on either side, and the
--     message has not been hidden from the caller's side; or
--   * it is a unit's message and the caller is that unit, or the office.
--
-- The two hidden flags are consulted separately, which is what makes USG's
-- unsend private to USG while a unit's delete clears it for both. Reading this
-- function is the only place that asymmetry should ever need to be understood.
create or replace function smartgov.list_task_thread(
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
   where t.id = p_task_id
     and t.organization_id = v_account.organization_id;

  if v_task.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  v_usg := smartgov.is_usg(v_account.id, v_account.organization_id);

  select coalesce(array_agg(u), '{}'::uuid[]) into v_units
    from smartgov.lsg_unit_ids(v_account.id, v_account.organization_id) u;

  -- An LSG caller must actually be assigned this task to read its thread.
  if not v_usg and not exists (
    select 1 from smartgov.task_assignments ta
     where ta.task_id = p_task_id and ta.unit_id = any (v_units)
  ) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  return jsonb_build_object(
    'ok', true,
    'taskId', p_task_id,
    'canClose', v_usg,
    'closed', v_task.closed_at is not null,
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id,
        'unitId', m.unit_id,
        'unitName', (select gu.name from public.governance_units gu where gu.id = m.unit_id),
        'authorId', m.author_id,
        'authorName', (select coalesce(nullif(btrim(a.display_name), ''), a.email)
                         from smartgov.accounts a where a.id = m.author_id),
        'authorSide', m.author_side,
        -- An unsent message is delivered as a tombstone rather than dropped,
        -- so the thread does not silently renumber and a reply keeps its parent.
        'unsent', (case when m.author_side = 'usg' then m.hidden_from_office
                        else m.hidden_from_unit end),
        -- A tombstone keeps its place in the thread but never its words: the
        -- body is emptied on the side that did the unsending.
        'body', (case
                   when (case when m.author_side = 'usg' then m.hidden_from_office
                              else m.hidden_from_unit end) then ''
                   else m.body
                 end),
        'replyTo', m.reply_to,
        'createdAt', m.created_at,
        'editedAt', m.edited_at,
        'mine', (m.author_id = v_account.id),
        'canUnsend', (m.author_id = v_account.id
                      and not (case when m.author_side = 'usg' then m.hidden_from_office
                                    else m.hidden_from_unit end)),
        -- One entry per reaction, tallied. The tally is computed in its own
        -- grouped subquery first and only then aggregated, because Postgres
        -- refuses to nest an aggregate inside jsonb_agg. That two-step is not
        -- stylistic -- it is the only shape that parses.
        'reactions', coalesce((
          select jsonb_agg(jsonb_build_object(
            'reaction', tally.reaction,
            'count', tally.n,
            'mine', tally.mine
          ))
            from (
              select r.reaction,
                     count(*)::int as n,
                     bool_or(r.account_id = v_account.id) as mine
                from smartgov.task_message_reactions r
               where r.message_id = m.id
               group by r.reaction
            ) tally
        ), '[]'::jsonb)
      ) order by m.created_at)
        from smartgov.task_messages m
       where m.task_id = p_task_id
         and (case when m.author_side = 'usg'
                   then not m.hidden_from_office
                   else not m.hidden_from_unit end)
         -- A unit's private note to the office is not read by other units.
         and (m.unit_id is null or v_usg or m.unit_id = any (v_units))
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function smartgov.list_task_thread(text, uuid) from public;

-- ------------------------------------------------------------- post to a thread
--
-- `p_unit_id` is honoured only when the caller actually holds that unit. A USG
-- caller may post as the office (no unit) or as any unit in its organisation;
-- an LSG caller may post as itself and nothing else. The side is decided here,
-- never sent by the client -- a client that could name its own side could
-- impersonate the other one.
create or replace function smartgov.post_task_message(
  p_session_token text,
  p_task_id       uuid,
  p_body          text,
  p_unit_id       uuid,
  p_reply_to      uuid
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
  v_body    text;
  v_unit    uuid;
  v_side    text;
  v_id      uuid;
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

  v_body := btrim(coalesce(p_body, ''));
  if length(v_body) < 1 or length(v_body) > 4000 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  v_usg := smartgov.is_usg(v_account.id, v_account.organization_id);

  select coalesce(array_agg(u), '{}'::uuid[]) into v_units
    from smartgov.lsg_unit_ids(v_account.id, v_account.organization_id) u;

  if v_usg then
    -- The office speaks for itself by default, or for a named unit it owns.
    v_side := 'usg';
    if p_unit_id is not null then
      if not exists (select 1 from public.governance_units gu
                      where gu.id = p_unit_id
                        and gu.organization_id = v_account.organization_id) then
        return jsonb_build_object('ok', false, 'reason', 'forbidden');
      end if;
      v_unit := p_unit_id;
    end if;
  else
    -- A unit speaks only for itself, and only on a task it was given.
    if array_length(v_units, 1) is null then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
    if p_unit_id is not null and p_unit_id <> all (v_units) then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
    v_unit := coalesce(p_unit_id, v_units[1]);
    v_side := 'lsg';

    if not exists (select 1 from smartgov.task_assignments ta
                    where ta.task_id = p_task_id and ta.unit_id = any (v_units)) then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
  end if;

  -- Auto-close and manual close both stop new messages, so a thread cannot be
  -- reopened after the office has wrapped the task up.
  if v_task.closed_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'task_closed');
  end if;
  if v_task.auto_close and v_task.due_date is not null then
    if (v_task.due_date + coalesce(v_task.due_time, '23:59:59'::time)) < now() then
      return jsonb_build_object('ok', false, 'reason', 'past_deadline');
    end if;
  end if;

  if p_reply_to is not null and not exists (
    select 1 from smartgov.task_messages m
     where m.id = p_reply_to and m.task_id = p_task_id
  ) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  insert into smartgov.task_messages (task_id, unit_id, author_id, author_side, body, reply_to)
  values (p_task_id, v_unit, v_account.id, v_side, v_body, p_reply_to)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'messageId', v_id, 'side', v_side);
end;
$$;

revoke all on function smartgov.post_task_message(text, uuid, text, uuid, uuid) from public;

-- ------------------------------------------------------------ unsend / delete
--
-- The asymmetric rule, implemented in one place.
--
--   * An author unsending their own message sets the flag for their own side.
--     When the office does it, that is `hidden_from_office` -- the office stops
--     seeing its own words, and the unit's copy is untouched.
--   * A unit deleting a message sets BOTH flags, because a unit withdrawing a
--     message should not leave the office reading a record the unit believes it
--     removed. This is the one path where a caller may clear the other side's
--     view, and it is granted deliberately and only to the author's own unit.
--   * The office may hide any message from its own view -- it is its desk.
--     It may NOT hide a unit's message from the unit; only the unit can do that.
--
-- Nothing is hard-deleted. The row survives so a unit's filings cannot be erased
-- by the party reviewing them.
create or replace function smartgov.delete_task_message(
  p_session_token text,
  p_message_id    uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_msg     smartgov.task_messages%rowtype;
  v_usg     boolean;
  v_units   uuid[];
  v_owner   boolean;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  select m.* into v_msg
    from smartgov.task_messages m
    join smartgov.tasks t on t.id = m.task_id
   where m.id = p_message_id
     and t.organization_id = v_account.organization_id;

  if v_msg.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  v_usg := smartgov.is_usg(v_account.id, v_account.organization_id);

  select coalesce(array_agg(u), '{}'::uuid[]) into v_units
    from smartgov.lsg_unit_ids(v_account.id, v_account.organization_id) u;

  v_owner := v_msg.unit_id is not null and v_msg.unit_id = any (v_units);

  if v_usg then
    -- The office may always tidy its own view.
    update smartgov.task_messages
       set hidden_from_office = true
     where id = p_message_id;

    return jsonb_build_object('ok', true, 'hiddenFrom', 'office',
                              'alsoHiddenFromUnit', false);
  end if;

  -- Not the office: the caller must be the unit that wrote it.
  if not (v_owner and v_msg.author_side = 'lsg') then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  -- A unit's delete clears both sides. See the header for why.
  update smartgov.task_messages
     set hidden_from_unit = true,
         hidden_from_office = true
   where id = p_message_id;

  return jsonb_build_object('ok', true, 'hiddenFrom', 'both',
                            'alsoHiddenFromUnit', true);
end;
$$;

revoke all on function smartgov.delete_task_message(text, uuid) from public;

-- ---------------------------------------------------------------- react / unreact
--
-- One row per person per reaction. Toggling is `on conflict do nothing` plus a
-- delete, so a double tap cannot produce a double count.
create or replace function smartgov.react_to_message(
  p_session_token text,
  p_message_id    uuid,
  p_reaction      text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_msg     smartgov.task_messages%rowtype;
  v_usg     boolean;
  v_units   uuid[];
  v_have    boolean;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if p_reaction not in ('seen', 'question', 'thanks', 'agree') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  select m.* into v_msg
    from smartgov.task_messages m
    join smartgov.tasks t on t.id = m.task_id
   where m.id = p_message_id and t.organization_id = v_account.organization_id;

  if v_msg.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  v_usg := smartgov.is_usg(v_account.id, v_account.organization_id);

  select coalesce(array_agg(u), '{}'::uuid[]) into v_units
    from smartgov.lsg_unit_ids(v_account.id, v_account.organization_id) u;

  -- The reaction has to be on a message the caller can actually see.
  if not v_usg and not (v_msg.unit_id is null or v_msg.unit_id = any (v_units)) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  select exists (select 1 from smartgov.task_message_reactions r
                  where r.message_id = p_message_id
                    and r.account_id = v_account.id
                    and r.reaction = p_reaction) into v_have;

  if v_have then
    delete from smartgov.task_message_reactions
     where message_id = p_message_id and account_id = v_account.id and reaction = p_reaction;
    return jsonb_build_object('ok', true, 'on', false, 'reaction', p_reaction);
  end if;

  insert into smartgov.task_message_reactions (message_id, account_id, reaction)
  values (p_message_id, v_account.id, p_reaction)
  on conflict do nothing;

  return jsonb_build_object('ok', true, 'on', true, 'reaction', p_reaction);
end;
$$;

revoke all on function smartgov.react_to_message(text, uuid, text) from public;

-- ------------------------------------------------------------- full task detail
--
-- The screen's read: the task, its requirements, and per-unit progress with each
-- unit's answer and verdict. `list_tasks` stays the cheap list; this is the one
-- task opened. Kept separate so the list does not pay for the detail.
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
                     where ta.task_id = v_task.id and ta.status = 'done'),
      'totalUnits', (select count(*) from smartgov.task_assignments ta where ta.task_id = v_task.id)
    ),
    'canClose', v_usg,
    'isUsg', v_usg,
    'myUnitIds', to_jsonb(v_units),
    -- Every unit's progress, but only the ones the caller may see.
    'assignments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'unitId', ta.unit_id,
        'unitName', (select gu.name from public.governance_units gu where gu.id = ta.unit_id),
        'status', ta.status,
        'note', ta.note,
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
        -- The caller's own unit's answer, when there is one.
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
        -- The office's summary across units, hidden from units.
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

-- -------------------------------------------------------------- author a task, v2
--
-- Supersedes the 6-argument `create_task`. The old one is left in place because
-- a dropped function breaks any caller mid-deploy; this one is the one the new
-- UI uses, and it carries the time, the zone, auto-close, and the requirements
-- in a single transaction so a task never exists without them.
create or replace function smartgov.create_task_v2(
  p_session_token  text,
  p_title          text,
  p_details        text,
  p_due_date       date,
  p_due_time       time,
  p_due_timezone   text,
  p_priority       text,
  p_auto_close     boolean,
  p_unit_ids       jsonb,
  p_requirements   jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_title   text;
  v_prio    text;
  v_task    uuid;
  v_units   uuid[];
  v_wanted  uuid[];
  v_req     jsonb;
  v_pos     integer := 0;
  v_label   text;
  v_types   jsonb;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if not smartgov.is_usg(v_account.id, v_account.organization_id) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  v_title := btrim(coalesce(p_title, ''));
  if length(v_title) < 4 or length(v_title) > 140 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_title');
  end if;

  v_prio := coalesce(nullif(btrim(coalesce(p_priority, '')), ''), 'normal');
  if v_prio not in ('low', 'normal', 'high') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  -- The deadline is checked against the moment, not the date, once a time is
  -- given: a task due at 9am when it is already 11am is late on arrival.
  if p_due_date is not null then
    if (p_due_date + coalesce(p_due_time, '23:59:59'::time)) < now() then
      return jsonb_build_object('ok', false, 'reason', 'past_deadline');
    end if;
  end if;

  if p_due_time is not null and nullif(btrim(coalesce(p_due_timezone, '')), '') is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  if jsonb_typeof(p_unit_ids) <> 'array' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  select coalesce(array_agg(distinct value::uuid), '{}'::uuid[]) into v_wanted
    from jsonb_array_elements_text(p_unit_ids) as value
   where value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     and value::uuid in (select gu.id from public.governance_units gu
                          where gu.organization_id = v_account.organization_id);

  if array_length(v_wanted, 1) is null then
    select coalesce(array_agg(gu.id), '{}'::uuid[]) into v_units
      from public.governance_units gu
     where gu.organization_id = v_account.organization_id;
    if array_length(v_units, 1) is null then
      return jsonb_build_object('ok', false, 'reason', 'no_unit');
    end if;
  else
    v_units := v_wanted;
  end if;

  if p_requirements is not null and jsonb_typeof(p_requirements) = 'array' then
    -- Validate every requirement BEFORE the first insert. The earlier shape of
    -- this function validated during the insert loop and returned an error,
    -- which left the task and its assignments committed and the checklist
    -- missing -- a half-built task nobody could answer. A return is not a
    -- rollback, so the check has to come first.
    for v_req in select * from jsonb_array_elements(p_requirements) loop
      v_label := btrim(coalesce(v_req ->> 'label', ''));
      if length(v_label) < 2 or length(v_label) > 160 then
        return jsonb_build_object('ok', false, 'reason', 'invalid_requirement');
      end if;
      if jsonb_typeof(coalesce(v_req -> 'acceptedTypes', '[]'::jsonb)) <> 'array' then
        return jsonb_build_object('ok', false, 'reason', 'invalid_requirement');
      end if;
    end loop;
  end if;

  insert into smartgov.tasks
    (organization_id, title, details, due_date, due_time, due_timezone,
     priority, auto_close, created_by)
  values
    (v_account.organization_id, v_title, btrim(coalesce(p_details, '')),
     p_due_date, p_due_time, nullif(btrim(coalesce(p_due_timezone, '')), ''),
     v_prio, coalesce(p_auto_close, false), v_account.id)
  returning id into v_task;

  insert into smartgov.task_assignments (task_id, unit_id)
  select v_task, unnest(v_units);

  -- Requirements, in the order the office listed them. Already validated above,
  -- so this loop cannot fail partway.
  if p_requirements is not null and jsonb_typeof(p_requirements) = 'array' then
    for v_req in select * from jsonb_array_elements(p_requirements) loop
      v_pos := v_pos + 1;
      v_types := coalesce(v_req -> 'acceptedTypes', '[]'::jsonb);

      insert into smartgov.task_requirements
        (task_id, position, label, instructions, accepted_types, required, sample_file)
      values
        (v_task, v_pos, btrim(coalesce(v_req ->> 'label', '')),
         btrim(coalesce(v_req ->> 'instructions', '')),
         v_types,
         coalesce((v_req ->> 'required')::boolean, true),
         v_req -> 'sampleFile');
    end loop;
  end if;

  return jsonb_build_object(
    'ok', true,
    'taskId', v_task,
    'assignedUnits', array_length(v_units, 1),
    'requirements', v_pos
  );
end;
$$;

revoke all on function smartgov.create_task_v2(text, text, text, date, time, text, text, boolean, jsonb, jsonb) from public;
