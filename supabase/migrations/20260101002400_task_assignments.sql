-- Task assignments and deadlines.
--
-- The shape decision, and it is the whole design: one task to twelve units is
-- twelve separate answers. A single `tasks.done` boolean cannot say that
-- Palayan submitted its liquidate-ticket on Tuesday and that Bayanan has not
-- started. So `tasks` holds the request and `task_assignments` holds one row per
-- unit per task, each with its own status. Counting progress is then a real join
-- rather than a guess.
--
-- `overdue` is computed in the read path, never stored. A stored boolean is wrong
-- the moment the clock passes midnight and nobody runs a job to fix it; a
-- generated column cannot reference `now()` anyway.
--
-- USG creates tasks and assigns them. An LSG officer may only move the status of
-- assignments addressed to their own unit, and only forward -- an officer cannot
-- mark their own work approved. `done` is USG's to grant.
--
-- House rule, unchanged: no RLS policy, no grant on either table. Every path in is
-- a `security definer` function that resolves the caller from the session token.

create table if not exists smartgov.tasks (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  title           text not null check (length(btrim(title)) between 4 and 140),
  details         text not null default '',
  -- Null means "no deadline", which is a real state: a standing reminder has no
  -- date. The column is nullable rather than defaulted to today so that the two
  -- are never confused in a list.
  due_date        date,
  priority        text not null default 'normal'
                  check (priority in ('low', 'normal', 'high')),
  created_by      uuid not null references smartgov.accounts (id),
  created_at      timestamptz not null default now()
);

-- One row per unit per task. The primary key is what makes "one task to twelve
-- units" impossible to duplicate, and it is also the row USG counts when it asks
-- "how many units are done".
create table if not exists smartgov.task_assignments (
  task_id      uuid not null references smartgov.tasks (id) on delete cascade,
  unit_id      uuid not null references public.governance_units (id) on delete cascade,
  status       text not null default 'assigned'
               check (status in ('assigned', 'in_progress', 'done')),
  note         text not null default '',
  updated_by   uuid references smartgov.accounts (id) on delete set null,
  updated_at   timestamptz not null default now(),
  primary key (task_id, unit_id)
);

create index if not exists task_assignments_unit_idx on smartgov.task_assignments (unit_id);
create index if not exists tasks_org_idx on smartgov.tasks (organization_id);
create index if not exists tasks_due_idx on smartgov.tasks (organization_id, due_date);

revoke all on smartgov.tasks from public, anon, authenticated;
revoke all on smartgov.task_assignments from public, anon, authenticated;

