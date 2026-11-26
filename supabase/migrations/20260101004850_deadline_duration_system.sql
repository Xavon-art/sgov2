alter table smartgov.tasks
  add column if not exists assigned_at timestamptz,
  add column if not exists due_at timestamptz,
  add column if not exists grace_period_minutes integer not null default 0,
  add column if not exists review_sla_days integer,
  add column if not exists auto_closed_at timestamptz,
  add column if not exists reopened_at timestamptz,
  add column if not exists reopened_by uuid references smartgov.accounts (id) on delete set null;

alter table smartgov.task_assignments
  add column if not exists assigned_at timestamptz,
  add column if not exists due_at timestamptz,
  add column if not exists grace_period_minutes integer not null default 0,
  add column if not exists auto_close boolean not null default false,
  add column if not exists review_sla_days integer,
  add column if not exists auto_closed_at timestamptz,
  add column if not exists reopened_at timestamptz,
  add column if not exists reopened_by uuid references smartgov.accounts (id) on delete set null;

alter table smartgov.task_requirements
  add column if not exists assigned_at timestamptz,
  add column if not exists due_at timestamptz,
  add column if not exists grace_period_minutes integer not null default 0,
  add column if not exists auto_close boolean not null default false,
  add column if not exists review_sla_days integer;

alter table smartgov.task_extensions
  add column if not exists requested_due_at timestamptz,
  alter column requested_days drop not null;

alter table smartgov.tasks drop constraint if exists tasks_grace_period_minutes_check;
alter table smartgov.tasks add constraint tasks_grace_period_minutes_check
  check (grace_period_minutes between 0 and 10080);
alter table smartgov.tasks drop constraint if exists tasks_review_sla_days_check;
alter table smartgov.tasks add constraint tasks_review_sla_days_check
  check (review_sla_days is null or review_sla_days between 1 and 30);

alter table smartgov.task_assignments drop constraint if exists task_assignments_grace_period_minutes_check;
alter table smartgov.task_assignments add constraint task_assignments_grace_period_minutes_check
  check (grace_period_minutes between 0 and 10080);
alter table smartgov.task_assignments drop constraint if exists task_assignments_review_sla_days_check;
alter table smartgov.task_assignments add constraint task_assignments_review_sla_days_check
  check (review_sla_days is null or review_sla_days between 1 and 30);

alter table smartgov.task_requirements drop constraint if exists task_requirements_grace_period_minutes_check;
alter table smartgov.task_requirements add constraint task_requirements_grace_period_minutes_check
  check (grace_period_minutes between 0 and 10080);
alter table smartgov.task_requirements drop constraint if exists task_requirements_review_sla_days_check;
alter table smartgov.task_requirements add constraint task_requirements_review_sla_days_check
  check (review_sla_days is null or review_sla_days between 1 and 30);

alter table smartgov.task_extensions drop constraint if exists task_extensions_requested_days_check;
alter table smartgov.task_extensions add constraint task_extensions_requested_days_check
  check (requested_days is null or requested_days between 1 and 30);
alter table smartgov.task_extensions drop constraint if exists task_extensions_status_check;
update smartgov.task_extensions
   set status = case status when 'granted' then 'approved' when 'denied' then 'rejected' else status end
 where status in ('granted', 'denied');
alter table smartgov.task_extensions add constraint task_extensions_status_check
  check (status in ('pending', 'approved', 'rejected'));

delete from smartgov.task_extensions e
 using smartgov.task_extensions d
 where e.id > d.id
   and e.task_id = d.task_id
   and e.unit_id = d.unit_id
   and e.status = 'pending'
   and d.status = 'pending';

create unique index if not exists task_extensions_pending_unique
  on smartgov.task_extensions (task_id, unit_id) where status = 'pending';

update smartgov.task_extensions
   set requested_days = least(30, greatest(1, ceil(extract(epoch from (requested_due_at - now())) / 86400)::int))
 where requested_due_at is not null
   and requested_days is null;

update smartgov.tasks
   set assigned_at = coalesce(assigned_at, created_at),
       due_at = coalesce(
         due_at,
         ((due_date + coalesce(due_time, time '23:59:59'))
            at time zone coalesce(nullif(btrim(due_timezone), ''), 'UTC'))
       )
 where due_date is not null;

update smartgov.tasks
   set assigned_at = coalesce(assigned_at, created_at)
 where assigned_at is null;

update smartgov.task_assignments a
   set assigned_at = coalesce(a.assigned_at, t.created_at, now()),
       due_at = coalesce(a.due_at, t.due_at),
       grace_period_minutes = t.grace_period_minutes,
       auto_close = t.auto_close,
       review_sla_days = t.review_sla_days
  from smartgov.tasks t
 where t.id = a.task_id;

update smartgov.task_requirements r
   set assigned_at = coalesce(r.assigned_at, t.created_at, now()),
       due_at = coalesce(r.due_at, t.due_at),
       grace_period_minutes = t.grace_period_minutes,
       auto_close = t.auto_close,
       review_sla_days = t.review_sla_days
  from smartgov.tasks t
 where t.id = r.task_id;

update smartgov.tasks t
   set due_date = ((t.due_at + make_interval(mins => t.grace_period_minutes))
                   at time zone coalesce(nullif(btrim(t.due_timezone), ''), 'UTC'))::date,
       due_time = ((t.due_at + make_interval(mins => t.grace_period_minutes))
                   at time zone coalesce(nullif(btrim(t.due_timezone), ''), 'UTC'))::time
 where t.auto_close
   and t.due_at is not null
   and t.grace_period_minutes > 0;

create table if not exists smartgov.task_deadline_reminders (
  task_id uuid not null references smartgov.tasks (id) on delete cascade,
  unit_id uuid not null references public.governance_units (id) on delete cascade,
  window_key text not null check (window_key in ('3d', '1d', '3h')),
  created_at timestamptz not null default now(),
  primary key (task_id, unit_id, window_key)
);

