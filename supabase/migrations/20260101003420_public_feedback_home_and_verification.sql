-- 03420 -- Public feedback directory and student verification.
--
-- Public forms already had a link-only route. This adds a directory of open
-- public forms on the landing page, and asks identified respondents for the
-- minimum student context an organizer needs to read the answer honestly.
-- Anonymous forms still record none of it.

alter table smartgov.feedback_responses
  add column if not exists respondent_year                    text,
  add column if not exists respondent_section                 text,
  add column if not exists respondent_course                  text,
  add column if not exists respondent_department_or_campus    text;

-- ---------------------------------------------------------------------------
-- Public directory.
-- ---------------------------------------------------------------------------
create or replace function smartgov.list_public_feedback_forms()
returns jsonb
language sql
stable
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
  select jsonb_build_object(
    'ok', true,
    'forms', coalesce(jsonb_agg(jsonb_build_object(
      'title', f.title,
      'description', f.description,
      'identityMode', f.identity_mode,
      'publicPath', '/feedback/f/' || f.public_slug,
      'questionCount', (
        select count(*) from smartgov.feedback_questions q where q.form_id = f.id
      ),
      'openedAt', f.opened_at
    ) order by f.opened_at desc nulls last, f.title), '[]'::jsonb)
  )
    from smartgov.feedback_forms f
   where f.status = 'open'
     and f.access_mode = 'public_link';
$$;

revoke all on function smartgov.list_public_feedback_forms() from public;

create or replace function public.list_public_feedback_forms()
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.list_public_feedback_forms(); $$;

revoke all on function public.list_public_feedback_forms() from public;
grant execute on function public.list_public_feedback_forms() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Verified public submission.
-- ---------------------------------------------------------------------------
create or replace function smartgov.submit_public_feedback_response(
  p_slug                            text,
  p_answers                         jsonb,
  p_respondent_name                 text,
  p_respondent_email                text,
  p_respondent_year                 text,
  p_respondent_section              text,
  p_respondent_course               text,
  p_respondent_department_or_campus text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_slug             text := btrim(coalesce(p_slug, ''));
  v_form             smartgov.feedback_forms%rowtype;
  v_valid            jsonb;
  v_answers          jsonb;
  v_response_id      uuid;
  v_name             text;
  v_email            text;
  v_year             text;
  v_section          text;
  v_course           text;
  v_department       text;
begin
  if v_slug !~ '^[A-Za-z0-9_-]{32}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_slug');
  end if;

  select f.* into v_form
    from smartgov.feedback_forms f
   where f.public_slug = v_slug
     and f.status = 'open'
     and f.access_mode = 'public_link';

  if v_form.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if not smartgov.consume_rate_limit(
       'feedback:public:' || v_slug, 120, interval '10 minutes') then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  v_valid := smartgov.validate_feedback_answers(v_form.id, p_answers);
  if not (v_valid->>'ok')::boolean then
    return v_valid;
  end if;
  v_answers := v_valid->'answers';

  if v_form.identity_mode = 'identified' then
    v_name       := nullif(btrim(coalesce(p_respondent_name, '')), '');
    v_email      := nullif(lower(btrim(coalesce(p_respondent_email, ''))), '');
    v_year       := nullif(btrim(coalesce(p_respondent_year, '')), '');
    v_section    := nullif(btrim(coalesce(p_respondent_section, '')), '');
    v_course     := nullif(btrim(coalesce(p_respondent_course, '')), '');
    v_department := nullif(btrim(coalesce(p_respondent_department_or_campus, '')), '');

    if v_name is null
       or length(v_name) not between 2 and 120
       or v_email is null
       or length(v_email) > 200
       or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
       or v_year is null or length(v_year) > 40
       or v_section is null or length(v_section) > 40
       or v_course is null or length(v_course) > 120
       or v_department is null or length(v_department) > 120 then
      return jsonb_build_object('ok', false, 'reason', 'invalid_respondent');
    end if;
  else
    v_name := null;
    v_email := null;
    v_year := null;
    v_section := null;
    v_course := null;
    v_department := null;
  end if;

  insert into smartgov.feedback_responses (
    form_id, submitted_by, respondent_name, respondent_email,
    respondent_year, respondent_section, respondent_course,
    respondent_department_or_campus, answers
  )
  values (
    v_form.id, null, v_name, v_email,
    v_year, v_section, v_course, v_department, v_answers
  )
  returning id into v_response_id;

  insert into smartgov.audit_log (
    organization_id, actor_id, action, target_type, target_id, detail
  )
  values (
    v_form.organization_id, null, 'feedback_response_submit',
    'feedback_form', v_form.id, jsonb_build_object('formId', v_form.id)
  );

  return jsonb_build_object('ok', true, 'responseId', v_response_id);