-- ------------------------------------------------------------------- create task
-- `p_unit_ids` may name one unit, several, or every unit in the organization:
-- an empty array means all of them. That is a convenience for USG, not a
-- privilege -- the expansion happens here, and a unit id the caller does not own
-- is refused rather than filtered out quietly.
create or replace function smartgov.create_task(
  p_session_token text,
  p_title         text,
  p_details       text,
  p_due_date      date,
  p_priority      text,
  p_unit_ids      jsonb
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
  v_unit    uuid;
  v_units   uuid[];
  v_wanted  uuid[];
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if not (v_account.account_scope = 'owner'
          or smartgov.is_org_reviewer(v_account.id, v_account.organization_id)) then
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

  -- A deadline that has already passed is refused rather than accepted as
  -- instantly overdue. USG means a date this office can still act on.
  if p_due_date is not null and p_due_date < current_date then
    return jsonb_build_object('ok', false, 'reason', 'past_deadline');
  end if;

  if jsonb_typeof(p_unit_ids) <> 'array' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  select coalesce(array_agg(distinct value::uuid), '{}'::uuid[])
    into v_wanted
    from jsonb_array_elements_text(p_unit_ids) as value
   where value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     and value::uuid in (select gu.id from public.governance_units gu
                          where gu.organization_id = v_account.organization_id);

  -- An empty array was asked for directly, or every id was refused. Either way
  -- there is nothing to assign, and a task nobody has to do is a bug at the
  -- caller's end rather than an empty task.
  if array_length(v_wanted, 1) is null then
    select coalesce(array_agg(gu.id), '{}'::uuid[])
      into v_units
      from public.governance_units gu
     where gu.organization_id = v_account.organization_id;

    if array_length(v_units, 1) is null then
      return jsonb_build_object('ok', false, 'reason', 'no_unit');
    end if;
  else
    v_units := v_wanted;
  end if;

  insert into smartgov.tasks
    (organization_id, title, details, due_date, priority, created_by)
  values
    (v_account.organization_id, v_title,
     btrim(coalesce(p_details, '')), p_due_date, v_prio, v_account.id)
  returning id into v_task;

  insert into smartgov.task_assignments (task_id, unit_id)
  select v_task, unnest(v_units);

  return jsonb_build_object(
    'ok', true,
    'taskId', v_task,
    'assignedUnits', array_length(v_units, 1),
    'dueDate', p_due_date
  );
end;
$$;

revoke all on function smartgov.create_task(text, text, text, date, text, jsonb) from public;

-- ------------------------------------------------------------------- list tasks
-- The same scope split the budget list uses: USG sees the organization, an LSG
-- officer sees only tasks addressed to their own unit, derived from their own
-- membership rather than from anything they send.
--
-- `daysLeft` is computed here so both workspaces countdown from one number, and
-- `overdue` is derived from `due_date` and `status` at read time -- a request that
-- crossed its deadline reads as overdue immediately, with no job to run.
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
                       where ta.task_id = t.id), '') <> 'done'),
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
                       where ta.task_id = t.id and ta.status = 'done'),
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

-- ------------------------------------------------------------------- move a task
-- Forward-only, and this is the rule worth reading twice. An LSG officer may
-- report progress but may not grant completion: `done` is what the office counts
-- when it decides whether a unit has complied, so it is USG's answer to give. A
-- USG caller may set any status on any unit.
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
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if p_status not in ('assigned', 'in_progress', 'done') then
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
    -- The assignment has to exist and be addressed to the caller's own unit.
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

    -- An officer can start, but only USG can mark done.
    if p_status = 'done' then
      return jsonb_build_object('ok', false, 'reason', 'not_your_decision');
    end if;
  end if;

  update smartgov.task_assignments
     set status = p_status,
         note = btrim(coalesce(p_note, '')),
         updated_by = v_account.id,
         updated_at = now()
   where task_id = p_task_id and unit_id = p_unit_id;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  return jsonb_build_object('ok', true, 'taskId', p_task_id, 'unitId', p_unit_id, 'status', p_status);
end;
$$;

revoke all on function smartgov.update_task_status(text, uuid, uuid, text, text) from public;

-- ------------------------------------------------------------------- public forwarders

create or replace function public.create_task(p_session_token text, p_title text, p_details text, p_due_date date, p_priority text, p_unit_ids jsonb)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.create_task(p_session_token, p_title, p_details, p_due_date, p_priority, p_unit_ids); $$;
revoke all on function public.create_task(text, text, text, date, text, jsonb) from public;
grant execute on function public.create_task(text, text, text, date, text, jsonb) to anon, authenticated;

create or replace function public.list_tasks(p_session_token text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.list_tasks(p_session_token); $$;
revoke all on function public.list_tasks(text) from public;
grant execute on function public.list_tasks(text) to anon, authenticated;

create or replace function public.update_task_status(p_session_token text, p_task_id uuid, p_unit_id uuid, p_status text, p_note text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.update_task_status(p_session_token, p_task_id, p_unit_id, p_status, p_note); $$;
revoke all on function public.update_task_status(text, uuid, uuid, text, text) from public;
grant execute on function public.update_task_status(text, uuid, uuid, text, text) to anon, authenticated;