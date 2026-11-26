alter function smartgov.submit_assignment_for_review(text, uuid, uuid) rename to submit_assignment_for_review_legacy;

create or replace function smartgov.submit_assignment_for_review(
  p_session_token text,
  p_task_id uuid,
  p_unit_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_started_at timestamptz := clock_timestamp();
  v_result jsonb;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  v_result := smartgov.submit_assignment_for_review_legacy(p_session_token, p_task_id, p_unit_id);

  if coalesce((v_result ->> 'ok')::boolean, false) then
    update smartgov.notifications
       set link = '/usg/request?tab=review&task=' || p_task_id::text
     where kind = 'task_submitted'
       and organization_id = v_account.organization_id
       and created_at >= v_started_at;
  end if;

  return v_result;
end;
$$;

revoke all on function smartgov.submit_assignment_for_review(text, uuid, uuid) from public;

update smartgov.notifications
   set link = '/usg/request?tab=review'
 where kind = 'task_submitted'
   and link = '/usg/request';

alter function smartgov.review_requirement_answer(text, uuid, uuid, text, text) rename to review_requirement_answer_legacy;

create or replace function smartgov.review_requirement_answer(
  p_session_token text,
  p_requirement_id uuid,
  p_unit_id uuid,
  p_verdict text,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_started_at timestamptz := clock_timestamp();
  v_task_id uuid;
  v_result jsonb;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  v_result := smartgov.review_requirement_answer_legacy(
    p_session_token, p_requirement_id, p_unit_id, p_verdict, p_note
  );

  if coalesce((v_result ->> 'ok')::boolean, false) then
    select rq.task_id into v_task_id
      from smartgov.task_requirements rq
     where rq.id = p_requirement_id;

    if v_task_id is not null then
      update smartgov.notifications
         set link = '/lsg/request?tab=tasks&task=' || v_task_id::text
       where kind like 'task_requirement_%'
         and organization_id = v_account.organization_id
         and created_at >= v_started_at;
    end if;
  end if;

  return v_result;
end;
$$;

revoke all on function smartgov.review_requirement_answer(text, uuid, uuid, text, text) from public;

update smartgov.notifications
   set link = '/lsg/request?tab=tasks'
 where kind like 'task_requirement_%'
   and link = '/lsg/request';

alter function smartgov.submit_unit_budget_request(text, uuid, uuid, text, text, jsonb, uuid, uuid) rename to submit_unit_budget_request_legacy;

create or replace function smartgov.submit_unit_budget_request(
  p_session_token text,
  p_unit_id uuid,
  p_period_id uuid,
  p_title text,
  p_justification text,
  p_items jsonb,
  p_event_id uuid,
  p_proposal_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_started_at timestamptz := clock_timestamp();
  v_budget_id uuid;
  v_result jsonb;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  v_result := smartgov.submit_unit_budget_request_legacy(
    p_session_token, p_unit_id, p_period_id, p_title, p_justification,
    p_items, p_event_id, p_proposal_id
  );

  if coalesce((v_result ->> 'ok')::boolean, false) then
    v_budget_id := (v_result ->> 'budgetId')::uuid;
    if v_budget_id is not null then
      update smartgov.notifications
         set link = '/usg/manage?tab=budget&budgetTab=review&budget=' || v_budget_id::text
       where kind = 'budget_submitted'
         and organization_id = v_account.organization_id
         and created_at >= v_started_at;
    end if;
  end if;

  return v_result;
end;
$$;

revoke all on function smartgov.submit_unit_budget_request(text, uuid, uuid, text, text, jsonb, uuid, uuid) from public;

alter function smartgov.review_budget(text, uuid, text, numeric, text) rename to review_budget_legacy;

create or replace function smartgov.review_budget(
  p_session_token text,
  p_budget_id uuid,
  p_decision text,
  p_approved_total numeric,
  p_remark text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_started_at timestamptz := clock_timestamp();
  v_result jsonb;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  v_result := smartgov.review_budget_legacy(
    p_session_token, p_budget_id, p_decision, p_approved_total, p_remark
  );

  if coalesce((v_result ->> 'ok')::boolean, false) then
    update smartgov.notifications
       set link = '/lsg/manage?tab=budget&budgetTab=overview&budget=' || p_budget_id::text
     where kind like 'budget_%'
       and kind <> 'budget_submitted'
       and organization_id = v_account.organization_id
       and created_at >= v_started_at;
  end if;

  return v_result;
end;
$$;

revoke all on function smartgov.review_budget(text, uuid, text, numeric, text) from public;

update smartgov.notifications
   set link = '/usg/manage?tab=budget&budgetTab=review'
 where kind = 'budget_submitted'
   and link = '/usg/budget';

update smartgov.notifications
   set link = '/lsg/manage?tab=budget&budgetTab=overview'
 where kind like 'budget_%'
   and kind <> 'budget_submitted'
   and link = '/lsg/budget';

alter function smartgov.request_task_extension(text, uuid, uuid, timestamptz, text) rename to request_task_extension_legacy;

create or replace function smartgov.request_task_extension(
  p_session_token text,
  p_task_id uuid,
  p_unit_id uuid,
  p_requested_due_at timestamptz,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_started_at timestamptz := clock_timestamp();
  v_result jsonb;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  v_result := smartgov.request_task_extension_legacy(
    p_session_token, p_task_id, p_unit_id, p_requested_due_at, p_reason
  );

  if coalesce((v_result ->> 'ok')::boolean, false) then
    update smartgov.notifications
       set link = '/usg/request?tab=review&task=' || p_task_id::text
     where kind = 'task_extension_requested'
       and organization_id = v_account.organization_id
       and created_at >= v_started_at;
  end if;

  return v_result;
end;
$$;

revoke all on function smartgov.request_task_extension(text, uuid, uuid, timestamptz, text) from public;

alter function smartgov.decide_task_extension(text, uuid, text, text) rename to decide_task_extension_legacy;

create or replace function smartgov.decide_task_extension(
  p_session_token text,
  p_extension_id uuid,
  p_decision text,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_started_at timestamptz := clock_timestamp();
  v_task_id uuid;
  v_result jsonb;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  v_result := smartgov.decide_task_extension_legacy(
    p_session_token, p_extension_id, p_decision, p_note
  );

  if coalesce((v_result ->> 'ok')::boolean, false) then
    select e.task_id into v_task_id
      from smartgov.task_extensions e
     where e.id = p_extension_id;

    if v_task_id is not null then
      update smartgov.notifications
         set link = '/lsg/request?tab=tasks&task=' || v_task_id::text
       where kind in ('task_extension_approved', 'task_extension_rejected')
         and organization_id = v_account.organization_id
         and created_at >= v_started_at;
    end if;
  end if;

  return v_result;
end;
$$;

revoke all on function smartgov.decide_task_extension(text, uuid, text, text) from public;

update smartgov.notifications
   set link = '/usg/request?tab=review'
 where kind in ('task_extension_requested', 'task_review_sla_overdue')
   and link = '/usg/request';

update smartgov.notifications
   set link = '/lsg/request?tab=tasks'
 where kind in ('task_extension_approved', 'task_extension_rejected')
   and link = '/lsg/request';

alter function smartgov.create_event_v2(text, text, text, date, time, text, text, text, uuid[], text[], jsonb, uuid, text) rename to create_event_v2_notifications_base;

create or replace function smartgov.create_event_v2(
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
  v_account smartgov.accounts%rowtype;
  v_started_at timestamptz := clock_timestamp();
  v_event_id uuid;
  v_result jsonb;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  v_result := smartgov.create_event_v2_notifications_base(
    p_session_token, p_title, p_description, p_event_date, p_event_time,
    p_timezone, p_venue, p_scope, p_unit_ids, p_unit_types, p_files,
    p_link_request, p_claim_note
  );

  if coalesce((v_result ->> 'ok')::boolean, false) then
    v_event_id := (v_result ->> 'eventId')::uuid;
    if v_event_id is not null then
      update smartgov.notifications
         set link = case
           when kind = 'event_claim' then '/usg/events?event=' || v_event_id::text || '&action=decide'
           else '/lsg/events?event=' || v_event_id::text || '&action=claim'
         end
       where kind in ('event_published', 'event_claim')
         and organization_id = v_account.organization_id
         and created_at >= v_started_at;
    end if;
  end if;

  return v_result;
end;
$$;

revoke all on function smartgov.create_event_v2(text, text, text, date, time, text, text, text, uuid[], text[], jsonb, uuid, text) from public;

alter function smartgov.decide_event(text, uuid, text, text) rename to decide_event_notifications_base;

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
  v_account smartgov.accounts%rowtype;
  v_started_at timestamptz := clock_timestamp();
  v_result jsonb;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  v_result := smartgov.decide_event_notifications_base(
    p_session_token, p_event_id, p_decision, p_note
  );

  if coalesce((v_result ->> 'ok')::boolean, false) then
    update smartgov.notifications
       set link = '/lsg/events?event=' || p_event_id::text
     where kind in ('event_honored', 'event_not_honored')
       and organization_id = v_account.organization_id
       and created_at >= v_started_at;
  end if;

  return v_result;
end;
$$;

revoke all on function smartgov.decide_event(text, uuid, text, text) from public;

update smartgov.notifications
   set link = '/lsg/events?tab=accomplishment'
 where kind in ('event_published', 'event_honored', 'event_not_honored')
   and link = '/lsg/events';

alter function smartgov.set_event_assignees(text, uuid, uuid[]) rename to set_event_assignees_notifications_base;

create or replace function smartgov.set_event_assignees(
  p_session_token text,
  p_event_id uuid,
  p_account_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_started_at timestamptz := clock_timestamp();
  v_result jsonb;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  v_result := smartgov.set_event_assignees_notifications_base(
    p_session_token, p_event_id, p_account_ids
  );

  if coalesce((v_result ->> 'ok')::boolean, false) then
    update smartgov.notifications
       set link = '/lsg/events?tab=accomplishment&event=' || p_event_id::text || '&action=report'
     where kind = 'event_assigned'
       and organization_id = v_account.organization_id
       and created_at >= v_started_at;
  end if;

  return v_result;
end;
$$;

revoke all on function smartgov.set_event_assignees(text, uuid, uuid[]) from public;

alter function smartgov.submit_accomplishment_report_v2(text, uuid, text, text, uuid, text[]) rename to submit_accomplishment_report_v2_notifications_base;

create or replace function smartgov.submit_accomplishment_report_v2(
  p_session_token text,
  p_event_id uuid,
  p_narrative text,
  p_highlights text default '',
  p_attachment_submission_id uuid default null,
  p_file_paths text[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_report_id uuid;
  v_title text;
  v_body text;
  v_target uuid;
  v_result jsonb;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  v_result := smartgov.submit_accomplishment_report_v2_notifications_base(
    p_session_token, p_event_id, p_narrative, p_highlights,
    p_attachment_submission_id, p_file_paths
  );

  if coalesce((v_result ->> 'ok')::boolean, false) then
    v_report_id := (v_result ->> 'id')::uuid;
    if v_report_id is not null then
      select title into v_title from smartgov.events where id = p_event_id;
      v_body := coalesce(nullif(btrim(coalesce(v_title, '')), ''), 'An event') || ' has an accomplishment report to review.';

      for v_target in
        select a.id from smartgov.accounts a
         where a.organization_id = v_account.organization_id
           and a.status = 'active'
           and a.id <> v_account.id
           and (a.account_scope = 'owner' or smartgov.is_org_reviewer(a.id, a.organization_id))
      loop
        if not exists (
          select 1 from smartgov.notifications n
           where n.account_id = v_target
             and n.kind = 'accomplishment_report_submitted'
             and n.link = '/usg/events?tab=accomplishment&report=' || v_report_id::text
        ) then
          insert into smartgov.notifications (account_id, organization_id, kind, title, body, link)
          values (
            v_target, v_account.organization_id, 'accomplishment_report_submitted',
            'Accomplishment report submitted', v_body,
            '/usg/events?tab=accomplishment&report=' || v_report_id::text
          );
        end if;
      end loop;
    end if;
  end if;

  return v_result;
end;
$$;

revoke all on function smartgov.submit_accomplishment_report_v2(text, uuid, text, text, uuid, text[]) from public;

alter function smartgov.review_accomplishment_report(text, uuid, text, text) rename to review_accomplishment_report_notifications_base;

create or replace function smartgov.review_accomplishment_report(
  p_session_token text,
  p_report_id uuid,
  p_decision text,
  p_remark text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_reporter uuid;
  v_org uuid;
  v_title text;
  v_kind text;
  v_body text;
  v_result jsonb;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  v_result := smartgov.review_accomplishment_report_notifications_base(
    p_session_token, p_report_id, p_decision, p_remark
  );

  if coalesce((v_result ->> 'ok')::boolean, false) then
    select r.created_by, r.organization_id, e.title
      into v_reporter, v_org, v_title
      from smartgov.accomplishment_reports r
      join smartgov.events e on e.id = r.event_id
     where r.id = p_report_id;

    if v_reporter is not null and v_reporter <> v_account.id then
      v_kind := case when lower(btrim(coalesce(p_decision, ''))) = 'returned'
        then 'accomplishment_report_returned'
        else 'accomplishment_report_acknowledged' end;
      v_body := coalesce(nullif(btrim(coalesce(v_title, '')), ''), 'Your report')
        || case when v_kind = 'accomplishment_report_returned'
          then ' needs revision.' else ' was acknowledged.' end;

      if not exists (
        select 1 from smartgov.notifications n
         where n.account_id = v_reporter
           and n.kind = v_kind
           and n.link = '/lsg/events?tab=accomplishment&report=' || p_report_id::text
      ) then
        insert into smartgov.notifications (account_id, organization_id, kind, title, body, link)
        values (
          v_reporter, v_org, v_kind,
          case when v_kind = 'accomplishment_report_returned'
            then 'Accomplishment report returned'
            else 'Accomplishment report acknowledged' end,
          v_body,
          '/lsg/events?tab=accomplishment&report=' || p_report_id::text
        );
      end if;
    end if;
  end if;

  return v_result;
end;
$$;

revoke all on function smartgov.review_accomplishment_report(text, uuid, text, text) from public;

alter function smartgov.sweep() rename to sweep_notifications_base;

create or replace function smartgov.sweep()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_started_at timestamptz := clock_timestamp();
  v_result jsonb;
begin
  v_result := smartgov.sweep_notifications_base();

  update smartgov.notifications
     set link = case
       when link like '/usg/%' then '/usg/forms?type=survey&id=' || split_part(link, '/', 4)
       else '/lsg/forms?type=survey&id=' || split_part(link, '/', 4)
     end
   where kind = 'survey_closed'
     and (link like '/usg/surveys/%' or link like '/lsg/surveys/%')
     and created_at >= v_started_at;

  return v_result;
end;
$$;

revoke all on function smartgov.sweep() from public;

update smartgov.notifications
   set link = '/usg/forms?type=survey&id=' || split_part(link, '/', 4)
 where kind = 'survey_closed'
   and link like '/usg/surveys/%';

update smartgov.notifications
   set link = '/lsg/forms?type=survey&id=' || split_part(link, '/', 4)
 where kind = 'survey_closed'
   and link like '/lsg/surveys/%';