create table if not exists smartgov.task_review_reminders (
  task_id uuid not null references smartgov.tasks (id) on delete cascade,
  unit_id uuid not null references public.governance_units (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (task_id, unit_id)
);

create or replace function smartgov.task_due_at(p_task_id uuid)
returns timestamptz
language sql stable
set search_path = public, extensions, smartgov, pg_temp
as $$
  select coalesce(
    t.due_at,
    ((t.due_date + coalesce(t.due_time, time '23:59:59'))
       at time zone coalesce(nullif(btrim(t.due_timezone), ''), 'UTC'))
  )
    from smartgov.tasks t
   where t.id = p_task_id;
$$;

create or replace function smartgov.task_lock_at(p_task_id uuid)
returns timestamptz
language sql stable
set search_path = public, extensions, smartgov, pg_temp
as $$
  select smartgov.task_due_at(p_task_id) + make_interval(mins => coalesce(t.grace_period_minutes, 0))
    from smartgov.tasks t
   where t.id = p_task_id;
$$;

create or replace function smartgov.task_is_locked(p_task_id uuid)
returns boolean
language sql stable
set search_path = public, extensions, smartgov, pg_temp
as $$
  select exists (
    select 1
      from smartgov.tasks t
     where t.id = p_task_id
       and (
         t.closed_at is not null
         or (
           t.auto_close
           and smartgov.task_lock_at(p_task_id) is not null
           and smartgov.task_lock_at(p_task_id) <= now()
         )
       )
  );
$$;

create or replace function smartgov.assignment_effective_status(p_task_id uuid, p_unit_id uuid)
returns text
language sql stable
set search_path = public, extensions, smartgov, pg_temp
as $$
  select case
           when ta.status in ('pending', 'draft', 'returned')
            and t.closed_at is null
            and smartgov.task_due_at(p_task_id) is not null
            and smartgov.task_due_at(p_task_id) < now()
             then 'overdue'
           else ta.status
         end
    from smartgov.task_assignments ta
    join smartgov.tasks t on t.id = ta.task_id
   where ta.task_id = p_task_id
     and ta.unit_id = p_unit_id;
$$;

create or replace function smartgov.review_due_at(p_task_id uuid, p_unit_id uuid)
returns timestamptz
language sql stable
set search_path = public, extensions, smartgov, pg_temp
as $$
  select case
           when ta.review_opened_at is null then null
           else ta.review_opened_at + make_interval(days => coalesce(ta.review_sla_days, t.review_sla_days, 3))
         end
    from smartgov.task_assignments ta
    join smartgov.tasks t on t.id = ta.task_id
   where ta.task_id = p_task_id
     and ta.unit_id = p_unit_id;
$$;

create or replace function smartgov.auto_close_deadlines()
returns jsonb
language plpgsql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_task record;
  v_count integer := 0;
begin
  for v_task in
    select t.*
      from smartgov.tasks t
     where t.auto_close
       and t.closed_at is null
       and t.auto_closed_at is null
       and smartgov.task_lock_at(t.id) is not null
       and smartgov.task_lock_at(t.id) <= now()
  loop
    update smartgov.tasks
       set closed_at = now(),
           auto_closed_at = now(),
           closing_note = case
             when btrim(coalesce(closing_note, '')) = '' then 'Auto-closed after the deadline.'
             else closing_note
           end
     where id = v_task.id
       and closed_at is null
       and auto_closed_at is null;

    if found then
      v_count := v_count + 1;

      update smartgov.task_assignments
         set auto_closed_at = now()
       where task_id = v_task.id
         and auto_closed_at is null
         and status not in ('approved', 'rejected');

      insert into smartgov.notifications (account_id, organization_id, kind, title, body, link)
      values
        (v_task.created_by, v_task.organization_id, 'task_closed',
         'Task auto-closed',
         v_task.title || ' closed after its deadline.',
         '/usg/request');

      insert into smartgov.notifications (account_id, organization_id, kind, title, body, link)
      select distinct a.id, a.organization_id, 'task_closed',
             'Task closed',
             v_task.title || ' closed after its deadline.',
             '/lsg/request'
        from smartgov.task_assignments ta
        join smartgov.unit_memberships m
          on m.unit_id = ta.unit_id
         and (m.end_date is null or m.end_date >= current_date)
        join smartgov.roster r
          on r.id = m.roster_id
         and r.account_id is not null
        join smartgov.accounts a
          on a.id = r.account_id
       where ta.task_id = v_task.id
         and a.status = 'active';

      insert into smartgov.audit_log (organization_id, actor_id, action, target_type, target_id, detail)
      values
        (v_task.organization_id, null, 'task.auto_closed', 'task', v_task.id,
         jsonb_build_object('title', v_task.title));
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'autoClosed', v_count);
end;
$$;

create or replace function smartgov.send_deadline_reminders()
returns jsonb
language plpgsql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_result jsonb;
  v_auto_closed integer;
  v_item record;
  v_windows text[] := array['3d', '1d', '3h'];
  v_intervals interval[] := array[interval '3 days', interval '1 day', interval '3 hours'];
  v_window text;
  v_label text;
  v_threshold timestamptz;
  v_due timestamptz;
  v_i integer;
  v_sent integer := 0;
  v_review_sent integer := 0;
begin
  v_result := smartgov.auto_close_deadlines();
  v_auto_closed := coalesce((v_result ->> 'autoClosed')::integer, 0);

  for v_item in
    select ta.task_id,
           ta.unit_id,
           t.organization_id,
           t.title,
           smartgov.task_due_at(t.id) as due_at,
           (select gu.name from public.governance_units gu where gu.id = ta.unit_id) as unit_name
      from smartgov.task_assignments ta
      join smartgov.tasks t on t.id = ta.task_id
     where ta.status in ('pending', 'draft', 'returned')
       and t.closed_at is null
       and smartgov.task_due_at(t.id) is not null
       and smartgov.task_due_at(t.id) > now()
       and not smartgov.task_is_locked(t.id)
  loop
    v_due := v_item.due_at;
    for v_i in 1 .. array_length(v_windows, 1) loop
      v_window := v_windows[v_i];
      v_threshold := v_due - v_intervals[v_i];
      v_label := case v_window when '3d' then '3 days' when '1d' then '1 day' else '3 hours' end;

      if now() >= v_threshold then
        insert into smartgov.task_deadline_reminders (task_id, unit_id, window_key)
        values (v_item.task_id, v_item.unit_id, v_window)
        on conflict do nothing;

        if found then
          v_sent := v_sent + 1;

          insert into smartgov.notifications (account_id, organization_id, kind, title, body, link)
          select distinct a.id, v_item.organization_id, 'task_deadline_reminder',
                 'Task due in ' || v_label,
                 v_item.title || ' for ' || coalesce(v_item.unit_name, 'your unit') || ' is due in ' || v_label || '.',
                 '/lsg/request'
            from smartgov.unit_memberships m
            join smartgov.roster r
              on r.id = m.roster_id
             and r.account_id is not null
            join smartgov.accounts a
              on a.id = r.account_id
           where m.unit_id = v_item.unit_id
             and (m.end_date is null or m.end_date >= current_date)
             and a.status = 'active';

          insert into smartgov.email_queue (to_address, subject, html, text_body)
          select distinct a.email,
                 'Task due in ' || v_label,
                 '<p>' || v_item.title || ' for ' || coalesce(v_item.unit_name, 'your unit') || ' is due in ' || v_label || '.</p>',
                 v_item.title || ' for ' || coalesce(v_item.unit_name, 'your unit') || ' is due in ' || v_label || '.'
            from smartgov.unit_memberships m
            join smartgov.roster r
              on r.id = m.roster_id
             and r.account_id is not null
            join smartgov.accounts a
              on a.id = r.account_id
           where m.unit_id = v_item.unit_id
             and (m.end_date is null or m.end_date >= current_date)
             and a.status = 'active';
        end if;
      end if;
    end loop;
  end loop;

  for v_item in
    select ta.task_id,
           ta.unit_id,
           t.organization_id,
           t.title,
           (select gu.name from public.governance_units gu where gu.id = ta.unit_id) as unit_name,
           smartgov.review_due_at(ta.task_id, ta.unit_id) as review_at
      from smartgov.task_assignments ta
      join smartgov.tasks t on t.id = ta.task_id
     where ta.status = 'under_review'
       and ta.review_opened_at is not null
       and smartgov.review_due_at(ta.task_id, ta.unit_id) is not null
       and smartgov.review_due_at(ta.task_id, ta.unit_id) <= now()
  loop
    insert into smartgov.task_review_reminders (task_id, unit_id)
    values (v_item.task_id, v_item.unit_id)
    on conflict do nothing;

    if found then
      v_review_sent := v_review_sent + 1;

      insert into smartgov.notifications (account_id, organization_id, kind, title, body, link)
      select a.id, v_item.organization_id, 'task_review_sla_overdue',
             'Review SLA passed',
             v_item.title || ' from ' || coalesce(v_item.unit_name, 'a unit') || ' is past its review window.',
             '/usg/request'
        from smartgov.accounts a
       where a.organization_id = v_item.organization_id
         and a.status = 'active'
         and smartgov.is_usg(a.id, a.organization_id);
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'autoClosed', v_auto_closed,
    'remindersSent', v_sent,
    'reviewRemindersSent', v_review_sent
  );
