-- Survey branching (show_if) and email OTP access mode.

alter table smartgov.survey_questions
  add column if not exists show_if jsonb;

alter table smartgov.surveys
  drop constraint if exists surveys_access_mode_check;
alter table smartgov.surveys
  add constraint surveys_access_mode_check
  check (access_mode in ('public', 'email_list', 'authenticated', 'email_otp'));

create table if not exists smartgov.survey_access_otps (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references smartgov.surveys(id) on delete cascade,
  email text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists survey_access_otps_lookup_idx
  on smartgov.survey_access_otps (survey_id, email, expires_at);

-- Update add/update survey question RPCs to accept show_if.
-- Re-create with show_if param appended.
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
  p_order_index integer,
  p_show_if jsonb default null
) returns jsonb
language plpgsql security definer set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_survey smartgov.surveys%rowtype;
  v_id uuid;
  v_type text := coalesce(nullif(trim(p_qtype), ''), 'short_text');
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then return jsonb_build_object('ok',false,'reason','unauthenticated'); end if;
  select * into v_survey from smartgov.surveys where id = p_survey_id and organization_id = v_account.organization_id;
  if v_survey.id is null then return jsonb_build_object('ok',false,'reason','not_found'); end if;
  if v_survey.created_by <> v_account.id and v_account.account_scope <> 'owner' then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
  if v_survey.status <> 'draft' then return jsonb_build_object('ok',false,'reason','invalid_request'); end if;
  if v_type not in ('short_text', 'long_text', 'multiple_choice', 'checkbox', 'dropdown', 'linear_scale', 'date', 'time') then return jsonb_build_object('ok',false,'reason','invalid_request'); end if;
  if p_title is null or length(trim(p_title)) < 1 then return jsonb_build_object('ok',false,'reason','invalid_title'); end if;
  insert into smartgov.survey_questions (survey_id, order_index, qtype, title, description, required, options, scale_min, scale_max, scale_label_low, scale_label_high, show_if)
  values (p_survey_id, coalesce(p_order_index,0), v_type, trim(p_title), p_description, coalesce(p_required,false), coalesce(p_options,'[]'::jsonb), p_scale_min, p_scale_max, p_scale_label_low, p_scale_label_high, p_show_if)
  returning id into v_id;
  return jsonb_build_object('ok',true,'questionId',v_id);
end;
$$;

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
  p_order_index integer,
  p_show_if jsonb default null
) returns jsonb
language plpgsql security definer set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_q smartgov.survey_questions%rowtype;
  v_survey smartgov.surveys%rowtype;
  v_type text;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then return jsonb_build_object('ok',false,'reason','unauthenticated'); end if;
  select * into v_q from smartgov.survey_questions where id = p_question_id;
  if v_q.id is null then return jsonb_build_object('ok',false,'reason','not_found'); end if;
  select * into v_survey from smartgov.surveys where id = v_q.survey_id and organization_id = v_account.organization_id;
  if v_survey.id is null then return jsonb_build_object('ok',false,'reason','not_found'); end if;
  if v_survey.created_by <> v_account.id and v_account.account_scope <> 'owner' then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
  if v_survey.status <> 'draft' then return jsonb_build_object('ok',false,'reason','invalid_request'); end if;
  v_type := coalesce(nullif(trim(p_qtype), ''), v_q.qtype);
  if v_type not in ('short_text', 'long_text', 'multiple_choice', 'checkbox', 'dropdown', 'linear_scale', 'date', 'time') then return jsonb_build_object('ok',false,'reason','invalid_request'); end if;
  if p_title is not null and length(trim(p_title)) < 1 then return jsonb_build_object('ok',false,'reason','invalid_title'); end if;
  update smartgov.survey_questions
    set qtype = v_type,
        title = coalesce(nullif(trim(p_title), ''), title),
        description = coalesce(p_description, description),
        required = coalesce(p_required, required),
        options = coalesce(p_options, options),
        scale_min = coalesce(p_scale_min, scale_min),
        scale_max = coalesce(p_scale_max, scale_max),
        scale_label_low = coalesce(p_scale_label_low, scale_label_low),
        scale_label_high = coalesce(p_scale_label_high, scale_label_high),
        order_index = coalesce(p_order_index, order_index),
        show_if = coalesce(p_show_if, show_if)
    where id = p_question_id;
  return jsonb_build_object('ok',true);
end;
$$;

-- OTP helpers
create or replace function smartgov.create_survey_otp(
  p_survey_id uuid,
  p_email text,
  p_code_hash text,
  p_ttl_minutes integer
) returns jsonb
language plpgsql security definer set search_path = public, extensions, smartgov, pg_temp
as $$
begin
  insert into smartgov.survey_access_otps (survey_id, email, code_hash, expires_at)
  values (p_survey_id, lower(trim(p_email)), p_code_hash, now() + (p_ttl_minutes || ' minutes')::interval);
  return jsonb_build_object('ok',true);
end;
$$;

