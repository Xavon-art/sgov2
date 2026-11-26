create or replace function smartgov.sweep()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_task        record;
  v_req         record;
  v_survey      record;
  v_acct        record;
  v_deadline    timestamptz;
  v_tasks       integer := 0;
  v_requests    integer := 0;
  v_surveys     integer := 0;
  v_started     integer := 0;
  v_ended       integer := 0;
  v_responses   integer;
begin
  -- ---------------------------------------------------------------- tasks
  -- Auto-close only boards that asked for it, and only once.
  for v_task in
    select t.id,
           t.organization_id,
           t.title,
           t.created_by,
           ((t.due_date::timestamp + coalesce(t.due_time, time '23:59:59'))
             at time zone coalesce(nullif(t.due_timezone, ''), 'UTC')) as deadline
      from smartgov.tasks t
     where t.auto_close
       and t.closed_at is null
       and t.due_date is not null
  loop
    if v_task.deadline is not null and v_task.deadline <= now() then
      update smartgov.tasks
         set closed_at = now(),
             closing_note = case
               when btrim(coalesce(closing_note, '')) = '' then 'Auto-closed at deadline.'
               else closing_note
             end
       where id = v_task.id
         and closed_at is null;

      if found then
        v_tasks := v_tasks + 1;

        insert into smartgov.notifications
          (account_id, organization_id, kind, title, body, link)
        values
          (v_task.created_by, v_task.organization_id, 'task_closed',
           'Task auto-closed',
           v_task.title || ' closed at its deadline.',
           '/usg/request');

        -- Everyone seated in an assigned unit hears about it.
        insert into smartgov.notifications
          (account_id, organization_id, kind, title, body, link)
        select distinct a.id, a.organization_id, 'task_closed',
               'Task closed',
               v_task.title || ' closed at its deadline.',
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

        insert into smartgov.audit_log
          (organization_id, actor_id, action, target_type, target_id, detail)
        values
          (v_task.organization_id, null, 'task.auto_closed', 'task', v_task.id,
           jsonb_build_object('title', v_task.title));
      end if;
    end if;
  end loop;

  -- ----------------------------------------------------- personal requests
  for v_req in
    select r.id,
           r.organization_id,
           r.unit_id,
           r.created_by,
           r.subject,
           ((r.needed_on::timestamp + coalesce(r.needed_time, time '23:59:59'))
             at time zone coalesce(nullif(r.needed_timezone, ''), 'UTC')) as deadline
      from smartgov.personal_requests r
     where r.status = 'pending'
  loop
    if v_req.deadline is not null and v_req.deadline <= now() then
      update smartgov.personal_requests
         set status = 'rejected'
       where id = v_req.id
         and status = 'pending';

      if found then
        v_requests := v_requests + 1;

        insert into smartgov.notifications
          (account_id, organization_id, kind, title, body, link)
        values
          (v_req.created_by, v_req.organization_id, 'request_expired',
           'Personal request expired',
           v_req.subject || ' expired without a decision.',
           '/lsg/request');

        insert into smartgov.notifications
          (account_id, organization_id, kind, title, body, link)
        select a.id, a.organization_id, 'request_expired',
               'Personal request expired',
               v_req.subject || ' expired without a decision.',
               '/usg/request'
          from smartgov.accounts a
         where a.organization_id = v_req.organization_id
           and a.account_scope = 'owner'
           and a.status = 'active';

        insert into smartgov.audit_log
          (organization_id, actor_id, action, target_type, target_id, detail)
        values
          (v_req.organization_id, null, 'personal_request.expired', 'personal_request', v_req.id,
           jsonb_build_object('subject', v_req.subject));
      end if;
    end if;
  end loop;

  -- ---------------------------------------------------------------- surveys
  for v_survey in
    select s.id,
           s.organization_id,
           s.created_by,
           s.title,
           s.deadline,
           s.response_limit,
           (select count(*) from smartgov.survey_responses sr where sr.survey_id = s.id) as responses
      from smartgov.surveys s
     where s.status = 'open'
  loop
    v_responses := coalesce(v_survey.responses, 0);

    if (v_survey.deadline is not null and v_survey.deadline <= now())
       or (v_survey.response_limit is not null and v_responses >= v_survey.response_limit) then
      update smartgov.surveys
         set status = 'closed',
             updated_at = now()
       where id = v_survey.id
         and status = 'open';

      if found then
        v_surveys := v_surveys + 1;

        insert into smartgov.notifications
          (account_id, organization_id, kind, title, body, link)
        values
          (v_survey.created_by, v_survey.organization_id, 'survey_closed',
           'Survey closed',
           v_survey.title || ' closed after ' || v_responses || ' response(s).',
           case
             when smartgov.is_usg(v_survey.created_by, v_survey.organization_id)
               then '/usg/surveys/' || v_survey.id::text
             else '/lsg/surveys/' || v_survey.id::text
           end);

        insert into smartgov.audit_log
          (organization_id, actor_id, action, target_type, target_id, detail)
        values
          (v_survey.organization_id, null, 'survey.closed', 'survey', v_survey.id,
           jsonb_build_object('title', v_survey.title, 'responses', v_responses));
      end if;
    end if;
  end loop;

  -- ----------------------------------------------------------- deactivation
  for v_acct in
    select a.id,
           a.organization_id,
           a.email,
           a.display_name,
           a.status,
           a.deactivation_starts_at,
           a.deactivation_ends_at,
           a.deactivation_reason,
           a.deactivation_scheduled_by
      from smartgov.accounts a
     where (a.deactivation_starts_at is not null or a.deactivation_ends_at is not null)
       and (
         (a.status = 'active'
          and a.deactivation_starts_at is not null
          and a.deactivation_starts_at <= now()
          and (a.deactivation_ends_at is null or a.deactivation_ends_at > now()))
         or
         (a.status = 'suspended'
          and a.deactivation_ends_at is not null
          and a.deactivation_ends_at <= now())
       )
  loop
    -- Start of a scheduled window.
    if v_acct.status = 'active'
       and v_acct.deactivation_starts_at is not null
       and v_acct.deactivation_starts_at <= now()
       and (v_acct.deactivation_ends_at is null or v_acct.deactivation_ends_at > now()) then
      update smartgov.accounts
         set status = 'suspended',
             deactivated_at = now(),
             deactivated_email = email
       where id = v_acct.id
         and status = 'active';

      if found then
        v_started := v_started + 1;

        -- Kill every live session.
        update smartgov.sessions
           set expires_at = now()
         where account_id = v_acct.id
           and expires_at > now();

        insert into smartgov.notifications
          (account_id, organization_id, kind, title, body, link)
        values
          (v_acct.id, v_acct.organization_id, 'deactivation_started',
           'Account deactivated',
           'Your account is deactivated'
             || case when v_acct.deactivation_ends_at is not null
                     then ' until ' || to_char(v_acct.deactivation_ends_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC'
                     else ' indefinitely' end
             || case when btrim(coalesce(v_acct.deactivation_reason, '')) <> ''
                     then '. Reason: ' || v_acct.deactivation_reason else '.' end,
           '/');

        if v_acct.deactivation_scheduled_by is not null then
          insert into smartgov.notifications
            (account_id, organization_id, kind, title, body, link)
          values
            (v_acct.deactivation_scheduled_by, v_acct.organization_id, 'deactivation_started',
             'Scheduled deactivation started',
             v_acct.email || ' was deactivated as scheduled.',
             '/usg/manage');
        end if;

        insert into smartgov.email_queue (to_address, subject, html, text_body)
        values (
          v_acct.email,
          'Your SmartGov account has been deactivated',
          '<p>Hello ' || coalesce(nullif(btrim(v_acct.display_name), ''), v_acct.email) || ',</p>'
            || '<p>Your SmartGov account is now deactivated'
            || case when v_acct.deactivation_ends_at is not null
                    then ' until <strong>' || to_char(v_acct.deactivation_ends_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC</strong>'
                    else ' <strong>indefinitely</strong>' end
            || '.</p>'
            || case when btrim(coalesce(v_acct.deactivation_reason, '')) <> ''
                    then '<p><strong>Reason:</strong> ' || v_acct.deactivation_reason || '</p>' else '' end
            || '<p>If you believe this is a mistake, contact your University Student Government.</p>',
          'Your SmartGov account is now deactivated.'
        );

        insert into smartgov.audit_log
          (organization_id, actor_id, action, target_type, target_id, detail)
        values
          (v_acct.organization_id, null, 'account.deactivation_started', 'account', v_acct.id,
           jsonb_build_object('email', v_acct.email, 'endsAt', v_acct.deactivation_ends_at));
      end if;
    end if;

    -- End of a scheduled window.
    if v_acct.status = 'suspended'
       and v_acct.deactivation_ends_at is not null
       and v_acct.deactivation_ends_at <= now() then
      update smartgov.accounts
         set status = 'active',
             deactivated_at = null,
             deactivated_by = null,
             deactivation_reason = null,
             deactivation_starts_at = null,
             deactivation_ends_at = null,
             deactivation_scheduled_by = null
       where id = v_acct.id
         and status = 'suspended';

      if found then
        v_ended := v_ended + 1;

        insert into smartgov.notifications
          (account_id, organization_id, kind, title, body, link)
        values
          (v_acct.id, v_acct.organization_id, 'deactivation_ended',
           'Account reactivated',
           'Your account is active again. You can sign in now.',
           '/');

        insert into smartgov.email_queue (to_address, subject, html, text_body)
        values (
          v_acct.email,
          'Your SmartGov account is active again',
          '<p>Hello ' || coalesce(nullif(btrim(v_acct.display_name), ''), v_acct.email) || ',</p>'
            || '<p>Your scheduled deactivation has ended and your account is active again.</p>',
          'Your SmartGov account is active again.'
        );

        insert into smartgov.audit_log
          (organization_id, actor_id, action, target_type, target_id, detail)
        values
          (v_acct.organization_id, null, 'account.deactivation_ended', 'account', v_acct.id,
           jsonb_build_object('email', v_acct.email));
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'tasksClosed', v_tasks,
    'requestsExpired', v_requests,
    'surveysClosed', v_surveys,
    'deactivationsStarted', v_started,
    'deactivationsEnded', v_ended,
    'ranAt', now()
  );
end;
$$;
revoke all on function smartgov.sweep() from public;

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
         and r.status = 'approved'
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
revoke all on function smartgov.create_event_v2_base(text, text, text, date, time, text, text, text, uuid[], text[], jsonb, uuid, text) from public;

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

  if v_req.status <> 'returned' then
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

create or replace function smartgov.monitoring_by_campus(p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_empty_statuses jsonb := jsonb_build_object(
    'pending', 0,
    'under_review', 0,
    'approved', 0,
    'returned', 0,
    'rejected', 0,
    'cancelled', 0
  );
  v_module_keys jsonb := '["proposals","budgets","events","documents","tasks","requests","surveys","structures","resolutions"]'::jsonb;
  v_module_labels jsonb := jsonb_build_object(
    'proposals', 'Proposals',
    'budgets', 'Budgets',
    'events', 'Events',
    'documents', 'Documents',
    'tasks', 'Tasks',
    'requests', 'Requests',
    'surveys', 'Surveys',
    'structures', 'Structures',
    'resolutions', 'Resolutions'
  );
  v_campuses jsonb;
  v_totals jsonb;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if not smartgov.is_usg_side(v_account) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  with recursive roots as (
    select gu.id
      from public.governance_units gu
     where gu.organization_id = v_account.organization_id
       and gu.unit_type = 'usg'
  ),
  top_units as (
    select gu.id as unit_id, gu.id as campus_id, gu.name as campus_name
      from public.governance_units gu
      join roots r on gu.parent_id = r.id
     where gu.organization_id = v_account.organization_id
       and gu.unit_type in ('campus', 'college', 'department')
    union all
    select child.id, parent.campus_id, parent.campus_name
      from public.governance_units child
      join top_units parent on child.parent_id = parent.unit_id
     where child.organization_id = v_account.organization_id
  ),
  mapped_units as (
    select r.id as unit_id, r.id as campus_id, 'All campuses'::text as campus_name
      from roots r
    union
    select gu.id, coalesce(t.campus_id, r.id), coalesce(t.campus_name, 'All campuses'::text)
      from public.governance_units gu
      cross join roots r
      left join top_units t on t.unit_id = gu.id
     where gu.organization_id = v_account.organization_id
  ),
  campus_rows as (
    select distinct campus_id, campus_name from top_units
    union
    select id, 'All campuses'::text from roots
  ),
  module_rows as (
    select 'proposals'::text as module_key,
           coalesce(mu.campus_id, r.id) as campus_id,
           coalesce(mu.campus_name, 'All campuses'::text) as campus_name,
           case p.status
             when 'under_review' then 'under_review'
             when 'requirements_requested' then 'returned'
             when 'returned' then 'returned'
             when 'approved' then 'approved'
             when 'published' then 'approved'
             when 'rejected' then 'rejected'
             else 'pending'
           end as status_family
      from smartgov.proposals p
      cross join roots r
      left join mapped_units mu on mu.unit_id = p.unit_id
     where p.organization_id = v_account.organization_id
    union all
    select 'budgets'::text,
           coalesce(mu.campus_id, r.id),
           coalesce(mu.campus_name, 'All campuses'::text),
           case b.status
             when 'returned' then 'returned'
             when 'approved' then 'approved'
             when 'rejected' then 'rejected'
             else 'pending'
           end
      from smartgov.budget_requests b
      cross join roots r
      left join mapped_units mu on mu.unit_id = b.unit_id
     where b.organization_id = v_account.organization_id
    union all
    select 'events'::text,
           coalesce(mu.campus_id, r.id),
           coalesce(mu.campus_name, 'All campuses'::text),
           case
             when e.cancelled_at is not null or e.status = 'cancelled' then 'cancelled'
             when e.status = 'rejected' or e.honor_status = 'not_honored' then 'rejected'
             when e.status = 'honored' or e.honor_status = 'honored' then 'approved'
             when e.status = 'claimed' then 'under_review'
             else 'pending'
           end
      from smartgov.events e
      cross join roots r
      left join mapped_units mu on mu.unit_id = e.unit_id
     where e.organization_id = v_account.organization_id
    union all
    select 'documents'::text,
           coalesce(mu.campus_id, r.id),
           coalesce(mu.campus_name, 'All campuses'::text),
           case d.approval_status
             when 'approved' then 'approved'
             when 'rejected' then 'rejected'
             else 'pending'
           end
      from smartgov.document_catalog d
      cross join roots r
      left join smartgov.item_submissions dis on dis.id = d.submission_id
      left join smartgov.proposal_versions dpv on dpv.id = dis.version_id
      left join smartgov.proposals dp on dp.id = dpv.proposal_id
      left join smartgov.events de on d.group_kind = 'event' and d.group_id = de.id
      left join smartgov.resolutions dr on d.group_kind = 'resolution' and d.group_id = dr.id
      left join mapped_units mu on mu.unit_id = coalesce(dp.unit_id, de.unit_id, dr.unit_id)
     where d.organization_id = v_account.organization_id
    union all
    select 'tasks'::text,
           coalesce(mu.campus_id, r.id),
           coalesce(mu.campus_name, 'All campuses'::text),
           case
             when t.closed_at is not null or ta.status = 'approved' then 'approved'
             when ta.status = 'under_review' then 'under_review'
             when ta.status = 'returned' then 'returned'
             when ta.status = 'rejected' then 'rejected'
             else 'pending'
           end
      from smartgov.tasks t
      join smartgov.task_assignments ta on ta.task_id = t.id
      cross join roots r
      left join mapped_units mu on mu.unit_id = ta.unit_id
     where t.organization_id = v_account.organization_id
    union all
    select 'requests'::text,
           coalesce(mu.campus_id, r.id),
           coalesce(mu.campus_name, 'All campuses'::text),
           case pr.status
             when 'approved' then 'approved'
             when 'rejected' then 'rejected'
             when 'returned' then 'returned'
             else 'pending'
           end
      from smartgov.personal_requests pr
      cross join roots r
      left join mapped_units mu on mu.unit_id = pr.unit_id
     where pr.organization_id = v_account.organization_id
    union all
    select 'surveys'::text,
           coalesce(mu.campus_id, r.id),
           coalesce(mu.campus_name, 'All campuses'::text),
           case s.status
             when 'closed' then 'approved'
             else 'pending'
           end
      from smartgov.surveys s
      cross join roots r
      left join mapped_units mu on false
     where s.organization_id = v_account.organization_id
    union all
    select 'structures'::text,
           coalesce(mu.campus_id, r.id),
           coalesce(mu.campus_name, 'All campuses'::text),
           case gs.status
             when 'approved' then 'approved'
             when 'returned' then 'returned'
             when 'rejected' then 'rejected'
             when 'superseded' then 'cancelled'
             else 'pending'
           end
      from smartgov.gov_structures gs
      cross join roots r
      left join mapped_units mu on mu.unit_id = gs.unit_id
     where gs.organization_id = v_account.organization_id
    union all
    select 'resolutions'::text,
           coalesce(mu.campus_id, r.id),
           coalesce(mu.campus_name, 'All campuses'::text),
           case res.status
             when 'under_review' then 'under_review'
             when 'approved' then 'approved'
             when 'published' then 'approved'
             when 'returned' then 'returned'
             when 'rejected' then 'rejected'
             else 'pending'
           end
      from smartgov.resolutions res
      cross join roots r
      left join mapped_units mu on mu.unit_id = res.unit_id
     where res.organization_id = v_account.organization_id
  ),
  family_counts as (
    select module_key, campus_id, campus_name, status_family, count(*)::int as n
      from module_rows
     group by module_key, campus_id, campus_name, status_family
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'unitId', c.campus_id,
        'unitName', c.campus_name,
        'totals', v_empty_statuses || coalesce((
          select jsonb_object_agg(fc.status_family, fc.n)
            from family_counts fc
           where fc.campus_id = c.campus_id
        ), '{}'::jsonb),
        'modules', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'key', k.key,
              'label', v_module_labels ->> k.key,
              'total', coalesce((
                select sum(fc.n)::int
                  from family_counts fc
                 where fc.campus_id = c.campus_id
                   and fc.module_key = k.key
              ), 0),
              'statuses', v_empty_statuses || coalesce((
                select jsonb_object_agg(fc.status_family, fc.n)
                  from family_counts fc
                 where fc.campus_id = c.campus_id
                   and fc.module_key = k.key
              ), '{}'::jsonb)
            ) order by k.ord
          )
            from jsonb_array_elements_text(v_module_keys) with ordinality as k(key, ord)
        ), '[]'::jsonb)
      ) order by c.campus_name
    ),
    '[]'::jsonb
  ),
  v_empty_statuses || coalesce((
    select jsonb_object_agg(f.status_family, f.total)
      from (
        select status_family, sum(n)::int as total
          from family_counts
         group by status_family
      ) f
  ), '{}'::jsonb)
    into v_campuses, v_totals
    from campus_rows c;

  return jsonb_build_object(
    'ok', true,
    'campuses', v_campuses,
    'totals', v_totals
  );
