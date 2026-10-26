-- Request module: two corrections to 03111.
--
-- Both were caught by running the functions rather than by reading them, and
-- both are the kind of bug that only shows up in a live call.
--
--   1. `list_task_thread` did not run at all. Its reaction tally was written as
--      `jsonb_agg(jsonb_build_object(..., count(*), bool_or(...)))`, and Postgres
--      refuses to nest an aggregate inside an aggregate. The fix is a two-step:
--      tally per reaction in a grouped subquery, then aggregate those rows.
--
--   2. `create_task_v2` could leave a half-built task behind. It validated each
--      requirement inside the insert loop and `return`ed on a bad one -- but a
--      return is not a rollback, so the task row and its assignments stayed
--      committed with no checklist attached. Validation now runs before the
--      first insert, so the function cannot fail partway.
--
-- `list_task_thread` and `create_task_v2` are re-issued in full for the same
-- reason as 03113: one readable definition beats a chain of patches.

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
        -- A tombstone keeps its place in the thread but never its words.
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
        -- The tally is computed in a grouped subquery first and aggregated
        -- second. Postgres will not nest an aggregate inside jsonb_agg, so the
        -- two steps are required, not stylistic.
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

  -- Validate every requirement BEFORE the first insert. The earlier shape of
  -- this function validated during the insert loop and returned an error, which
  -- left the task and its assignments committed and the checklist missing -- a
  -- half-built task nobody could answer. A return is not a rollback, so the
  -- check has to come first.
  if p_requirements is not null and jsonb_typeof(p_requirements) = 'array' then
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

  -- Already validated above, so this loop cannot fail partway.
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

grant execute on function public.list_task_thread(text, uuid) to anon, authenticated, service_role;
grant execute on function public.create_task_v2(text, text, text, date, time, text, text, boolean, jsonb, jsonb) to anon, authenticated, service_role;