end;
$$;

create or replace function public.send_deadline_reminders()
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.send_deadline_reminders(); $$;

revoke all on function public.send_deadline_reminders() from public;
grant execute on function public.send_deadline_reminders() to anon, authenticated, service_role;

create or replace function smartgov.request_task_extension(
  p_session_token text,
  p_task_id uuid,
  p_unit_id uuid,
  p_requested_due_at timestamptz,
  p_reason text
)
returns jsonb
language plpgsql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_task smartgov.tasks%rowtype;
  v_units uuid[];
  v_id uuid;
  v_days integer;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then return jsonb_build_object('ok', false, 'reason', 'unauthenticated'); end if;

  select coalesce(array_agg(u), '{}'::uuid[]) into v_units
    from smartgov.lsg_unit_ids(v_account.id, v_account.organization_id) u;
  if not (p_unit_id = any (v_units)) then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;

  select t.* into v_task
    from smartgov.tasks t
   where t.id = p_task_id
     and t.organization_id = v_account.organization_id;
  if v_task.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if smartgov.task_is_locked(p_task_id) then return jsonb_build_object('ok', false, 'reason', 'task_closed'); end if;
  if not exists (select 1 from smartgov.task_assignments ta where ta.task_id = p_task_id and ta.unit_id = p_unit_id) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if p_requested_due_at is null or p_requested_due_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'past_deadline');
  end if;
  if p_requested_due_at > now() + interval '365 days' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;
  if exists (
    select 1 from smartgov.task_extensions e
     where e.task_id = p_task_id and e.unit_id = p_unit_id and e.status = 'pending'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'extension_pending');
  end if;

  v_days := least(30, greatest(1, ceil(extract(epoch from (p_requested_due_at - now())) / 86400)::int));

  insert into smartgov.task_extensions
    (task_id, unit_id, requested_by, requested_days, requested_due_at, reason)
  values
    (p_task_id, p_unit_id, v_account.id, v_days, p_requested_due_at, btrim(p_reason))
  returning id into v_id;

  insert into smartgov.notifications (account_id, organization_id, kind, title, body, link)
  select a.id, v_task.organization_id, 'task_extension_requested',
         'Extension requested',
         v_task.title || ' has a new extension request from ' || coalesce(
           (select gu.name from public.governance_units gu where gu.id = p_unit_id), 'a unit') || '.',
         '/usg/request'
    from smartgov.accounts a
   where a.organization_id = v_task.organization_id
     and a.status = 'active'
     and smartgov.is_usg(a.id, a.organization_id);

  return jsonb_build_object('ok', true, 'extensionId', v_id);
end;
$$;