end;
$$;
revoke all on function smartgov.monitoring_by_campus(text) from public;

create or replace function smartgov.list_dashboard(p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account   smartgov.accounts%rowtype;
  v_is_usg    boolean;
  v_units     uuid[] := '{}'::uuid[];
  v_proposals uuid[] := '{}'::uuid[];
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  v_is_usg := v_account.account_scope = 'owner'
              or smartgov.is_org_reviewer(v_account.id, v_account.organization_id);

  select coalesce(array_agg(u), '{}'::uuid[])
    into v_units
    from smartgov.lsg_unit_ids(v_account.id, v_account.organization_id) u;

  -- The proposal set every section below is cut to. Materialised once so the scope
  -- is written down a single time: the four counts, the three queues, and the
  -- timeline all read this array rather than each repeating the predicate.
  select coalesce(array_agg(p.id), '{}'::uuid[])
    into v_proposals
    from smartgov.proposals p
   where p.organization_id = v_account.organization_id
     and (
       v_is_usg
       or p.created_by = v_account.id
       or (p.unit_id is not null and p.unit_id = any (v_units))
     );

  return jsonb_build_object(
    'ok', true,
    'scope', case when v_is_usg then 'organization' else 'unit' end,
    'canReview', v_is_usg,

    'counts', jsonb_build_object(

      'proposals', jsonb_build_object(
        'visible', coalesce(array_length(v_proposals, 1), 0),
        'awaitingReview', (select count(*)::int from smartgov.proposals p
                            where p.id = any (v_proposals)
                              and p.status in ('submitted', 'returned')),
        'returnedToMe', (select count(*)::int from smartgov.proposals p
                           where p.id = any (v_proposals)
                             and p.status = 'returned'
                             and p.created_by = v_account.id),
        'mineOpen', (select count(*)::int from smartgov.proposals p
                      where p.id = any (v_proposals)
                        and p.created_by = v_account.id
                        and p.status in ('submitted', 'returned'))
      ),

      -- "awaiting check" is the absence of a ruling, not the presence of a file, so
      -- the same row counts for an officer (nobody has looked at it) and for a
      -- reviewer (nobody on their side has looked at it). `mineUnchecked` is the
      -- reviewer's own backlog and is the only one of the three that means work.
      'documents', (
        select jsonb_build_object(
          'total', count(*),
          'awaitingCheck', count(*) filter (where sv.verdict is null),
          'queried', count(*) filter (where sv.verdict = 'queried'),
          'rejected', count(*) filter (where sv.verdict = 'rejected'),
          'mineUnchecked', count(*) filter (where mine.verdict is null)
        )
          from smartgov.item_submissions isub
          join smartgov.proposal_versions pv on pv.id = isub.version_id
          left join lateral (
            select v.verdict
              from smartgov.submission_verifications v
             where v.submission_id = isub.id
             order by v.created_at desc, v.verified_by desc
             limit 1
          ) sv on true
          left join lateral (
            select v.verdict
              from smartgov.submission_verifications v
             where v.submission_id = isub.id
               and v.verified_by = v_account.id
             limit 1
          ) mine on true
         where pv.proposal_id = any (v_proposals)
           and isub.submission_kind = 'file'
      ),

      'budgets', (
        select jsonb_build_object(
          'visible', count(*),
          'awaitingDecision', count(*) filter (where b.status = 'submitted'),
          'mineOpen', count(*) filter (where b.requested_by = v_account.id
                                         and b.status in ('submitted', 'returned'))
        )
          from smartgov.budget_requests b
         where b.organization_id = v_account.organization_id
           and (
             v_is_usg
             or b.requested_by = v_account.id
             or (b.unit_id is not null and b.unit_id = any (v_units))
           )
      ),

      -- `overdue` is derived here for the same reason `list_tasks` derives it: a
      -- deadline is a date and a status, and only the pair in hand can say whether
      -- it has passed. Storing it would need a nightly job to be honest.
      'tasks', (
        select jsonb_build_object(
          'visible', count(*),
          'overdue', count(*) filter (
            where t.due_date is not null
              and t.due_date < current_date
              and coalesce((select min(ta.status) from smartgov.task_assignments ta
                             where ta.task_id = t.id), '') <> 'approved'),
          'awaitingMe', count(*) filter (
            where exists (select 1 from smartgov.task_assignments ta
                           where ta.task_id = t.id
                             and ta.status <> 'approved'
                             and (v_is_usg or ta.unit_id = any (v_units))))
        )
          from smartgov.tasks t
         where t.organization_id = v_account.organization_id
           and (v_is_usg or exists (
                 select 1 from smartgov.task_assignments ta
                  where ta.task_id = t.id
                    and ta.unit_id = any (v_units)))
      )
    ),

    -- The newest few of each, not all of them. A dashboard that renders nine
    -- hundred rows is a list screen wearing a dashboard's clothes, and the list
    -- screens already exist.
    'proposals', (
      select coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) from (
        select jsonb_build_object(
          'id', p.id,
          'title', p.title,
          'status', p.status,
          'activityType', p.activity_type,
          'unitName', (select gu.name from public.governance_units gu where gu.id = p.unit_id),
          'version', (select max(pv.version_number) from smartgov.proposal_versions pv
                       where pv.proposal_id = p.id),
          'createdAt', p.created_at,
          'mine', p.created_by = v_account.id,
          -- "waiting on me" is the union of the two reasons a row stops: an officer
          -- has a returned proposal to fix, a reviewer has one to decide.
          'awaitingMe', (p.status = 'returned' and p.created_by = v_account.id)
                     or (p.status in ('submitted', 'returned') and v_is_usg)
        ) as q
          from smartgov.proposals p
         where p.id = any (v_proposals)
         order by p.created_at desc
         limit 8
      ) q
    ),

    -- `attached` repeats the completeness test from 02700 rather than trusting that
    -- a file submission means a file arrived. A dashboard that claimed a document
    -- was attached when the bytes did not land would be the worst bug in the app.
    'documents', (
      select coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) from (
        select jsonb_build_object(
          'submissionId', isub.id,
          'proposalId', pv.proposal_id,
          'proposalTitle', pr.title,
          'label', ri.label,
          'originalName', isub.original_name,
          'attached', exists (select 1 from smartgov.document_uploads d
                               where d.storage_path = isub.storage_path
                                 and d.large_object_oid is not null
                                 and d.confirmed_at is not null
                                 and d.written_bytes = d.size_bytes),
          'verdict', sv.verdict,
          'verifiedBy', (select a.display_name from smartgov.accounts a where a.id = sv.verified_by),
          'verifiedAt', sv.created_at,
          'myVerdict', mine.verdict
        ) as q
          from smartgov.item_submissions isub
          join smartgov.proposal_versions pv on pv.id = isub.version_id
          join smartgov.proposals pr on pr.id = pv.proposal_id
          join smartgov.requirement_items ri on ri.id = isub.requirement_item_id
          left join lateral (
            select v.verdict, v.verified_by, v.created_at
              from smartgov.submission_verifications v
             where v.submission_id = isub.id
             order by v.created_at desc, v.verified_by desc
             limit 1
          ) sv on true
          left join lateral (
            select v.verdict
              from smartgov.submission_verifications v
             where v.submission_id = isub.id
               and v.verified_by = v_account.id
             limit 1
          ) mine on true
         where pv.proposal_id = any (v_proposals)
           and isub.submission_kind = 'file'
         order by isub.submitted_at desc
         limit 8
      ) q
    ),

    'budgets', (
      select coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) from (
        select jsonb_build_object(
          'id', b.id,
          'proposalId', b.proposal_id,
          'title', b.title,
          'status', b.status,
          'unitName', (select gu.name from public.governance_units gu where gu.id = b.unit_id),
          'requestedTotal', b.requested_total,
          'approvedTotal', b.approved_total,
          'createdAt', b.created_at,
          'mine', b.requested_by = v_account.id,
          'awaitingMe', b.status = 'submitted' and v_is_usg
        ) as q
          from smartgov.budget_requests b
         where b.organization_id = v_account.organization_id
           and (
             v_is_usg
             or b.requested_by = v_account.id
             or (b.unit_id is not null and b.unit_id = any (v_units))
           )
         order by b.created_at desc
         limit 6
      ) q
    ),

    'tasks', (
      select coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) from (
        select jsonb_build_object(
          'id', t.id,
          'title', t.title,
          'priority', t.priority,
          'dueDate', t.due_date,
          'overdue', (t.due_date is not null
                      and t.due_date < current_date
                      and coalesce((select min(ta.status) from smartgov.task_assignments ta
                                     where ta.task_id = t.id), '') <> 'approved'),
          'doneUnits', (select count(*) from smartgov.task_assignments ta
                         where ta.task_id = t.id and ta.status = 'approved'),
          'totalUnits', (select count(*) from smartgov.task_assignments ta
                          where ta.task_id = t.id),
          'mineStatus', (select ta.status from smartgov.task_assignments ta
                          where ta.task_id = t.id
                            and ta.unit_id = any (v_units)
                          limit 1),
          'awaitingMe', exists (select 1 from smartgov.task_assignments ta
                                 where ta.task_id = t.id
                                   and ta.status <> 'approved'
                                   and (v_is_usg or ta.unit_id = any (v_units)))
        ) as q
          from smartgov.tasks t
         where t.organization_id = v_account.organization_id
           and (v_is_usg or exists (
                 select 1 from smartgov.task_assignments ta
                  where ta.task_id = t.id
                    and ta.unit_id = any (v_units)))
         order by t.due_date nulls last, t.created_at desc
         limit 6
      ) q
    ),

    -- What happened, newest first. Six sources unioned, each already scoped, and no
    -- new table: a decision is a row that already had to exist for the module screen
    -- to mean anything. The `kind` is what the caller turns into a route.
    'timeline', (
      select coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) from (
        select e.* from (
          select pv.submitted_at as at,
                 'proposal'::text as kind,
                 pr.id as proposal_id,
                 null::uuid as budget_id,
                 null::uuid as task_id,
                 pr.title as title,
                 'Submitted version ' || pv.version_number::text as detail,
                 (select a.display_name from smartgov.accounts a where a.id = pv.submitted_by) as actor
            from smartgov.proposal_versions pv
            join smartgov.proposals pr on pr.id = pv.proposal_id
           where pv.proposal_id = any (v_proposals)
          union all
          select r.created_at,
                 'decision',
                 r.proposal_id,
                 null::uuid,
                 null::uuid,
                 pr.title,
                 'Proposal ' || r.decision,
                 (select a.display_name from smartgov.accounts a where a.id = r.decided_by)
            from smartgov.reviews r
            join smartgov.proposals pr on pr.id = r.proposal_id
           where r.proposal_id = any (v_proposals)
          union all
          select v.created_at,
                 'document',
                 pv.proposal_id,
                 null::uuid,
                 null::uuid,
                 pr.title,
                 ri.label || ' marked ' || v.verdict,
                 (select a.display_name from smartgov.accounts a where a.id = v.verified_by)
            from smartgov.submission_verifications v
            join smartgov.item_submissions isub on isub.id = v.submission_id
            join smartgov.proposal_versions pv on pv.id = isub.version_id
            join smartgov.proposals pr on pr.id = pv.proposal_id
            join smartgov.requirement_items ri on ri.id = isub.requirement_item_id
           where pv.proposal_id = any (v_proposals)
          union all
          select b.created_at,
                 'budget',
                 b.proposal_id,
                 b.id,
                 null::uuid,
                 b.title,
                 'Budget ' || b.status,
                 (select a.display_name from smartgov.accounts a where a.id = b.requested_by)
            from smartgov.budget_requests b
           where b.organization_id = v_account.organization_id
             and (
               v_is_usg
               or b.requested_by = v_account.id
               or (b.unit_id is not null and b.unit_id = any (v_units))
             )
          union all
          select t.created_at,
                 'task',
                 null::uuid,
                 null::uuid,
                 t.id,
                 t.title,
                 'Task assigned',
                 (select a.display_name from smartgov.accounts a where a.id = t.created_by)
            from smartgov.tasks t
           where t.organization_id = v_account.organization_id
             and (v_is_usg or exists (
                   select 1 from smartgov.task_assignments ta
                    where ta.task_id = t.id
                      and ta.unit_id = any (v_units)))
          union all
          select ta.updated_at,
                 'task',
                 null::uuid,
                 null::uuid,
                 t.id,
                 t.title,
                 'Unit work ' || ta.status,
                 (select a.display_name from smartgov.accounts a where a.id = ta.updated_by)
            from smartgov.task_assignments ta
            join smartgov.tasks t on t.id = ta.task_id
           where t.organization_id = v_account.organization_id
             and (v_is_usg or ta.unit_id = any (v_units))
        ) e
        order by e.at desc, e.kind desc
        limit 12
      ) q
    )
  );
