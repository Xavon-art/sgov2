-- 03150 -- Scheduler sweep, email queue, and lazy evaluation backstop.
--
-- Every timed behaviour in SmartGov is computed on read, so the system stays
-- correct even when no scheduler ran. This migration adds the one place that
-- *materialises* those transitions (status flips, notifications, emails) so
-- the in-app notification centre and the Outbox agree with what the read path
-- already reports.
--
-- The sweep is idempotent: every UPDATE is guarded by the state it is leaving,
-- so running it twice in a row changes nothing the second time.

-- ---------------------------------------------------------------------------
-- 1. Email queue.
--
-- SQL cannot send mail, so the sweep writes to this queue and the API route
-- drains it through Nodemailer (or the dev Outbox when SMTP is absent).
-- ---------------------------------------------------------------------------
create table if not exists smartgov.email_queue (
  id          uuid primary key default gen_random_uuid(),
  to_address  text not null,
  subject     text not null,
  html        text,
  text_body   text,
  created_at  timestamptz not null default now(),
  claimed_at  timestamptz,
  sent_at     timestamptz,
  attempts    integer not null default 0,
  last_error  text
);
create index if not exists email_queue_pending_idx
  on smartgov.email_queue (created_at)
  where sent_at is null;

revoke all on smartgov.email_queue from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Personal requests may now reach a terminal `expired` state.
-- ---------------------------------------------------------------------------
alter table smartgov.personal_requests
  drop constraint if exists personal_requests_status_check;
alter table smartgov.personal_requests
  add constraint personal_requests_status_check
  check (status in ('submitted', 'granted', 'declined', 'withdrawn', 'expired'));

-- ---------------------------------------------------------------------------
-- 3. The sweep.
-- ---------------------------------------------------------------------------
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
     where r.status = 'submitted'
  loop
    if v_req.deadline is not null and v_req.deadline <= now() then
      update smartgov.personal_requests
         set status = 'expired'
       where id = v_req.id
         and status = 'submitted';

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
           '/usg/survey');

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

-- ---------------------------------------------------------------------------
-- 4. Email queue helpers for the cron route.
-- ---------------------------------------------------------------------------
create or replace function smartgov.list_pending_emails(p_limit integer)
returns jsonb
language sql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
  select coalesce(jsonb_agg(row_to_json(e) order by e.created_at), '[]'::jsonb)
  from (
    select id, to_address, subject, html, text_body, created_at, attempts
      from smartgov.email_queue
     where sent_at is null
     order by created_at
     limit greatest(1, least(coalesce(p_limit, 25), 100))
  ) e;
$$;
revoke all on function smartgov.list_pending_emails(integer) from public;

create or replace function smartgov.mark_email_sent(p_id uuid, p_error text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
begin
  if p_error is null then
    update smartgov.email_queue
       set sent_at = now(),
           claimed_at = coalesce(claimed_at, now()),
           attempts = attempts + 1,
           last_error = null
     where id = p_id;
  else
    update smartgov.email_queue
       set claimed_at = now(),
           attempts = attempts + 1,
           last_error = left(p_error, 500)
     where id = p_id;
  end if;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function smartgov.mark_email_sent(uuid, text) from public;

-- ---------------------------------------------------------------------------
-- 5. Public wrappers (the app talks to PostgREST in the `public` schema).
-- ---------------------------------------------------------------------------
create or replace function public.sweep()
returns jsonb
language sql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.sweep(); $$;
revoke all on function public.sweep() from public;
grant execute on function public.sweep() to anon, authenticated, service_role;

create or replace function public.list_pending_emails(p_limit integer)
returns jsonb
language sql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.list_pending_emails(p_limit); $$;
revoke all on function public.list_pending_emails(integer) from public;
grant execute on function public.list_pending_emails(integer) to anon, authenticated, service_role;

create or replace function public.mark_email_sent(p_id uuid, p_error text)
returns jsonb
language sql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.mark_email_sent(p_id, p_error); $$;
revoke all on function public.mark_email_sent(uuid, text) from public;
grant execute on function public.mark_email_sent(uuid, text) to anon, authenticated, service_role;
