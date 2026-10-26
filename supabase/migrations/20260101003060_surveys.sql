-- 03060 -- Surveys.
--
-- A Google-Forms-style survey tool shared by USG and LSG officers. An officer
-- creates a survey, adds questions, chooses who may answer (public link, a
-- named list of emails, or signed-in members of the organization) and an
-- optional response cap / deadline, then publishes it. Respondents fill in the
-- public form; the creator (and anyone they name) reads the responses and the
-- aggregated results.
--
-- Access to the tables is policy-free, like everything else in this schema:
-- every read and write goes through a SECURITY DEFINER function that proves the
-- caller with smartgov.authenticate(p_session_token). Public (anonymous)
-- submission is the one exception and goes through a token-less function that
-- only ever reads/writes the survey it was given.
--
-- Everything is `create table if not exists` / `create or replace`, so the
-- file may be re-applied without disturbing an existing database.

-- ---------------------------------------------------------------------------
-- 1. Tables.
-- ---------------------------------------------------------------------------
create table if not exists smartgov.surveys (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  created_by uuid not null references smartgov.accounts (id) on delete cascade,
  title text not null,
  description text,
  access_mode text not null default 'public'
    check (access_mode in ('public', 'email_list', 'authenticated')),
  allowed_emails text[] not null default '{}',
  response_limit integer,
  deadline timestamptz,
  status text not null default 'draft'
    check (status in ('draft', 'open', 'closed')),
  result_viewer_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists smartgov.survey_questions (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references smartgov.surveys (id) on delete cascade,
  order_index integer not null default 0,
  qtype text not null
    check (qtype in ('short_text', 'long_text', 'multiple_choice', 'checkbox', 'dropdown', 'linear_scale', 'date', 'time')),
  title text not null,
  description text,
  required boolean not null default false,
  options jsonb not null default '[]'::jsonb,
  scale_min integer,
  scale_max integer,
  scale_label_low text,
  scale_label_high text
);

create table if not exists smartgov.survey_responses (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references smartgov.surveys (id) on delete cascade,
  respondent_email text,
  respondent_account_id uuid references smartgov.accounts (id) on delete set null,
  answers jsonb not null default '{}'::jsonb,
  submitted_at timestamptz not null default now()
);

create index if not exists survey_questions_survey_idx on smartgov.survey_questions (survey_id, order_index);
create index if not exists survey_responses_survey_idx on smartgov.survey_responses (survey_id, submitted_at);


-- ---------------------------------------------------------------------------
-- 2. RPC: create_survey
-- ---------------------------------------------------------------------------
create or replace function smartgov.create_survey(
  p_session_token text,
  p_title text,
  p_description text,
  p_access_mode text,
  p_allowed_emails text[],
  p_response_limit integer,
  p_deadline timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_id uuid;
  v_mode text := coalesce(nullif(trim(p_access_mode), ''), 'public');
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if v_account.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;
  if v_mode not in ('public', 'email_list', 'authenticated') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;
  if p_title is null or length(trim(p_title)) < 1 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_title');
  end if;

  insert into smartgov.surveys (
    organization_id, created_by, title, description, access_mode,
    allowed_emails, response_limit, deadline, result_viewer_ids
  )
  values (
    v_account.organization_id, v_account.id, trim(p_title), nullif(trim(coalesce(p_description, '')), ''),
    v_mode, coalesce(p_allowed_emails, '{}'), p_response_limit, p_deadline,
    array[v_account.id]
  )
  returning id into v_id;

  return jsonb_build_object('ok', true, 'surveyId', v_id);
end;
$$;

revoke all on function smartgov.create_survey(text, text, text, text, text[], integer, timestamptz) from public;


-- ---------------------------------------------------------------------------
-- 3. RPC: update_survey (metadata only; status managed separately)
-- ---------------------------------------------------------------------------
create or replace function smartgov.update_survey(
  p_session_token text,
  p_survey_id uuid,
  p_title text,
  p_description text,
  p_access_mode text,
  p_allowed_emails text[],
  p_response_limit integer,
  p_deadline timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_survey smartgov.surveys%rowtype;
  v_mode text;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  select * into v_survey from smartgov.surveys where id = p_survey_id and organization_id = v_account.organization_id;
  if v_survey.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_survey.created_by <> v_account.id and v_account.account_scope <> 'owner' then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if v_survey.status <> 'draft' then
    return jsonb_build_object('ok', false, 'reason', 'already_reviewed');
  end if;

  v_mode := coalesce(nullif(trim(p_access_mode), ''), v_survey.access_mode);
  if v_mode not in ('public', 'email_list', 'authenticated') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;
  if p_title is null or length(trim(p_title)) < 1 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_title');
  end if;

  update smartgov.surveys
     set title = trim(p_title),
         description = nullif(trim(coalesce(p_description, '')), ''),
         access_mode = v_mode,
         allowed_emails = coalesce(p_allowed_emails, allowed_emails),
         response_limit = p_response_limit,
         deadline = p_deadline,
         updated_at = now()
   where id = v_survey.id;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function smartgov.update_survey(text, uuid, text, text, text, text[], integer, timestamptz) from public;


-- ---------------------------------------------------------------------------
-- 4. RPC: add_survey_question
-- ---------------------------------------------------------------------------
create or replace function smartgov.add_survey_question(
  p_session_token text,
  p_survey_id uuid,
  p_qtype text,
  p_title text,
  p_description text,
  p_required boolean,
  p_options jsonb,
  p_scale_min integer,
  p_scale_max integer,
  p_scale_label_low text,
  p_scale_label_high text,
  p_order_index integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_survey smartgov.surveys%rowtype;
  v_id uuid;
  v_type text := coalesce(nullif(trim(p_qtype), ''), 'short_text');
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  select * into v_survey from smartgov.surveys where id = p_survey_id and organization_id = v_account.organization_id;
  if v_survey.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_survey.created_by <> v_account.id and v_account.account_scope <> 'owner' then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if v_survey.status <> 'draft' then
    return jsonb_build_object('ok', false, 'reason', 'already_reviewed');
  end if;
  if v_type not in ('short_text', 'long_text', 'multiple_choice', 'checkbox', 'dropdown', 'linear_scale', 'date', 'time') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_type');
  end if;
  if p_title is null or length(trim(p_title)) < 1 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_title');
  end if;

  insert into smartgov.survey_questions (
    survey_id, order_index, qtype, title, description, required,
    options, scale_min, scale_max, scale_label_low, scale_label_high
  )
  values (
    v_survey.id, coalesce(p_order_index, 0), v_type, trim(p_title),
    nullif(trim(coalesce(p_description, '')), ''), coalesce(p_required, false),
    coalesce(p_options, '[]'::jsonb), p_scale_min, p_scale_max,
    nullif(trim(coalesce(p_scale_label_low, '')), ''),
    nullif(trim(coalesce(p_scale_label_high, '')), '')
  )
  returning id into v_id;

  return jsonb_build_object('ok', true, 'questionId', v_id);
end;
$$;

revoke all on function smartgov.add_survey_question(text, uuid, text, text, text, boolean, jsonb, integer, integer, text, text, integer) from public;


-- ---------------------------------------------------------------------------
-- 5. RPC: update_survey_question
-- ---------------------------------------------------------------------------
create or replace function smartgov.update_survey_question(
  p_session_token text,
  p_question_id uuid,
  p_qtype text,
  p_title text,
  p_description text,
  p_required boolean,
  p_options jsonb,
  p_scale_min integer,
  p_scale_max integer,
  p_scale_label_low text,
  p_scale_label_high text,
  p_order_index integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_q smartgov.survey_questions%rowtype;
  v_survey smartgov.surveys%rowtype;
  v_type text;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  select * into v_q from smartgov.survey_questions where id = p_question_id;
  if v_q.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  select * into v_survey from smartgov.surveys where id = v_q.survey_id and organization_id = v_account.organization_id;
  if v_survey.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_survey.created_by <> v_account.id and v_account.account_scope <> 'owner' then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if v_survey.status <> 'draft' then
    return jsonb_build_object('ok', false, 'reason', 'already_reviewed');
  end if;

  v_type := coalesce(nullif(trim(p_qtype), ''), v_q.qtype);
  if v_type not in ('short_text', 'long_text', 'multiple_choice', 'checkbox', 'dropdown', 'linear_scale', 'date', 'time') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_type');
  end if;
  if p_title is null or length(trim(p_title)) < 1 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_title');
  end if;

  update smartgov.survey_questions
     set qtype = v_type,
         title = trim(p_title),
         description = nullif(trim(coalesce(p_description, '')), ''),
         required = coalesce(p_required, required),
         options = coalesce(p_options, options),
         scale_min = p_scale_min,
         scale_max = p_scale_max,
         scale_label_low = nullif(trim(coalesce(p_scale_label_low, '')), ''),
         scale_label_high = nullif(trim(coalesce(p_scale_label_high, '')), ''),
         order_index = coalesce(p_order_index, order_index)
   where id = v_q.id;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function smartgov.update_survey_question(text, uuid, text, text, text, boolean, jsonb, integer, integer, text, text, integer) from public;


-- ---------------------------------------------------------------------------
-- 6. RPC: delete_survey_question
-- ---------------------------------------------------------------------------
create or replace function smartgov.delete_survey_question(p_session_token text, p_question_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_q smartgov.survey_questions%rowtype;
  v_survey smartgov.surveys%rowtype;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  select * into v_q from smartgov.survey_questions where id = p_question_id;
  if v_q.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  select * into v_survey from smartgov.surveys where id = v_q.survey_id and organization_id = v_account.organization_id;
  if v_survey.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_survey.created_by <> v_account.id and v_account.account_scope <> 'owner' then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if v_survey.status <> 'draft' then
    return jsonb_build_object('ok', false, 'reason', 'already_reviewed');
  end if;

  delete from smartgov.survey_questions where id = v_q.id;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function smartgov.delete_survey_question(text, uuid) from public;


-- ---------------------------------------------------------------------------
-- 7. RPC: publish_survey / close_survey / delete_survey
-- ---------------------------------------------------------------------------
create or replace function smartgov.publish_survey(p_session_token text, p_survey_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_survey smartgov.surveys%rowtype;
  v_qcount integer;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  select * into v_survey from smartgov.surveys where id = p_survey_id and organization_id = v_account.organization_id;
  if v_survey.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_survey.created_by <> v_account.id and v_account.account_scope <> 'owner' then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if v_survey.status <> 'draft' then
    return jsonb_build_object('ok', false, 'reason', 'already_reviewed');
  end if;

  select count(*) into v_qcount from smartgov.survey_questions where survey_id = v_survey.id;
  if v_qcount = 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  update smartgov.surveys set status = 'open', updated_at = now() where id = v_survey.id;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function smartgov.publish_survey(text, uuid) from public;

create or replace function smartgov.close_survey(p_session_token text, p_survey_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_survey smartgov.surveys%rowtype;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  select * into v_survey from smartgov.surveys where id = p_survey_id and organization_id = v_account.organization_id;
  if v_survey.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_survey.created_by <> v_account.id and v_account.account_scope <> 'owner' then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  update smartgov.surveys set status = 'closed', updated_at = now() where id = v_survey.id;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function smartgov.close_survey(text, uuid) from public;

create or replace function smartgov.delete_survey(p_session_token text, p_survey_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_survey smartgov.surveys%rowtype;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  select * into v_survey from smartgov.surveys where id = p_survey_id and organization_id = v_account.organization_id;
  if v_survey.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_survey.created_by <> v_account.id and v_account.account_scope <> 'owner' then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  delete from smartgov.surveys where id = v_survey.id;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function smartgov.delete_survey(text, uuid) from public;


-- ---------------------------------------------------------------------------
-- 8. RPC: update_survey_viewers
-- ---------------------------------------------------------------------------
create or replace function smartgov.update_survey_viewers(
  p_session_token text,
  p_survey_id uuid,
  p_viewer_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_survey smartgov.surveys%rowtype;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  select * into v_survey from smartgov.surveys where id = p_survey_id and organization_id = v_account.organization_id;
  if v_survey.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_survey.created_by <> v_account.id and v_account.account_scope <> 'owner' then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  update smartgov.surveys
     set result_viewer_ids = coalesce(p_viewer_ids, '{}') || array[v_survey.created_by],
         updated_at = now()
   where id = v_survey.id;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function smartgov.update_survey_viewers(text, uuid, uuid[]) from public;


-- ---------------------------------------------------------------------------
-- 9. RPC: list_surveys
-- ---------------------------------------------------------------------------
create or replace function smartgov.list_surveys(p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if v_account.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;

  return jsonb_build_object(
    'ok', true,
    'surveys', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', s.id,
          'title', s.title,
          'description', s.description,
          'accessMode', s.access_mode,
          'status', s.status,
          'responseLimit', s.response_limit,
          'deadline', s.deadline,
          'createdAt', s.created_at,
          'createdBy', s.created_by,
          'responseCount', (select count(*) from smartgov.survey_responses r where r.survey_id = s.id),
          'canViewResults', (v_account.account_scope = 'owner' or v_account.id = s.created_by or v_account.id = any(s.result_viewer_ids))
        )
        order by s.created_at desc
      )
      from smartgov.surveys s
      where s.organization_id = v_account.organization_id
        and (v_account.account_scope = 'owner' or s.created_by = v_account.id or v_account.id = any(s.result_viewer_ids))
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function smartgov.list_surveys(text) from public;


-- ---------------------------------------------------------------------------
-- 10. RPC: get_survey (rendering the form; supports anonymous access)
--     p_session_token may be null for public surveys.
--     p_access_email is used for email_list access.
-- ---------------------------------------------------------------------------
create or replace function smartgov.get_survey(
  p_session_token text,
  p_survey_id uuid,
  p_access_email text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_survey smartgov.surveys%rowtype;
  v_email text := lower(trim(coalesce(p_access_email, '')));
  v_count integer;
begin
  if p_session_token is not null and p_session_token <> '' then
    v_account := smartgov.authenticate(p_session_token);
  end if;

  select * into v_survey from smartgov.surveys where id = p_survey_id;
  if v_survey.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  -- access check
  if v_survey.access_mode = 'authenticated' then
    if v_account.id is null or v_account.organization_id <> v_survey.organization_id then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
  elsif v_survey.access_mode = 'email_list' then
    if v_email = '' then
      return jsonb_build_object('ok', false, 'reason', 'invalid_email');
    end if;
    if not (v_email = any(v_survey.allowed_emails)) then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
  end if;

  -- closed / deadline
  if v_survey.status <> 'open' then
    return jsonb_build_object('ok', false, 'reason', 'proposal_not_open');
  end if;
  if v_survey.deadline is not null and v_survey.deadline < now() then
    return jsonb_build_object('ok', false, 'reason', 'past_deadline');
  end if;

  -- response cap
  if v_survey.response_limit is not null then
    select count(*) into v_count from smartgov.survey_responses where survey_id = v_survey.id;
    if v_count >= v_survey.response_limit then
      return jsonb_build_object('ok', false, 'reason', 'already_reviewed');
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'survey', jsonb_build_object(
      'id', v_survey.id,
      'title', v_survey.title,
      'description', v_survey.description,
      'accessMode', v_survey.access_mode,
      'deadline', v_survey.deadline,
      'responseLimit', v_survey.response_limit
    ),
    'questions', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', q.id,
          'orderIndex', q.order_index,
          'type', q.qtype,
          'title', q.title,
          'description', q.description,
          'required', q.required,
          'options', q.options,
          'scaleMin', q.scale_min,
          'scaleMax', q.scale_max,
          'scaleLabelLow', q.scale_label_low,
          'scaleLabelHigh', q.scale_label_high
        ) order by q.order_index, q.id
      )
      from smartgov.survey_questions q
      where q.survey_id = v_survey.id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function smartgov.get_survey(text, uuid, text) from public;
grant execute on function smartgov.get_survey(text, uuid, text) to anon, authenticated;


-- ---------------------------------------------------------------------------
-- 11. RPC: submit_survey_response (supports anonymous)
-- ---------------------------------------------------------------------------
create or replace function smartgov.submit_survey_response(
  p_session_token text,
  p_survey_id uuid,
  p_access_email text,
  p_answers jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_survey smartgov.surveys%rowtype;
  v_email text := lower(trim(coalesce(p_access_email, '')));
  v_count integer;
begin
  if p_session_token is not null and p_session_token <> '' then
    v_account := smartgov.authenticate(p_session_token);
  end if;

  select * into v_survey from smartgov.surveys where id = p_survey_id;
  if v_survey.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  -- access
  if v_survey.access_mode = 'authenticated' then
    if v_account.id is null or v_account.organization_id <> v_survey.organization_id then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
  elsif v_survey.access_mode = 'email_list' then
    if v_email = '' or not (v_email = any(v_survey.allowed_emails)) then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
  end if;

  if v_survey.status <> 'open' then
    return jsonb_build_object('ok', false, 'reason', 'proposal_not_open');
  end if;
  if v_survey.deadline is not null and v_survey.deadline < now() then
    return jsonb_build_object('ok', false, 'reason', 'past_deadline');
  end if;
  if v_survey.response_limit is not null then
    select count(*) into v_count from smartgov.survey_responses where survey_id = v_survey.id;
    if v_count >= v_survey.response_limit then
      return jsonb_build_object('ok', false, 'reason', 'already_reviewed');
    end if;
  end if;

  insert into smartgov.survey_responses (survey_id, respondent_email, respondent_account_id, answers)
  values (
    v_survey.id,
    case when v_email <> '' then v_email else null end,
    v_account.id,
    coalesce(p_answers, '{}'::jsonb)
  );

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function smartgov.submit_survey_response(text, uuid, text, jsonb) from public;
grant execute on function smartgov.submit_survey_response(text, uuid, text, jsonb) to anon, authenticated;


-- ---------------------------------------------------------------------------
-- 12. RPC: list_survey_responses
-- ---------------------------------------------------------------------------
create or replace function smartgov.list_survey_responses(p_session_token text, p_survey_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_survey smartgov.surveys%rowtype;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  select * into v_survey from smartgov.surveys where id = p_survey_id and organization_id = v_account.organization_id;
  if v_survey.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if not (v_account.account_scope = 'owner' or v_account.id = v_survey.created_by or v_account.id = any(v_survey.result_viewer_ids)) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  return jsonb_build_object(
    'ok', true,
    'responses', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', r.id,
          'respondentEmail', r.respondent_email,
          'submittedAt', r.submitted_at,
          'answers', r.answers
        ) order by r.submitted_at desc
      )
      from smartgov.survey_responses r
      where r.survey_id = v_survey.id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function smartgov.list_survey_responses(text, uuid) from public;


-- ---------------------------------------------------------------------------
-- 13. RPC: survey_results (aggregates per question)
-- ---------------------------------------------------------------------------
create or replace function smartgov.survey_results(p_session_token text, p_survey_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_survey smartgov.surveys%rowtype;
  v_total integer;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  select * into v_survey from smartgov.surveys where id = p_survey_id and organization_id = v_account.organization_id;
  if v_survey.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if not (v_account.account_scope = 'owner' or v_account.id = v_survey.created_by or v_account.id = any(v_survey.result_viewer_ids)) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  select count(*) into v_total from smartgov.survey_responses where survey_id = v_survey.id;

  return jsonb_build_object(
    'ok', true,
    'totalResponses', v_total,
    'questions', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', q.id,
          'title', q.title,
          'type', q.qtype,
          'options', q.options,
          'scaleMin', q.scale_min,
          'scaleMax', q.scale_max,
          'scaleLabelLow', q.scale_label_low,
          'scaleLabelHigh', q.scale_label_high,
          'counts', (
            select jsonb_object_agg(key, cnt)
            from (
              select coalesce(r.answers ->> q.id::text, '(no answer)') as key, count(*) as cnt
              from smartgov.survey_responses r
              where r.survey_id = v_survey.id
              group by 1
            ) t
          )
        ) order by q.order_index, q.id
      )
      from smartgov.survey_questions q
      where q.survey_id = v_survey.id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function smartgov.survey_results(text, uuid) from public;


-- ---------------------------------------------------------------------------
-- 14. PostgREST forwarders.
-- ---------------------------------------------------------------------------
create or replace function public.create_survey(p_session_token text, p_title text, p_description text, p_access_mode text, p_allowed_emails text[], p_response_limit integer, p_deadline timestamptz)
returns jsonb language sql security definer set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.create_survey(p_session_token, p_title, p_description, p_access_mode, p_allowed_emails, p_response_limit, p_deadline); $$;
revoke all on function public.create_survey(text, text, text, text, text[], integer, timestamptz) from public;
grant execute on function public.create_survey(text, text, text, text, text[], integer, timestamptz) to anon, authenticated;

create or replace function public.update_survey(p_session_token text, p_survey_id uuid, p_title text, p_description text, p_access_mode text, p_allowed_emails text[], p_response_limit integer, p_deadline timestamptz)
returns jsonb language sql security definer set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.update_survey(p_session_token, p_survey_id, p_title, p_description, p_access_mode, p_allowed_emails, p_response_limit, p_deadline); $$;
revoke all on function public.update_survey(text, uuid, text, text, text, text[], integer, timestamptz) from public;
grant execute on function public.update_survey(text, uuid, text, text, text, text[], integer, timestamptz) to anon, authenticated;

create or replace function public.add_survey_question(p_session_token text, p_survey_id uuid, p_qtype text, p_title text, p_description text, p_required boolean, p_options jsonb, p_scale_min integer, p_scale_max integer, p_scale_label_low text, p_scale_label_high text, p_order_index integer)
returns jsonb language sql security definer set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.add_survey_question(p_session_token, p_survey_id, p_qtype, p_title, p_description, p_required, p_options, p_scale_min, p_scale_max, p_scale_label_low, p_scale_label_high, p_order_index); $$;
revoke all on function public.add_survey_question(text, uuid, text, text, text, boolean, jsonb, integer, integer, text, text, integer) from public;
grant execute on function public.add_survey_question(text, uuid, text, text, text, boolean, jsonb, integer, integer, text, text, integer) to anon, authenticated;

create or replace function public.update_survey_question(p_session_token text, p_question_id uuid, p_qtype text, p_title text, p_description text, p_required boolean, p_options jsonb, p_scale_min integer, p_scale_max integer, p_scale_label_low text, p_scale_label_high text, p_order_index integer)
returns jsonb language sql security definer set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.update_survey_question(p_session_token, p_question_id, p_qtype, p_title, p_description, p_required, p_options, p_scale_min, p_scale_max, p_scale_label_low, p_scale_label_high, p_order_index); $$;
revoke all on function public.update_survey_question(text, uuid, text, text, text, boolean, jsonb, integer, integer, text, text, integer) from public;
grant execute on function public.update_survey_question(text, uuid, text, text, text, boolean, jsonb, integer, integer, text, text, integer) to anon, authenticated;

create or replace function public.delete_survey_question(p_session_token text, p_question_id uuid)
returns jsonb language sql security definer set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.delete_survey_question(p_session_token, p_question_id); $$;
revoke all on function public.delete_survey_question(text, uuid) from public;
grant execute on function public.delete_survey_question(text, uuid) to anon, authenticated;

create or replace function public.publish_survey(p_session_token text, p_survey_id uuid)
returns jsonb language sql security definer set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.publish_survey(p_session_token, p_survey_id); $$;
revoke all on function public.publish_survey(text, uuid) from public;
grant execute on function public.publish_survey(text, uuid) to anon, authenticated;

create or replace function public.close_survey(p_session_token text, p_survey_id uuid)
returns jsonb language sql security definer set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.close_survey(p_session_token, p_survey_id); $$;
revoke all on function public.close_survey(text, uuid) from public;
grant execute on function public.close_survey(text, uuid) to anon, authenticated;

create or replace function public.delete_survey(p_session_token text, p_survey_id uuid)
returns jsonb language sql security definer set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.delete_survey(p_session_token, p_survey_id); $$;
revoke all on function public.delete_survey(text, uuid) from public;
grant execute on function public.delete_survey(text, uuid) to anon, authenticated;

create or replace function public.update_survey_viewers(p_session_token text, p_survey_id uuid, p_viewer_ids uuid[])
returns jsonb language sql security definer set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.update_survey_viewers(p_session_token, p_survey_id, p_viewer_ids); $$;
revoke all on function public.update_survey_viewers(text, uuid, uuid[]) from public;
grant execute on function public.update_survey_viewers(text, uuid, uuid[]) to anon, authenticated;

create or replace function public.list_surveys(p_session_token text)
returns jsonb language sql security definer set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.list_surveys(p_session_token); $$;
revoke all on function public.list_surveys(text) from public;
grant execute on function public.list_surveys(text) to anon, authenticated;

create or replace function public.get_survey(p_session_token text, p_survey_id uuid, p_access_email text)
returns jsonb language sql security definer set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.get_survey(p_session_token, p_survey_id, p_access_email); $$;
revoke all on function public.get_survey(text, uuid, text) from public;
grant execute on function public.get_survey(text, uuid, text) to anon, authenticated;

create or replace function public.submit_survey_response(p_session_token text, p_survey_id uuid, p_access_email text, p_answers jsonb)
returns jsonb language sql security definer set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.submit_survey_response(p_session_token, p_survey_id, p_access_email, p_answers); $$;
revoke all on function public.submit_survey_response(text, uuid, text, jsonb) from public;
grant execute on function public.submit_survey_response(text, uuid, text, jsonb) to anon, authenticated;

create or replace function public.list_survey_responses(p_session_token text, p_survey_id uuid)
returns jsonb language sql security definer set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.list_survey_responses(p_session_token, p_survey_id); $$;
revoke all on function public.list_survey_responses(text, uuid) from public;
grant execute on function public.list_survey_responses(text, uuid) to anon, authenticated;

create or replace function public.survey_results(p_session_token text, p_survey_id uuid)
returns jsonb language sql security definer set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.survey_results(p_session_token, p_survey_id); $$;
revoke all on function public.survey_results(text, uuid) from public;
grant execute on function public.survey_results(text, uuid) to anon, authenticated;