end;
$$;
revoke all on function smartgov.list_dashboard(text) from public;

create or replace function smartgov.list_resolutions(p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_usg     boolean;
  v_unit_id uuid;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if v_account.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;

  v_usg := smartgov.is_usg_side(v_account);
  v_unit_id := smartgov.my_lsg_unit(v_account);

  return jsonb_build_object(
    'ok', true,
    'canReview', v_usg,
    'rows', coalesce((
      select jsonb_agg(row order by row->>'createdAt' desc)
      from (
        select jsonb_build_object(
          'id', r.id,
          'title', r.title,
          'resolutionNo', r.resolution_no,
          'datePassed', r.date_passed,
          'shortSummary', r.short_summary,
          'proposedBudget', r.proposed_budget,
          'status', r.status,
          'scope', r.scope,
          'unitId', r.unit_id,
          'unitName', u.name,
          'hasAttachment', r.storage_path is not null,
          'createdAt', r.created_at,
          'decidedAt', r.decided_at,
          'decisionRemark', r.decision_remark
        ) as row
        from smartgov.resolutions r
        left join public.governance_units u on u.id = r.unit_id
        where r.organization_id = v_account.organization_id
          and (
            v_usg
            or r.unit_id = v_unit_id
            or (r.scope = 'org' and r.status = 'approved')
          )
      ) s
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function smartgov.list_resolutions(text) from public;

create or replace function smartgov.get_resolution(
  p_session_token text,
  p_resolution_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_usg     boolean;
  v_unit_id uuid;
  v_row     smartgov.resolutions%rowtype;
  v_name    text;
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
  v_unit_id := smartgov.my_lsg_unit(v_account);

  select r.* into v_row
    from smartgov.resolutions r
   where r.id = p_resolution_id
     and r.organization_id = v_account.organization_id;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  v_visible := v_usg
    or v_row.unit_id = v_unit_id
    or (v_row.scope = 'org' and v_row.status = 'approved');

  if not v_visible then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  select u.name into v_name
    from public.governance_units u
   where u.id = v_row.unit_id;

  return jsonb_build_object(
    'ok', true,
    'canReview', v_usg,
    'item', jsonb_build_object(
      'id', v_row.id,
      'title', v_row.title,
      'resolutionNo', v_row.resolution_no,
      'datePassed', v_row.date_passed,
      'shortSummary', v_row.short_summary,
      'body', v_row.body,
      'proposedBudget', v_row.proposed_budget,
      'status', v_row.status,
      'scope', v_row.scope,
      'unitId', v_row.unit_id,
      'unitName', v_name,
      'storagePath', v_row.storage_path,
      'originalName', v_row.original_name,
      'mimeType', v_row.mime_type,
      'sizeBytes', v_row.size_bytes,
      'createdAt', v_row.created_at,
      'decidedAt', v_row.decided_at,
      'decisionRemark', v_row.decision_remark,
      'timeline', coalesce((
        select jsonb_agg(jsonb_build_object(
          'decision', rr.decision,
          'remark', rr.remark,
          'reviewerName', a.display_name,
          'createdAt', rr.created_at
        ) order by rr.created_at asc)
        from smartgov.resolution_reviews rr
        left join smartgov.accounts a on a.id = rr.reviewer_id
        where rr.resolution_id = v_row.id
      ), '[]'::jsonb)
    )
  );
end;
$$;
revoke all on function smartgov.get_resolution(text, uuid) from public;

create or replace function smartgov.get_resolution_file(
  p_session_token text,
  p_resolution_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_usg     boolean;
  v_unit_id uuid;
  v_row     smartgov.resolutions%rowtype;
  v_upload  smartgov.document_uploads%rowtype;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  select r.* into v_row
    from smartgov.resolutions r
   where r.id = p_resolution_id
     and r.organization_id = v_account.organization_id;

  if not found or v_row.storage_path is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  v_usg := smartgov.is_usg_side(v_account);
  v_unit_id := smartgov.my_lsg_unit(v_account);

  if not (
    v_usg
    or v_row.unit_id = v_unit_id
    or (v_row.scope = 'org' and v_row.status = 'approved')
  ) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  select du.* into v_upload
    from smartgov.document_uploads du
   where du.storage_path = v_row.storage_path
     and du.resolution = v_row.id
     and du.confirmed_at is not null;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  return jsonb_build_object(
    'ok', true,
    'oid', v_upload.large_object_oid,
    'originalName', v_upload.original_name,
    'mimeType', v_upload.mime_type,
    'sizeBytes', v_upload.size_bytes
  );
end;
$$;
revoke all on function smartgov.get_resolution_file(text, uuid) from public;

notify pgrst, 'reload schema';