create or replace function smartgov.decide_task_extension(
  p_session_token text,
  p_extension_id uuid,
  p_decision text,
  p_note text
)
returns jsonb
language plpgsql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_ext smartgov.task_extensions%rowtype;
  v_task smartgov.tasks%rowtype;
  v_dec text := lower(trim(coalesce(p_decision, '')));
  v_note text := btrim(coalesce(p_note, ''));
  v_tz text;
  v_stored_ts timestamptz;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then return jsonb_build_object('ok', false, 'reason', 'unauthenticated'); end if;
  if not smartgov.is_usg(v_account.id, v_account.organization_id) then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;

  if v_dec = 'granted' then v_dec := 'approved'; end if;
  if v_dec = 'denied' then v_dec := 'rejected'; end if;
  if v_dec not in ('approved', 'rejected') then return jsonb_build_object('ok', false, 'reason', 'invalid_request'); end if;
  if v_dec = 'rejected' and length(v_note) < 2 then
    return jsonb_build_object('ok', false, 'reason', 'remark_required');
  end if;

  select e.* into v_ext from smartgov.task_extensions e where e.id = p_extension_id;
  if v_ext.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_ext.status <> 'pending' then return jsonb_build_object('ok', false, 'reason', 'already_decided'); end if;
  if v_dec = 'approved' and v_ext.requested_due_at is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  select t.* into v_task from smartgov.tasks t where t.id = v_ext.task_id and t.organization_id = v_account.organization_id;
  if v_task.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;

  update smartgov.task_extensions
     set status = v_dec,
         decided_by = v_account.id,
         decided_at = now(),
         decision_note = v_note
   where id = p_extension_id;

  if v_dec = 'approved' then
    v_tz := coalesce(nullif(btrim(v_task.due_timezone), ''), 'UTC');
    v_stored_ts := case
      when v_task.auto_close and v_task.grace_period_minutes > 0
        then v_ext.requested_due_at + make_interval(mins => v_task.grace_period_minutes)
      else v_ext.requested_due_at
    end;

    update smartgov.tasks
       set due_at = v_ext.requested_due_at,
           due_date = (v_stored_ts at time zone v_tz)::date,
           due_time = (v_stored_ts at time zone v_tz)::time,
           closed_at = null,
           auto_closed_at = null,
           reopened_at = now(),
           reopened_by = v_account.id
     where id = v_task.id;

    update smartgov.task_assignments
       set due_at = v_ext.requested_due_at,
           auto_closed_at = null,
           reopened_at = now(),
           reopened_by = v_account.id
     where task_id = v_task.id;

    update smartgov.task_requirements
       set due_at = v_ext.requested_due_at
     where task_id = v_task.id;
  end if;

  insert into smartgov.notifications (account_id, organization_id, kind, title, body, link)
  select v_ext.requested_by, v_task.organization_id,
         case when v_dec = 'approved' then 'task_extension_approved' else 'task_extension_rejected' end,
         case when v_dec = 'approved' then 'Extension approved' else 'Extension declined' end,
         v_task.title || case
           when v_dec = 'approved'
             then ' now has a new deadline.'
           else ' extension was declined. ' || case when v_note = '' then '' else 'Note: ' || v_note end
         end,
         '/lsg/request';

  insert into smartgov.notifications (account_id, organization_id, kind, title, body, link)
  select distinct a.id, v_task.organization_id,
         case when v_dec = 'approved' then 'task_extension_approved' else 'task_extension_rejected' end,
         case when v_dec = 'approved' then 'Extension approved' else 'Extension declined' end,
         v_task.title || case when v_dec = 'approved' then ' now has a new deadline.' else ' extension was declined.' end,
         '/lsg/request'
    from smartgov.unit_memberships m
    join smartgov.roster r
      on r.id = m.roster_id
     and r.account_id is not null
    join smartgov.accounts a
      on a.id = r.account_id
   where m.unit_id = v_ext.unit_id
     and (m.end_date is null or m.end_date >= current_date)
     and a.status = 'active'
     and a.id <> v_ext.requested_by;

  insert into smartgov.audit_log (organization_id, actor_id, action, target_type, target_id, detail)
  values
    (v_task.organization_id, v_account.id,
     case when v_dec = 'approved' then 'task_extension.approved' else 'task_extension.rejected' end,
     'task', v_task.id,
     jsonb_build_object('extensionId', v_ext.id, 'unitId', v_ext.unit_id, 'note', v_note));

  return jsonb_build_object('ok', true, 'status', v_dec);
end;
$$;

create or replace function smartgov.list_task_extensions(
  p_session_token text,
  p_task_id uuid
)
returns jsonb
language plpgsql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_units uuid[];
  v_is_usg boolean;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then return jsonb_build_object('ok', false, 'reason', 'unauthenticated'); end if;

  v_is_usg := smartgov.is_usg(v_account.id, v_account.organization_id);
  select coalesce(array_agg(u), '{}'::uuid[]) into v_units
    from smartgov.lsg_unit_ids(v_account.id, v_account.organization_id) u;

  return jsonb_build_object('ok', true, 'extensions', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', e.id,
      'taskId', e.task_id,
      'unitId', e.unit_id,
      'unitName', (select gu.name from public.governance_units gu where gu.id = e.unit_id),
      'requestedDays', e.requested_days,
      'requestedDueAt', e.requested_due_at,
      'reason', e.reason,
      'status', e.status,
      'decisionNote', e.decision_note,
      'decidedAt', e.decided_at,
      'createdAt', e.created_at
    ) order by e.created_at desc)
      from smartgov.task_extensions e
      join smartgov.tasks t on t.id = e.task_id
     where e.task_id = p_task_id
       and t.organization_id = v_account.organization_id
       and (v_is_usg or e.unit_id = any (v_units))
  ), '[]'::jsonb));
end;
$$;

drop function if exists smartgov.request_task_extension(text, uuid, uuid, integer, text);
drop function if exists public.request_task_extension(text, uuid, uuid, integer, text);
drop function if exists public.decide_task_extension(text, uuid, text, text);
drop function if exists public.list_task_extensions(text, uuid);