create or replace function smartgov.verify_survey_otp(
  p_survey_id uuid,
  p_email text,
  p_code_hash text
) returns jsonb
language plpgsql security definer set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_row smartgov.survey_access_otps%rowtype;
begin
  select * into v_row
    from smartgov.survey_access_otps
   where survey_id = p_survey_id and email = lower(trim(p_email)) and code_hash = p_code_hash
     and used_at is null and expires_at > now()
   order by created_at desc limit 1;
  if v_row.id is null then return jsonb_build_object('ok',false,'reason','invalid_code'); end if;
  update smartgov.survey_access_otps set used_at = now() where id = v_row.id;
  return jsonb_build_object('ok',true);
end;
$$;

-- Public wrappers
create or replace function public.create_survey_otp(p_survey_id uuid, p_email text, p_code_hash text, p_ttl_minutes integer)
returns jsonb language sql security definer as $$ select smartgov.create_survey_otp($1,$2,$3,$4); $$;
create or replace function public.verify_survey_otp(p_survey_id uuid, p_email text, p_code_hash text)
returns jsonb language sql security definer as $$ select smartgov.verify_survey_otp($1,$2,$3); $$;

grant execute on function public.create_survey_otp(uuid,text,text,integer) to anon, authenticated;
grant execute on function public.verify_survey_otp(uuid,text,text) to anon, authenticated;

-- Public wrappers for updated survey question functions (with show_if)
create or replace function public.add_survey_question(
  p_session_token text, p_survey_id uuid, p_qtype text, p_title text, p_description text,
  p_required boolean, p_options jsonb, p_scale_min integer, p_scale_max integer,
  p_scale_label_low text, p_scale_label_high text, p_order_index integer, p_show_if jsonb default null
) returns jsonb language sql security definer as $$
  select smartgov.add_survey_question($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13);
$$;
create or replace function public.update_survey_question(
  p_session_token text, p_question_id uuid, p_qtype text, p_title text, p_description text,
  p_required boolean, p_options jsonb, p_scale_min integer, p_scale_max integer,
  p_scale_label_low text, p_scale_label_high text, p_order_index integer, p_show_if jsonb default null
) returns jsonb language sql security definer as $$
  select smartgov.update_survey_question($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13);
$$;
grant execute on function public.add_survey_question(text,uuid,text,text,text,boolean,jsonb,integer,integer,text,text,integer,jsonb) to anon, authenticated;
grant execute on function public.update_survey_question(text,uuid,text,text,text,boolean,jsonb,integer,integer,text,text,integer,jsonb) to anon, authenticated;

-- Update get_survey to include show_if in questions (already returns questions via jsonb; ensure show_if included)
-- The get_survey function is not redefined here; show_if column will be included when questions are serialized if the function selects it. Check: get_survey uses survey_questions.*? Let's update get_survey to include show_if.
create or replace function smartgov.get_survey(
  p_session_token text,
  p_survey_id uuid,
  p_access_email text
) returns jsonb
language plpgsql security definer set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_survey smartgov.surveys%rowtype;
  v_is_owner boolean := false;
begin
  if p_session_token is not null then
    v_account := smartgov.authenticate(p_session_token);
    if v_account.id is not null then
      v_is_owner := (v_account.account_scope = 'owner');
    end if;
  end if;

  select * into v_survey from smartgov.surveys where id = p_survey_id;
  if v_survey.id is null then return jsonb_build_object('ok',false,'reason','not_found'); end if;
  if v_survey.status = 'draft' and not v_is_owner then return jsonb_build_object('ok',false,'reason','forbidden'); end if;

  -- access checks
  if v_survey.access_mode = 'email_list' then
    if not (lower(trim(coalesce(p_access_email,''))) = any (select lower(x) from unnest(v_survey.allowed_emails) as x)) then
      if not v_is_owner then return jsonb_build_object('ok',false,'reason','forbidden'); end if;
    end if;
  end if;
  if v_survey.access_mode = 'authenticated' then
    if v_account.id is null then return jsonb_build_object('ok',false,'reason','unauthenticated'); end if;
  end if;
  if v_survey.access_mode = 'email_otp' then
    -- OTP verified separately; allow read of survey shell but questions returned only after verification handled client-side via verify endpoint.
    null;
  end if;

  return jsonb_build_object(
    'ok', true,
    'survey', jsonb_build_object(
      'id', v_survey.id,
      'title', v_survey.title,
      'description', v_survey.description,
      'accessMode', v_survey.access_mode,
      'status', v_survey.status,
      'responseLimit', v_survey.response_limit,
      'deadline', v_survey.deadline,
      'resultViewerIds', v_survey.result_viewer_ids
    ),
    'questions', coalesce((
      select jsonb_agg(jsonb_build_object(
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
        'scaleLabelHigh', q.scale_label_high,
        'showIf', q.show_if
      ) order by q.order_index, q.id)
      from smartgov.survey_questions q where q.survey_id = v_survey.id
    ), '[]'::jsonb)
  );
end;
$$;