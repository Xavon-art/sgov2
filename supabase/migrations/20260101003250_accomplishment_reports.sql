create table if not exists smartgov.accomplishment_reports (
  id                      uuid primary key default gen_random_uuid(),
  organization_id         uuid not null,
  event_id                uuid not null references smartgov.events (id) on delete cascade,
  reporting_unit_id       uuid references public.governance_units (id) on delete set null,
  reporting_side          text not null check (reporting_side in ('lsg', 'usg')),
  created_by              uuid not null references smartgov.accounts (id) on delete cascade,
  narrative               text not null check (length(btrim(narrative)) >= 10 and length(narrative) <= 12000),
  highlights              text not null default '' check (length(highlights) <= 2000),
  attachment_submission_id uuid references smartgov.item_submissions (id) on delete set null,
  status                  text not null default 'submitted'
    check (status in ('submitted', 'acknowledged', 'returned')),
  decision_remark         text,
  reviewed_by             uuid references smartgov.accounts (id) on delete set null,
  reviewed_at             timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create unique index if not exists accomplishment_reports_one_per_reporting_unit
  on smartgov.accomplishment_reports
  (event_id, reporting_side, coalesce(reporting_unit_id, '00000000-0000-0000-0000-000000000000'::uuid));

create index if not exists accomplishment_reports_org_event_idx
  on smartgov.accomplishment_reports (organization_id, event_id);

create table if not exists smartgov.accomplishment_report_reviews (
  id            uuid primary key default gen_random_uuid(),
  report_id     uuid not null references smartgov.accomplishment_reports (id) on delete cascade,
  reviewer_id   uuid references smartgov.accounts (id) on delete set null,
  decision      text not null check (decision in ('acknowledged', 'returned')),
  remark        text,
  created_at    timestamptz not null default now()
);

create index if not exists accomplishment_report_reviews_report_idx
  on smartgov.accomplishment_report_reviews (report_id, created_at);

alter table smartgov.accomplishment_reports enable row level security;
alter table smartgov.accomplishment_report_reviews enable row level security;
revoke all on smartgov.accomplishment_reports from public, anon, authenticated;
revoke all on smartgov.accomplishment_report_reviews from public, anon, authenticated;

create or replace function smartgov.submit_accomplishment_report(
  p_session_token text,
  p_event_id uuid,
  p_narrative text,
  p_highlights text default '',
  p_attachment_submission_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account   smartgov.accounts%rowtype;
  v_event     smartgov.events%rowtype;
  v_usg       boolean;
  v_unit      uuid;
  v_root_unit uuid;
  v_side      text;
  v_reporting_unit uuid;
  v_narrative text := btrim(coalesce(p_narrative, ''));
  v_highlights text := btrim(coalesce(p_highlights, ''));
  v_doc       jsonb;
  v_existing_id uuid;
  v_existing_status text;
  v_existing_side text;
  v_existing_unit uuid;
  v_id        uuid;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if v_account.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;
  if length(v_narrative) < 10 or length(v_narrative) > 12000 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_narrative');
  end if;
  if length(v_highlights) > 2000 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_highlights');
  end if;

  select e.* into v_event
  from smartgov.events e
  where e.id = p_event_id
    and e.organization_id = v_account.organization_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_event.cancelled_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'event_not_available');
  end if;

  v_usg := smartgov.is_usg_side(v_account);
  v_unit := smartgov.my_lsg_unit(v_account);

  if v_usg then
    if v_event.source <> 'usg' or v_event.scope not in ('university', 'unit_type', 'units', 'unit') then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
    v_side := 'usg';
    select gu.id into v_root_unit
    from public.governance_units gu
    where gu.organization_id = v_account.organization_id
      and gu.unit_type = 'usg'
    order by gu.created_at asc nulls last
    limit 1;
    v_reporting_unit := v_root_unit;
  else
    if v_unit is null then
      return jsonb_build_object('ok', false, 'reason', 'no_unit');
    end if;
    if v_event.source <> 'lsg'
       or v_event.honor_status = 'not_honored'
       or (v_event.created_by <> v_account.id and v_event.unit_id <> v_unit) then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
    v_side := 'lsg';
    v_reporting_unit := v_unit;
  end if;

  if p_attachment_submission_id is not null then
    v_doc := smartgov.get_document(p_session_token, p_attachment_submission_id);
    if coalesce((v_doc ->> 'ok')::boolean, false) is not true then
      return jsonb_build_object('ok', false, 'reason', 'attachment_not_allowed');
    end if;
  end if;

  select r.id, r.status, r.reporting_side, r.reporting_unit_id
    into v_existing_id, v_existing_status, v_existing_side, v_existing_unit
  from smartgov.accomplishment_reports r
  where r.event_id = p_event_id
    and r.reporting_unit_id is not distinct from v_reporting_unit
  limit 1;

  if found then
    if v_existing_status = 'returned' and v_existing_side = v_side then
      update smartgov.accomplishment_reports
         set narrative = v_narrative,
             highlights = v_highlights,
             attachment_submission_id = p_attachment_submission_id,
             status = 'submitted',
             decision_remark = null,
             reviewed_by = null,
             reviewed_at = null,
             updated_at = now()
       where id = v_existing_id;
      return jsonb_build_object('ok', true, 'id', v_existing_id, 'updated', true);
    end if;
    return jsonb_build_object('ok', false, 'reason', 'duplicate_report');
  end if;

  insert into smartgov.accomplishment_reports
    (organization_id, event_id, reporting_unit_id, reporting_side, created_by,
     narrative, highlights, attachment_submission_id)
  values
    (v_account.organization_id, p_event_id, v_reporting_unit, v_side, v_account.id,
     v_narrative, v_highlights, p_attachment_submission_id)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

revoke all on function smartgov.submit_accomplishment_report(text, uuid, text, text, uuid) from public;

create or replace function smartgov.list_accomplishment_reports(
  p_session_token text,
  p_event_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_usg     boolean;
  v_unit    uuid;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if v_account.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;

  v_usg := smartgov.is_usg_side(v_account);
  v_unit := smartgov.my_lsg_unit(v_account);

  return jsonb_build_object(
    'ok', true,
    'canReview', v_usg,
    'rows', coalesce((
      select jsonb_agg(row order by row ->> 'submittedAt' desc)
      from (
        select jsonb_build_object(
          'id', r.id,
          'eventId', r.event_id,
          'eventTitle', e.title,
          'unitName', coalesce(u.name, 'Organization-wide'),
          'status', r.status,
          'submittedAt', r.created_at,
          'canReview', v_usg and r.reporting_side = 'lsg'
        ) as row
        from smartgov.accomplishment_reports r
        join smartgov.events e on e.id = r.event_id
        left join public.governance_units u on u.id = r.reporting_unit_id
        where r.organization_id = v_account.organization_id
          and (v_usg or (r.reporting_side = 'lsg' and r.reporting_unit_id = v_unit))
          and (p_event_id is null or r.event_id = p_event_id)
      ) s
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function smartgov.list_accomplishment_reports(text, uuid) from public;

create or replace function smartgov.get_accomplishment_report(
  p_session_token text,
  p_report_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_usg     boolean;
  v_unit    uuid;
  v_row     smartgov.accomplishment_reports%rowtype;
  v_event_title text;
  v_unit_name text;
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
  v_unit := smartgov.my_lsg_unit(v_account);

  select r.* into v_row
  from smartgov.accomplishment_reports r
  where r.id = p_report_id
    and r.organization_id = v_account.organization_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  v_visible := v_usg or (v_row.reporting_side = 'lsg' and v_row.reporting_unit_id = v_unit);
  if not v_visible then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  select e.title into v_event_title
  from smartgov.events e
  where e.id = v_row.event_id;
  select u.name into v_unit_name
  from public.governance_units u
  where u.id = v_row.reporting_unit_id;

  return jsonb_build_object(
    'ok', true,
    'canReview', v_usg and v_row.reporting_side = 'lsg',
    'item', jsonb_build_object(
      'id', v_row.id,
      'eventId', v_row.event_id,
      'eventTitle', v_event_title,
      'reportingUnitId', v_row.reporting_unit_id,
      'unitName', coalesce(v_unit_name, 'Organization-wide'),
      'status', v_row.status,
      'submittedAt', v_row.created_at,
      'narrative', v_row.narrative,
      'highlights', v_row.highlights,
      'attachmentSubmissionId', v_row.attachment_submission_id,
      'decisionRemark', v_row.decision_remark,
      'reviewedAt', v_row.reviewed_at,
      'timeline', coalesce((
        select jsonb_agg(jsonb_build_object(
          'decision', rr.decision,
          'remark', rr.remark,
          'reviewerName', a.display_name,
          'createdAt', rr.created_at
        ) order by rr.created_at asc)
        from smartgov.accomplishment_report_reviews rr
        left join smartgov.accounts a on a.id = rr.reviewer_id
        where rr.report_id = v_row.id
      ), '[]'::jsonb)
    )
  );
end;
$$;

revoke all on function smartgov.get_accomplishment_report(text, uuid) from public;

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
  v_account  smartgov.accounts%rowtype;
  v_row      smartgov.accomplishment_reports%rowtype;
  v_decision text := lower(btrim(coalesce(p_decision, '')));
  v_remark   text := nullif(btrim(coalesce(p_remark, '')), '');
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if v_account.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;
  if not smartgov.is_usg_side(v_account) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if v_decision not in ('acknowledged', 'returned') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;
  if v_decision = 'returned' and v_remark is null then
    return jsonb_build_object('ok', false, 'reason', 'remark_required');
  end if;

  select r.* into v_row
  from smartgov.accomplishment_reports r
  where r.id = p_report_id
    and r.organization_id = v_account.organization_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_row.reporting_side <> 'lsg' then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  insert into smartgov.accomplishment_report_reviews (report_id, reviewer_id, decision, remark)
  values (v_row.id, v_account.id, v_decision, v_remark);

  update smartgov.accomplishment_reports
     set status = v_decision,
         decision_remark = v_remark,
         reviewed_by = v_account.id,
         reviewed_at = now(),
         updated_at = now()
   where id = v_row.id;

  return jsonb_build_object('ok', true, 'id', v_row.id, 'status', v_decision);
end;
$$;

revoke all on function smartgov.review_accomplishment_report(text, uuid, text, text) from public;

create or replace function public.submit_accomplishment_report(
  p_session_token text,
  p_event_id uuid,
  p_narrative text,
  p_highlights text default '',
  p_attachment_submission_id uuid default null
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.submit_accomplishment_report(p_session_token, p_event_id, p_narrative, p_highlights, p_attachment_submission_id); $$;
revoke all on function public.submit_accomplishment_report(text, uuid, text, text, uuid) from public;
grant execute on function public.submit_accomplishment_report(text, uuid, text, text, uuid) to anon, authenticated;

create or replace function public.list_accomplishment_reports(
  p_session_token text,
  p_event_id uuid default null
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.list_accomplishment_reports(p_session_token, p_event_id); $$;
revoke all on function public.list_accomplishment_reports(text, uuid) from public;
grant execute on function public.list_accomplishment_reports(text, uuid) to anon, authenticated;

create or replace function public.get_accomplishment_report(
  p_session_token text,
  p_report_id uuid
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.get_accomplishment_report(p_session_token, p_report_id); $$;
revoke all on function public.get_accomplishment_report(text, uuid) from public;
grant execute on function public.get_accomplishment_report(text, uuid) to anon, authenticated;

create or replace function public.review_accomplishment_report(
  p_session_token text,
  p_report_id uuid,
  p_decision text,
  p_remark text default null
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.review_accomplishment_report(p_session_token, p_report_id, p_decision, p_remark); $$;
revoke all on function public.review_accomplishment_report(text, uuid, text, text) from public;
grant execute on function public.review_accomplishment_report(text, uuid, text, text) to anon, authenticated;
