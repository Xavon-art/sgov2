-- Fix task creation: when no units are selected, assign only LSG units (exclude the
-- USG root unit), and evaluate the deadline in the supplied timezone rather than
-- the session timezone.

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
  v_due_ts  timestamptz;
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

  if p_due_date is not null then
    if p_due_time is not null then
      if nullif(btrim(coalesce(p_due_timezone, '')), '') is null then
        return jsonb_build_object('ok', false, 'reason', 'invalid_request');
      end if;
      v_due_ts := (p_due_date + p_due_time) at time zone p_due_timezone;
    else
      v_due_ts := (p_due_date + time '23:59:59') at time zone coalesce(nullif(btrim(coalesce(p_due_timezone, '')), ''), 'UTC');
    end if;
    if v_due_ts < now() then
      return jsonb_build_object('ok', false, 'reason', 'past_deadline');
    end if;
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
    -- Default: assign to LSG units only (exclude the USG root).
    select coalesce(array_agg(gu.id), '{}'::uuid[]) into v_units
      from public.governance_units gu
     where gu.organization_id = v_account.organization_id
       and lower(gu.unit_type::text) <> 'usg';
    if array_length(v_units, 1) is null then
      return jsonb_build_object('ok', false, 'reason', 'no_unit');
    end if;
  else
    v_units := v_wanted;
  end if;

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