create or replace function public.request_task_extension(
  p_session_token text, p_task_id uuid, p_unit_id uuid, p_requested_due_at timestamptz, p_reason text
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.request_task_extension($1, $2, $3, $4, $5); $$;

create or replace function public.decide_task_extension(
  p_session_token text, p_extension_id uuid, p_decision text, p_note text
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.decide_task_extension($1, $2, $3, $4); $$;

create or replace function public.list_task_extensions(p_session_token text, p_task_id uuid)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.list_task_extensions($1, $2); $$;

grant execute on function public.request_task_extension(text, uuid, uuid, timestamptz, text) to anon, authenticated, service_role;
grant execute on function public.decide_task_extension(text, uuid, text, text) to anon, authenticated, service_role;
grant execute on function public.list_task_extensions(text, uuid) to anon, authenticated, service_role;

create or replace function smartgov.reopen_task(
  p_session_token text,
  p_task_id uuid,
  p_new_due_at timestamptz,
  p_note text
)
returns jsonb
language plpgsql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_task smartgov.tasks%rowtype;
  v_tz text;
  v_stored_ts timestamptz;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then return jsonb_build_object('ok', false, 'reason', 'unauthenticated'); end if;
  if not smartgov.is_usg(v_account.id, v_account.organization_id) then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;

  select t.* into v_task from smartgov.tasks t
   where t.id = p_task_id and t.organization_id = v_account.organization_id;
  if v_task.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if p_new_due_at is null or p_new_due_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'past_deadline');
  end if;
  if length(btrim(coalesce(p_note, ''))) < 2 then
    return jsonb_build_object('ok', false, 'reason', 'remark_required');
  end if;

  v_tz := coalesce(nullif(btrim(v_task.due_timezone), ''), 'UTC');
  v_stored_ts := case
    when v_task.auto_close and v_task.grace_period_minutes > 0
      then p_new_due_at + make_interval(mins => v_task.grace_period_minutes)
    else p_new_due_at
  end;

  update smartgov.tasks
     set due_at = p_new_due_at,
         due_date = (v_stored_ts at time zone v_tz)::date,
         due_time = (v_stored_ts at time zone v_tz)::time,
         closed_at = null,
         auto_closed_at = null,
         reopened_at = now(),
         reopened_by = v_account.id,
         closing_note = btrim(p_note)
   where id = p_task_id;

  update smartgov.task_assignments
     set due_at = p_new_due_at,
         auto_closed_at = null,
         reopened_at = now(),
         reopened_by = v_account.id
   where task_id = p_task_id;

  update smartgov.task_requirements
     set due_at = p_new_due_at
   where task_id = p_task_id;

  delete from smartgov.task_deadline_reminders where task_id = p_task_id;
  delete from smartgov.task_review_reminders where task_id = p_task_id;

  insert into smartgov.notifications (account_id, organization_id, kind, title, body, link)
  select distinct a.id, v_task.organization_id, 'task_reopened',
         'Task reopened',
         v_task.title || ' was reopened. New deadline: ' || to_char(p_new_due_at at time zone v_tz, 'YYYY-MM-DD HH24:MI') || ' ' || v_tz || '.',
         '/lsg/request'
    from smartgov.task_assignments ta
    join smartgov.unit_memberships m
      on m.unit_id = ta.unit_id
     and (m.end_date is null or m.end_date >= current_date)
    join smartgov.roster r
      on r.id = m.roster_id
     and r.account_id is not null
    join smartgov.accounts a
      on a.id = r.account_id
   where ta.task_id = p_task_id
     and a.status = 'active';

  insert into smartgov.audit_log (organization_id, actor_id, action, target_type, target_id, detail)
  values
    (v_task.organization_id, v_account.id, 'task.reopened', 'task', p_task_id,
     jsonb_build_object('dueAt', p_new_due_at, 'note', btrim(p_note)));

  return jsonb_build_object('ok', true, 'dueAt', p_new_due_at);
end;
$$;

create or replace function public.reopen_task(
  p_session_token text, p_task_id uuid, p_new_due_at timestamptz, p_note text
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.reopen_task($1, $2, $3, $4); $$;

revoke all on function public.reopen_task(text, uuid, timestamptz, text) from public;
grant execute on function public.reopen_task(text, uuid, timestamptz, text) to anon, authenticated, service_role;

create or replace function smartgov.create_task_v2(
  p_session_token text,
  p_title text,
  p_details text,
  p_due_date date,
  p_due_time time,
  p_due_timezone text,
  p_priority text,
  p_auto_close boolean,
  p_unit_ids jsonb,
  p_requirements jsonb,
  p_grace_period_minutes integer,
  p_review_sla_days integer
)
returns jsonb
language plpgsql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_title text;
  v_prio text;
  v_task uuid;
  v_units uuid[];
  v_wanted uuid[];
  v_req jsonb;
  v_pos integer := 0;
  v_label text;
  v_types jsonb;
  v_due_ts timestamptz;
  v_stored_ts timestamptz;
  v_tz text;
  v_grace integer := coalesce(p_grace_period_minutes, 0);
  v_sla integer := p_review_sla_days;
  v_max bigint;
  v_req_due timestamptz;
  v_req_grace integer;
  v_req_sla integer;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then return jsonb_build_object('ok', false, 'reason', 'unauthenticated'); end if;
  if not smartgov.is_usg(v_account.id, v_account.organization_id) then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;

  v_title := btrim(coalesce(p_title, ''));
  if length(v_title) < 4 or length(v_title) > 140 then return jsonb_build_object('ok', false, 'reason', 'invalid_title'); end if;

  v_prio := coalesce(nullif(btrim(coalesce(p_priority, '')), ''), 'normal');
  if v_prio not in ('low', 'normal', 'high') then return jsonb_build_object('ok', false, 'reason', 'invalid_request'); end if;
  if v_grace < 0 or v_grace > 10080 then return jsonb_build_object('ok', false, 'reason', 'invalid_request'); end if;
  if v_sla is not null and (v_sla < 1 or v_sla > 30) then return jsonb_build_object('ok', false, 'reason', 'invalid_request'); end if;

  v_tz := coalesce(nullif(btrim(coalesce(p_due_timezone, '')), ''), 'UTC');

  if p_due_date is not null then
    if p_due_time is not null then
      if nullif(btrim(coalesce(p_due_timezone, '')), '') is null then
        return jsonb_build_object('ok', false, 'reason', 'invalid_request');
      end if;
      v_due_ts := (p_due_date + p_due_time) at time zone p_due_timezone;
    else
      v_due_ts := (p_due_date + time '23:59:59') at time zone v_tz;
    end if;
    if v_due_ts < now() then return jsonb_build_object('ok', false, 'reason', 'past_deadline'); end if;
  end if;

  v_stored_ts := case
    when coalesce(p_auto_close, false) and v_grace > 0
      then v_due_ts + make_interval(mins => v_grace)
    else v_due_ts
  end;

  if jsonb_typeof(p_unit_ids) <> 'array' then return jsonb_build_object('ok', false, 'reason', 'invalid_request'); end if;

  select coalesce(array_agg(distinct value::uuid), '{}'::uuid[]) into v_wanted
    from jsonb_array_elements_text(p_unit_ids) as value
   where value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     and value::uuid in (select gu.id from public.governance_units gu where gu.organization_id = v_account.organization_id);

  if array_length(v_wanted, 1) is null then
    select coalesce(array_agg(gu.id), '{}'::uuid[]) into v_units
      from public.governance_units gu
     where gu.organization_id = v_account.organization_id
       and lower(gu.unit_type::text) <> 'usg';
    if array_length(v_units, 1) is null then return jsonb_build_object('ok', false, 'reason', 'no_unit'); end if;
  else
    v_units := v_wanted;
  end if;

  if p_requirements is not null and jsonb_typeof(p_requirements) = 'array' then
    for v_req in select * from jsonb_array_elements(p_requirements) loop
      v_label := btrim(coalesce(v_req ->> 'label', ''));
      if length(v_label) < 2 or length(v_label) > 160 then return jsonb_build_object('ok', false, 'reason', 'invalid_requirement'); end if;
      if jsonb_typeof(coalesce(v_req -> 'acceptedTypes', '[]'::jsonb)) <> 'array' then
        return jsonb_build_object('ok', false, 'reason', 'invalid_requirement');
      end if;
    end loop;
  end if;

  insert into smartgov.tasks
    (organization_id, title, details, due_date, due_time, due_timezone,
     priority, auto_close, created_by, assigned_at, due_at,
     grace_period_minutes, review_sla_days)
  values
    (v_account.organization_id, v_title, btrim(coalesce(p_details, '')),
     case when v_stored_ts is null then null else (v_stored_ts at time zone v_tz)::date end,
     case when v_stored_ts is null then null else (v_stored_ts at time zone v_tz)::time end,
     nullif(btrim(coalesce(p_due_timezone, '')), ''),
     v_prio, coalesce(p_auto_close, false), v_account.id, now(), v_due_ts,
     v_grace, v_sla)
  returning id into v_task;

  insert into smartgov.task_assignments
    (task_id, unit_id, assigned_at, due_at, grace_period_minutes, auto_close, review_sla_days)
  select v_task, unnest(v_units), now(), v_due_ts, v_grace, coalesce(p_auto_close, false), v_sla;

  if p_requirements is not null and jsonb_typeof(p_requirements) = 'array' then
    for v_req in select * from jsonb_array_elements(p_requirements) loop
      v_pos := v_pos + 1;
      v_types := coalesce(v_req -> 'acceptedTypes', '[]'::jsonb);
      v_max := case when (v_req ->> 'maxSizeBytes') ~ '^[0-9]+$' then (v_req ->> 'maxSizeBytes')::bigint else null end;
      v_req_due := case
        when nullif(btrim(coalesce(v_req ->> 'dueAt', '')), '') is not null
          then (v_req ->> 'dueAt')::timestamptz
        else v_due_ts
      end;
      v_req_grace := case
        when (v_req ->> 'gracePeriodMinutes') ~ '^[0-9]+$' then least(10080, (v_req ->> 'gracePeriodMinutes')::integer)
        else v_grace
      end;
      v_req_sla := case
        when (v_req ->> 'reviewSlaDays') ~ '^[0-9]+$' then least(30, greatest(1, (v_req ->> 'reviewSlaDays')::integer))
        else v_sla
      end;

      insert into smartgov.task_requirements
        (task_id, position, label, instructions, accepted_types, required, sample_file,
         max_size_bytes, rules, template_file,
         assigned_at, due_at, grace_period_minutes, auto_close, review_sla_days)
      values
        (v_task, v_pos, btrim(coalesce(v_req ->> 'label', '')),
         btrim(coalesce(v_req ->> 'instructions', '')),
         v_types,
         coalesce((v_req ->> 'required')::boolean, true),
         v_req -> 'sampleFile',
         v_max,
         nullif(btrim(coalesce(v_req ->> 'rules', '')), ''),
         v_req -> 'templateFile',
         now(), v_req_due, v_req_grace, coalesce(p_auto_close, false), v_req_sla);
    end loop;
  end if;

  return jsonb_build_object(
    'ok', true,
    'taskId', v_task,
    'assignedUnits', array_length(v_units, 1),
    'requirements', v_pos,
    'dueAt', v_due_ts
  );
end;
$$;

create or replace function smartgov.create_task_v2(
  p_session_token text,
  p_title text,
  p_details text,
  p_due_date date,
  p_due_time time,
  p_due_timezone text,
  p_priority text,
  p_auto_close boolean,
  p_unit_ids jsonb,
  p_requirements jsonb
)
returns jsonb
language plpgsql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
begin
  return smartgov.create_task_v2(
    p_session_token, p_title, p_details, p_due_date, p_due_time, p_due_timezone,
    p_priority, p_auto_close, p_unit_ids, p_requirements, 0, null
  );
end;
$$;

create or replace function public.create_task_v2(
  p_session_token text, p_title text, p_details text, p_due_date date, p_due_time time,
  p_due_timezone text, p_priority text, p_auto_close boolean, p_unit_ids jsonb,
  p_requirements jsonb, p_grace_period_minutes integer, p_review_sla_days integer
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.create_task_v2($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12); $$;

revoke all on function public.create_task_v2(text, text, text, date, time, text, text, boolean, jsonb, jsonb, integer, integer) from public;
grant execute on function public.create_task_v2(text, text, text, date, time, text, text, boolean, jsonb, jsonb, integer, integer) to anon, authenticated, service_role;

create or replace function smartgov.submit_requirement_answer(
  p_session_token text,
  p_requirement_id uuid,
  p_unit_id uuid,
  p_link_url text,
  p_storage_path text,
  p_original_name text,
  p_mime_type text,
  p_size_bytes bigint
)
returns jsonb
language plpgsql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_req smartgov.task_requirements%rowtype;
  v_task smartgov.tasks%rowtype;
  v_usg boolean;
  v_units uuid[];
  v_unit uuid;
  v_link text;
  v_path text;
  v_ext text;
  v_ok boolean := false;
  v_t text;
  v_status text;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then return jsonb_build_object('ok', false, 'reason', 'unauthenticated'); end if;

  select rq.* into v_req
    from smartgov.task_requirements rq
    join smartgov.tasks t on t.id = rq.task_id
   where rq.id = p_requirement_id
     and t.organization_id = v_account.organization_id;
  if v_req.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;

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
  if v_status is null then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if v_status = 'under_review' then return jsonb_build_object('ok', false, 'reason', 'under_review'); end if;
  if v_status = 'approved' then return jsonb_build_object('ok', false, 'reason', 'already_done'); end if;

  if smartgov.task_is_locked(v_req.task_id) then return jsonb_build_object('ok', false, 'reason', 'task_closed'); end if;

  v_link := btrim(coalesce(p_link_url, ''));
  v_path := nullif(btrim(coalesce(p_storage_path, '')), '');

  if v_link = '' and v_path is null then return jsonb_build_object('ok', false, 'reason', 'answer_required'); end if;
  if v_link <> '' and v_path is not null then return jsonb_build_object('ok', false, 'reason', 'invalid_request'); end if;
  if length(v_link) > 2000 then return jsonb_build_object('ok', false, 'reason', 'invalid_request'); end if;

  if v_path is not null and jsonb_typeof(v_req.accepted_types) = 'array'
     and jsonb_array_length(v_req.accepted_types) > 0 then
    v_ext := lower(coalesce(nullif(regexp_replace(coalesce(p_original_name, ''), '^.*\.', ''), ''), ''));
    for v_t in select jsonb_array_elements_text(v_req.accepted_types) loop
      if lower(btrim(v_t)) = v_ext then v_ok := true; end if;
    end loop;
    if not v_ok then return jsonb_build_object('ok', false, 'reason', 'unaccepted_type'); end if;
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
        review_note = '',
        reviewed_by = null,
        reviewed_at = null,
        link_url = excluded.link_url,
        storage_path = excluded.storage_path,
        original_name = excluded.original_name,
        mime_type = excluded.mime_type,
        size_bytes = excluded.size_bytes,
        responded_by = excluded.responded_by,
        responded_at = now();

  update smartgov.task_assignments
     set status = 'draft', updated_at = now()
   where task_id = v_req.task_id and unit_id = v_unit
     and status in ('pending', 'draft', 'returned');

  return jsonb_build_object('ok', true, 'unitId', v_unit, 'status', 'draft');
end;
$$;

create or replace function smartgov.submit_assignment_response(
  p_session_token text,
  p_task_id uuid,
  p_unit_id uuid,
  p_note text,
  p_storage_path text
)
returns jsonb
language plpgsql security definer
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
         late = false,
         review_opened_at = null,
         updated_by = v_account.id,
         updated_at = now()
   where task_id = p_task_id and unit_id = p_unit_id;

  return jsonb_build_object('ok', true, 'status', 'draft');
end;
$$;

create or replace function smartgov.update_assignment_status(
  p_session_token text,
  p_task_id uuid,
  p_unit_id uuid,
  p_status text,
  p_note text
)
returns jsonb
language plpgsql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_units uuid[];
  v_now text;
  v_status text := lower(trim(coalesce(p_status, '')));
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then return jsonb_build_object('ok', false, 'reason', 'unauthenticated'); end if;
  if v_status not in ('pending', 'draft') then return jsonb_build_object('ok', false, 'reason', 'invalid_request'); end if;
  if not exists (select 1 from smartgov.tasks t where t.id = p_task_id and t.organization_id = v_account.organization_id) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if smartgov.task_is_locked(p_task_id) then return jsonb_build_object('ok', false, 'reason', 'task_closed'); end if;

  select coalesce(array_agg(u), '{}'::uuid[]) into v_units
    from smartgov.lsg_unit_ids(v_account.id, v_account.organization_id) u;
  if not (p_unit_id = any (v_units)) then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;

  select ta.status into v_now
    from smartgov.task_assignments ta
   where ta.task_id = p_task_id and ta.unit_id = p_unit_id;
  if v_now is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_now = 'approved' then return jsonb_build_object('ok', false, 'reason', 'already_done'); end if;
  if v_now = 'under_review' then return jsonb_build_object('ok', false, 'reason', 'under_review'); end if;

  update smartgov.task_assignments
     set status = v_status,
         note = btrim(coalesce(p_note, '')),
         updated_at = now()
   where task_id = p_task_id and unit_id = p_unit_id;

  return jsonb_build_object('ok', true, 'status', v_status);
end;
$$;

create or replace function smartgov.submit_assignment_for_review(
  p_session_token text,
  p_task_id uuid,
  p_unit_id uuid
)
returns jsonb
language plpgsql security definer
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
  if v_assign.status = 'under_review' then return jsonb_build_object('ok', false, 'reason', 'already_submitted'); end if;
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
         late = v_late,
         review_opened_at = null,
         updated_by = v_account.id,
         updated_at = now()
   where task_id = p_task_id and unit_id = p_unit_id;

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

create or replace function smartgov.task_detail(
  p_session_token text,
  p_task_id uuid
)
returns jsonb
language plpgsql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_task smartgov.tasks%rowtype;
  v_usg boolean;
  v_units uuid[];
  v_tz text;
  v_due timestamp;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then return jsonb_build_object('ok', false, 'reason', 'unauthenticated'); end if;

  select t.* into v_task from smartgov.tasks t
   where t.id = p_task_id and t.organization_id = v_account.organization_id;
  if v_task.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;

  v_usg := smartgov.is_usg(v_account.id, v_account.organization_id);
  select coalesce(array_agg(u), '{}'::uuid[]) into v_units
    from smartgov.lsg_unit_ids(v_account.id, v_account.organization_id) u;

  if not v_usg and not exists (
    select 1 from smartgov.task_assignments ta
     where ta.task_id = p_task_id and ta.unit_id = any (v_units)
  ) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  v_tz := coalesce(nullif(btrim(v_task.due_timezone), ''), 'UTC');
  v_due := case
    when smartgov.task_due_at(p_task_id) is not null
      then smartgov.task_due_at(p_task_id) at time zone v_tz
    else null
  end;

  return jsonb_build_object(
    'ok', true,
    'task', jsonb_build_object(
      'id', v_task.id,
      'title', v_task.title,
      'details', v_task.details,
      'dueDate', case when v_due is null then null else v_due::date end,
      'dueTime', case when v_due is null then null else v_due::time end,
      'dueTimezone', v_task.due_timezone,
      'dueAt', smartgov.task_due_at(p_task_id),
      'assignedAt', v_task.assigned_at,
      'gracePeriodMinutes', v_task.grace_period_minutes,
      'reviewSlaDays', v_task.review_sla_days,
      'autoClosedAt', v_task.auto_closed_at,
      'reopenedAt', v_task.reopened_at,
      'priority', v_task.priority,
      'autoClose', v_task.auto_close,
      'closed', v_task.closed_at is not null or smartgov.task_is_locked(p_task_id),
      'closedAt', v_task.closed_at,
      'closingNote', v_task.closing_note,
      'overdue', smartgov.task_due_at(p_task_id) is not null
                and smartgov.task_due_at(p_task_id) < now()
                and not smartgov.task_is_locked(p_task_id),
      'daysLeft', case when smartgov.task_due_at(p_task_id) is null then null
                       else (smartgov.task_due_at(p_task_id) at time zone v_tz)::date - current_date end,
      'doneUnits', (select count(*) from smartgov.task_assignments ta where ta.task_id = v_task.id and ta.status = 'approved'),
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
        'effectiveStatus', smartgov.assignment_effective_status(ta.task_id, ta.unit_id),
        'note', ta.note,
        'submittedAt', ta.submitted_at,
        'late', ta.late,
        'reviewOpenedAt', ta.review_opened_at,
        'reviewDueAt', smartgov.review_due_at(ta.task_id, ta.unit_id),
        'reviewOverdue', smartgov.review_due_at(ta.task_id, ta.unit_id) is not null
                         and smartgov.review_due_at(ta.task_id, ta.unit_id) < now(),
        'assignedAt', ta.assigned_at,
        'dueAt', ta.due_at,
        'autoClosedAt', ta.auto_closed_at,
        'reopenedAt', ta.reopened_at,
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
        'assignedAt', rq.assigned_at,
        'dueAt', rq.due_at,
        'gracePeriodMinutes', rq.grace_period_minutes,
        'reviewSlaDays', rq.review_sla_days,
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

create or replace function smartgov.task_assignment_responses(
  p_session_token text,
  p_task_id uuid
)
returns jsonb
language plpgsql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_task smartgov.tasks%rowtype;
  v_usg boolean;
  v_units uuid[];
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then return jsonb_build_object('ok', false, 'reason', 'unauthenticated'); end if;

  select t.* into v_task from smartgov.tasks t
   where t.id = p_task_id and t.organization_id = v_account.organization_id;
  if v_task.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;

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
        'effectiveStatus', smartgov.assignment_effective_status(ta.task_id, ta.unit_id),
        'note', ta.note,
        'responseName', ta.response_name,
        'responseMime', ta.response_mime,
        'responseBytes', ta.response_bytes,
        'hasResponse', ta.response_path is not null,
        'respondedAt', ta.responded_at,
        'submittedAt', ta.submitted_at,
        'late', ta.late,
        'reviewOpenedAt', ta.review_opened_at,
        'reviewDueAt', smartgov.review_due_at(ta.task_id, ta.unit_id),
        'reviewOverdue', smartgov.review_due_at(ta.task_id, ta.unit_id) is not null
                         and smartgov.review_due_at(ta.task_id, ta.unit_id) < now(),
        'assignedAt', ta.assigned_at,
        'dueAt', ta.due_at,
        'autoClosedAt', ta.auto_closed_at,
        'reopenedAt', ta.reopened_at,
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

create or replace function smartgov.list_my_tasks(
  p_session_token text,
  p_status text
)
returns jsonb
language plpgsql security definer
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

  return jsonb_build_object(
    'ok', true,
    'isUsg', v_usg,
    'tasks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id,
        'title', t.title,
        'details', t.details,
        'dueDate', case when smartgov.task_due_at(t.id) is null then null
                        else (smartgov.task_due_at(t.id) at time zone coalesce(nullif(btrim(t.due_timezone), ''), 'UTC'))::date end,
        'dueTime', case when smartgov.task_due_at(t.id) is null then null
                        else (smartgov.task_due_at(t.id) at time zone coalesce(nullif(btrim(t.due_timezone), ''), 'UTC'))::time end,
        'dueTimezone', t.due_timezone,
        'dueAt', smartgov.task_due_at(t.id),
        'assignedAt', t.assigned_at,
        'gracePeriodMinutes', t.grace_period_minutes,
        'reviewSlaDays', t.review_sla_days,
        'autoClosedAt', t.auto_closed_at,
        'reopenedAt', t.reopened_at,
        'priority', t.priority,
        'autoClose', t.auto_close,
        'closed', t.closed_at is not null or smartgov.task_is_locked(t.id),
        'createdAt', t.created_at,
        'overdue', smartgov.task_due_at(t.id) is not null
                  and smartgov.task_due_at(t.id) < now()
                  and not smartgov.task_is_locked(t.id)
                  and (
                    v_usg
                    or coalesce((
                      select smartgov.assignment_effective_status(t.id, ta.unit_id)
                        from smartgov.task_assignments ta
                       where ta.task_id = t.id and ta.unit_id = any (v_units)
                       limit 1
                    ), '') in ('pending', 'draft', 'returned', 'overdue')
                  ),
        'daysLeft', case when smartgov.task_due_at(t.id) is null then null
                         else (smartgov.task_due_at(t.id) at time zone coalesce(nullif(btrim(t.due_timezone), ''), 'UTC'))::date - current_date end,
        'totalUnits', (select count(*) from smartgov.task_assignments ta where ta.task_id = t.id),
        'doneUnits', (select count(*) from smartgov.task_assignments ta where ta.task_id = t.id and ta.status = 'approved'),
        'myStatus', case when v_usg then null else (
          select smartgov.assignment_effective_status(t.id, ta.unit_id)
            from smartgov.task_assignments ta
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
        'myReviewDueAt', case when v_usg then null else (
          select smartgov.review_due_at(t.id, ta.unit_id)
            from smartgov.task_assignments ta
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
          coalesce((smartgov.task_due_at(t.id) at time zone coalesce(nullif(btrim(t.due_timezone), ''), 'UTC'))::date, '9999-12-31'::date),
          t.created_at desc)
        from smartgov.tasks t
       where t.organization_id = v_account.organization_id
         and (v_usg or exists (
           select 1 from smartgov.task_assignments ta
            where ta.task_id = t.id and ta.unit_id = any (v_units)))
         and (
           p_status is null or p_status = ''
           or (p_status = 'open' and t.closed_at is null and not smartgov.task_is_locked(t.id))
           or (p_status = 'closed' and (t.closed_at is not null or smartgov.task_is_locked(t.id)))
           or (p_status = 'overdue' and smartgov.task_due_at(t.id) is not null
               and smartgov.task_due_at(t.id) < now()
               and not smartgov.task_is_locked(t.id)
               and (
                 v_usg
                 or coalesce((
                   select smartgov.assignment_effective_status(t.id, ta.unit_id)
                     from smartgov.task_assignments ta
                    where ta.task_id = t.id and ta.unit_id = any (v_units)
                    limit 1
                 ), '') in ('pending', 'draft', 'returned', 'overdue')
               ))
         )
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function smartgov.list_tasks(p_session_token text)
returns jsonb
language plpgsql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_is_usg boolean;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then return jsonb_build_object('ok', false, 'reason', 'unauthenticated'); end if;

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
        'dueDate', case when smartgov.task_due_at(t.id) is null then null
                        else (smartgov.task_due_at(t.id) at time zone coalesce(nullif(btrim(t.due_timezone), ''), 'UTC'))::date end,
        'dueTime', case when smartgov.task_due_at(t.id) is null then null
                        else (smartgov.task_due_at(t.id) at time zone coalesce(nullif(btrim(t.due_timezone), ''), 'UTC'))::time end,
        'dueTimezone', t.due_timezone,
        'dueAt', smartgov.task_due_at(t.id),
        'assignedAt', t.assigned_at,
        'gracePeriodMinutes', t.grace_period_minutes,
        'reviewSlaDays', t.review_sla_days,
        'priority', t.priority,
        'overdue', smartgov.task_due_at(t.id) is not null
                  and smartgov.task_due_at(t.id) < now()
                  and not smartgov.task_is_locked(t.id)
                  and exists (
                    select 1 from smartgov.task_assignments ta
                     where ta.task_id = t.id
                       and smartgov.assignment_effective_status(t.id, ta.unit_id) in ('pending', 'draft', 'returned', 'overdue')
                  ),
        'daysLeft', case when smartgov.task_due_at(t.id) is null then null
                         else (smartgov.task_due_at(t.id) at time zone coalesce(nullif(btrim(t.due_timezone), ''), 'UTC'))::date - current_date end,
        'assignments', coalesce((
          select jsonb_agg(jsonb_build_object(
            'unitId', ta.unit_id,
            'unitName', (select gu.name from public.governance_units gu where gu.id = ta.unit_id),
            'status', smartgov.assignment_effective_status(ta.task_id, ta.unit_id),
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
        'doneUnits', (select count(*) from smartgov.task_assignments ta where ta.task_id = t.id and ta.status = 'approved'),
        'totalUnits', (select count(*) from smartgov.task_assignments ta where ta.task_id = t.id)
      ) order by smartgov.task_due_at(t.id) nulls last, t.created_at desc)
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

notify pgrst, 'reload schema';
