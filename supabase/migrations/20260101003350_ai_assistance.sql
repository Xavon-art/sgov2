-- AI assistance: persisted survey summaries and per-account AI quotas.
-- Machine output is validated in the app, but the database remains the
-- authority for who may read or replace a survey's summary.

create table if not exists smartgov.survey_ai_summaries (
  survey_id uuid primary key references smartgov.surveys (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  summary jsonb not null,
  response_count integer not null check (response_count >= 0),
  model text not null,
  generated_by uuid references smartgov.accounts (id) on delete set null,
  generated_at timestamptz not null default now()
);

alter table smartgov.survey_ai_summaries enable row level security;

revoke all on smartgov.survey_ai_summaries from public, anon, authenticated;

create or replace function smartgov.get_survey_ai_summary(
  p_session_token text,
  p_survey_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_survey smartgov.surveys%rowtype;
  v_summary smartgov.survey_ai_summaries%rowtype;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if v_account.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;

  select * into v_survey
    from smartgov.surveys
   where id = p_survey_id
     and organization_id = v_account.organization_id;
  if v_survey.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if not (
    v_account.account_scope = 'owner'
    or v_account.id = v_survey.created_by
    or v_account.id = any(v_survey.result_viewer_ids)
  ) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  select * into v_summary
    from smartgov.survey_ai_summaries
   where survey_id = v_survey.id;

  if v_summary.survey_id is null then
    return jsonb_build_object('ok', true, 'summary', null);
  end if;

  return jsonb_build_object(
    'ok', true,
    'summary', v_summary.summary,
    'responseCount', v_summary.response_count,
    'generatedAt', v_summary.generated_at,
    'model', v_summary.model
  );
end;
$$;

revoke all on function smartgov.get_survey_ai_summary(text, uuid) from public;

create or replace function smartgov.set_survey_ai_summary(
  p_session_token text,
  p_survey_id uuid,
  p_summary jsonb,
  p_response_count integer,
  p_model text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_survey smartgov.surveys%rowtype;
  v_model text := btrim(coalesce(p_model, ''));
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if v_account.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;

  select * into v_survey
    from smartgov.surveys
   where id = p_survey_id
     and organization_id = v_account.organization_id;
  if v_survey.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if not (
    v_account.account_scope = 'owner'
    or v_account.id = v_survey.created_by
    or v_account.id = any(v_survey.result_viewer_ids)
  ) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if p_summary is null
     or jsonb_typeof(p_summary) <> 'object'
     or p_response_count is null
     or p_response_count < 0
     or v_model = '' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  insert into smartgov.survey_ai_summaries (
    survey_id, organization_id, summary, response_count, model, generated_by, generated_at
  )
  values (
    v_survey.id, v_account.organization_id, p_summary, p_response_count, v_model,
    v_account.id, now()
  )
  on conflict (survey_id) do update
    set organization_id = excluded.organization_id,
        summary = excluded.summary,
        response_count = excluded.response_count,
        model = excluded.model,
        generated_by = excluded.generated_by,
        generated_at = now();

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function smartgov.set_survey_ai_summary(text, uuid, jsonb, integer, text) from public;

create or replace function smartgov.survey_ai_context(
  p_session_token text,
  p_survey_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_survey smartgov.surveys%rowtype;
  v_total integer;
  v_latest timestamptz;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if v_account.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;

  select * into v_survey
    from smartgov.surveys
   where id = p_survey_id
     and organization_id = v_account.organization_id;
  if v_survey.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if not (
    v_account.account_scope = 'owner'
    or v_account.id = v_survey.created_by
    or v_account.id = any(v_survey.result_viewer_ids)
  ) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  select count(*), max(submitted_at)
    into v_total, v_latest
    from smartgov.survey_responses
   where survey_id = v_survey.id;

  return jsonb_build_object(
    'ok', true,
    'survey', jsonb_build_object(
      'id', v_survey.id,
      'title', v_survey.title,
      'description', v_survey.description
    ),
    'questions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', q.id,
        'title', q.title,
        'type', q.qtype,
        'options', q.options,
        'scaleMin', q.scale_min,
        'scaleMax', q.scale_max
      ) order by q.order_index, q.id)
      from smartgov.survey_questions q
      where q.survey_id = v_survey.id
    ), '[]'::jsonb),
    'responses', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'submittedAt', r.submitted_at,
        'answers', r.answers
      ) order by r.submitted_at desc, r.id desc)
      from (
        select id, submitted_at, answers
          from smartgov.survey_responses
         where survey_id = v_survey.id
         order by submitted_at desc, id desc
         limit 300
      ) r
    ), '[]'::jsonb),
    'totalResponses', v_total,
    'latestSubmittedAt', v_latest,
    'truncated', v_total > 300
  );
end;
$$;

revoke all on function smartgov.survey_ai_context(text, uuid) from public;

create or replace function smartgov.consume_ai_quota(
  p_session_token text,
  p_kind text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_kind text := lower(btrim(coalesce(p_kind, '')));
  v_limit integer;
  v_allowed boolean;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if v_kind = 'summary' then
    v_limit := 12;
  elsif v_kind = 'draft' then
    v_limit := 30;
  elsif v_kind = 'vision' then
    v_limit := 20;
  else
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  v_allowed := smartgov.consume_rate_limit(
    'ai:' || v_kind || ':' || v_account.id::text,
    v_limit,
    interval '1 day'
  );

  if not v_allowed then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function smartgov.consume_ai_quota(text, text) from public;

-- PostgREST forwarders. Session-token wrappers are reachable by the browser
-- role, but still authenticate and authorize inside the database.
create or replace function public.get_survey_ai_summary(
  p_session_token text,
  p_survey_id uuid
)
returns jsonb
language sql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.get_survey_ai_summary(p_session_token, p_survey_id); $$;

revoke all on function public.get_survey_ai_summary(text, uuid) from public;
grant execute on function public.get_survey_ai_summary(text, uuid) to anon, authenticated;

create or replace function public.set_survey_ai_summary(
  p_session_token text,
  p_survey_id uuid,
  p_summary jsonb,
  p_response_count integer,
  p_model text
)
returns jsonb
language sql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.set_survey_ai_summary(p_session_token, p_survey_id, p_summary, p_response_count, p_model); $$;

revoke all on function public.set_survey_ai_summary(text, uuid, jsonb, integer, text) from public;
grant execute on function public.set_survey_ai_summary(text, uuid, jsonb, integer, text) to anon, authenticated;

create or replace function public.survey_ai_context(
  p_session_token text,
  p_survey_id uuid
)
returns jsonb
language sql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.survey_ai_context(p_session_token, p_survey_id); $$;

revoke all on function public.survey_ai_context(text, uuid) from public;
grant execute on function public.survey_ai_context(text, uuid) to anon, authenticated;

create or replace function public.consume_ai_quota(
  p_session_token text,
  p_kind text
)
returns jsonb
language sql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.consume_ai_quota(p_session_token, p_kind); $$;

revoke all on function public.consume_ai_quota(text, text) from public;
grant execute on function public.consume_ai_quota(text, text) to anon, authenticated;