end;
$$;

revoke all on function smartgov.submit_public_feedback_response(text, jsonb, text, text, text, text, text, text) from public;

-- The old four-argument path stays available for callers that have not moved
-- yet; it simply leaves the verification fields empty.
create or replace function smartgov.submit_public_feedback_response(
  p_slug             text,
  p_answers          jsonb,
  p_respondent_name  text,
  p_respondent_email text
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
  select smartgov.submit_public_feedback_response(
    p_slug, p_answers, p_respondent_name, p_respondent_email,
    null, null, null, null
  );
$$;

create or replace function public.submit_public_feedback_response(
  p_slug                            text,
  p_answers                         jsonb,
  p_respondent_name                 text,
  p_respondent_email                text,
  p_respondent_year                 text,
  p_respondent_section              text,
  p_respondent_course               text,
  p_respondent_department_or_campus text
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
  select smartgov.submit_public_feedback_response(
    p_slug, p_answers, p_respondent_name, p_respondent_email,
    p_respondent_year, p_respondent_section, p_respondent_course,
    p_respondent_department_or_campus
  );
$$;

revoke all on function public.submit_public_feedback_response(text, jsonb, text, text, text, text, text, text) from public;
grant execute on function public.submit_public_feedback_response(text, jsonb, text, text, text, text, text, text) to anon, authenticated;

-- Organizers see the verification fields alongside the response. Anonymous
-- forms still return nulls for every one of them.
create or replace function smartgov.list_feedback_responses(
  p_session_token text,
  p_form_id       uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account   smartgov.accounts%rowtype;
  v_form      smartgov.feedback_forms%rowtype;
  v_responses jsonb;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if v_account.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;

  select f.* into v_form
    from smartgov.feedback_forms f
   where f.id = p_form_id;

  if v_form.id is null or v_form.organization_id <> v_account.organization_id then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if not smartgov.feedback_form_can_review(v_account, v_form) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id,
           'status', r.status,
           'submittedAt', r.submitted_at,
           'acknowledgedAt', r.acknowledged_at,
           'answers', r.answers,
           'submittedBy', case when v_form.identity_mode = 'anonymous' then null else r.submitted_by end,
           'respondentName', case when v_form.identity_mode = 'anonymous' then null else r.respondent_name end,
           'respondentEmail', case when v_form.identity_mode = 'anonymous' then null else r.respondent_email end,
           'respondentYear', case when v_form.identity_mode = 'anonymous' then null else r.respondent_year end,
           'respondentSection', case when v_form.identity_mode = 'anonymous' then null else r.respondent_section end,
           'respondentCourse', case when v_form.identity_mode = 'anonymous' then null else r.respondent_course end,
           'respondentDepartmentOrCampus', case when v_form.identity_mode = 'anonymous' then null else r.respondent_department_or_campus end
         ) order by r.submitted_at desc, r.id), '[]'::jsonb)
    into v_responses
    from smartgov.feedback_responses r
   where r.form_id = v_form.id;

  return jsonb_build_object(
    'ok', true,
    'form', jsonb_build_object(
      'id', v_form.id,
      'title', v_form.title,
      'status', v_form.status,
      'identityMode', v_form.identity_mode,
      'responseCount', (
        select count(*) from smartgov.feedback_responses r where r.form_id = v_form.id
      )
    ),
    'questions', smartgov.feedback_questions_json(v_form.id),
    'responses', v_responses
  );
end;
$$;

revoke all on function smartgov.list_feedback_responses(text, uuid) from public;
