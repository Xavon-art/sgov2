alter table smartgov.survey_access_otps
  add column if not exists proof_token_hash text,
  add column if not exists proof_expires_at timestamptz,
  add column if not exists proof_used_at timestamptz,
  add column if not exists verified_at timestamptz,
  add column if not exists attempts integer not null default 0;

create index if not exists survey_access_otps_proof_idx
  on smartgov.survey_access_otps (survey_id, email, proof_token_hash)
  where proof_token_hash is not null;

drop function if exists public.list_requirement_answer_versions(text, uuid, uuid);
drop function if exists public.create_survey_otp(uuid, text, text, integer);
drop function if exists public.verify_survey_otp(uuid, text, text);
drop function if exists public.get_survey(text, uuid, text);
drop function if exists public.submit_survey_response(text, uuid, text, jsonb);
drop function if exists smartgov.list_requirement_answer_versions(text, uuid, uuid);
drop function if exists smartgov.create_survey_otp(uuid, text, text, integer);
drop function if exists smartgov.verify_survey_otp(uuid, text, text);
drop function if exists smartgov.get_survey(text, uuid, text);
drop function if exists smartgov.submit_survey_response(text, uuid, text, jsonb);

create or replace function smartgov.list_requirement_answer_versions(
  p_session_token text,
  p_requirement_id uuid,
  p_unit_id uuid
)
returns jsonb
language plpgsql security definer set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_task_org uuid;
  v_is_usg boolean;
  v_units uuid[];
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  select t.organization_id into v_task_org
    from smartgov.task_requirements r
    join smartgov.tasks t on t.id = r.task_id
   where r.id = p_requirement_id;
  if v_task_org is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_task_org <> v_account.organization_id then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  v_is_usg := smartgov.is_usg(v_account.id, v_account.organization_id);
  select coalesce(array_agg(u), '{}'::uuid[]) into v_units
    from smartgov.lsg_unit_ids(v_account.id, v_account.organization_id) u;

  if p_unit_id is not null then
    if not exists (
      select 1 from public.governance_units gu
       where gu.id = p_unit_id and gu.organization_id = v_task_org
    ) then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
    if not v_is_usg and not (p_unit_id = any (v_units)) then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
  end if;

  return jsonb_build_object('ok', true, 'versions', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', v.id, 'version', v.version, 'linkUrl', v.link_url, 'storagePath', v.storage_path,
      'originalName', v.original_name, 'mimeType', v.mime_type, 'sizeBytes', v.size_bytes,
      'reviewStatus', v.review_status, 'reviewNote', v.review_note, 'respondedAt', v.responded_at
    ) order by v.version desc)
    from smartgov.task_requirement_answer_versions v
    where v.requirement_id = p_requirement_id
      and exists (
        select 1 from public.governance_units gu
         where gu.id = v.unit_id and gu.organization_id = v_task_org
      )
      and (
        p_unit_id is not null and v.unit_id = p_unit_id
        or p_unit_id is null and (v_is_usg or v.unit_id = any (v_units))
      )
  ), '[]'::jsonb));
end;
$$;

create or replace function smartgov.create_survey_otp(
  p_survey_id uuid,
  p_email text
)
returns jsonb
language plpgsql security definer set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_survey smartgov.surveys%rowtype;
  v_email text := lower(trim(coalesce(p_email, '')));
  v_bytes bytea;
  v_code text;
begin
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_email');
  end if;

  select * into v_survey from smartgov.surveys where id = p_survey_id;
  if v_survey.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_survey.access_mode <> 'email_otp' then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if v_survey.status <> 'open' then
    return jsonb_build_object('ok', false, 'reason', 'proposal_not_open');
  end if;
  if cardinality(v_survey.allowed_emails) > 0 and not exists (
    select 1 from unnest(v_survey.allowed_emails) as allowed(email)
     where lower(trim(allowed.email)) = v_email
  ) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if not smartgov.consume_rate_limit(
    'survey_otp_send:' || p_survey_id::text || ':' || v_email, 5, interval '30 minutes'
  ) or not smartgov.consume_rate_limit(
    'survey_otp_send_survey:' || p_survey_id::text, 100, interval '1 hour'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  v_bytes := extensions.gen_random_bytes(6);
  v_code :=
    ((get_byte(v_bytes, 0) % 10)::text) ||
    ((get_byte(v_bytes, 1) % 10)::text) ||
    ((get_byte(v_bytes, 2) % 10)::text) ||
    ((get_byte(v_bytes, 3) % 10)::text) ||
    ((get_byte(v_bytes, 4) % 10)::text) ||
    ((get_byte(v_bytes, 5) % 10)::text);

  update smartgov.survey_access_otps
     set used_at = now()
   where survey_id = p_survey_id and email = v_email and used_at is null;

  insert into smartgov.survey_access_otps (survey_id, email, code_hash, expires_at)
  values (p_survey_id, v_email, smartgov.sha256(v_code), now() + interval '10 minutes');

  insert into smartgov.email_queue (to_address, subject, html, text_body)
  values (
    v_email,
    'Your SmartGov survey access code',
    '<p>Your access code is <strong>' || v_code || '</strong>. It expires in 10 minutes.</p>',
    'Your access code is ' || v_code || '. It expires in 10 minutes.'
  );

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function smartgov.verify_survey_otp(
  p_survey_id uuid,
  p_email text,
  p_code text
)
returns jsonb
language plpgsql security definer set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_code text := regexp_replace(coalesce(p_code, ''), '[^0-9]', '', 'g');
  v_row smartgov.survey_access_otps%rowtype;
  v_proof text;
begin
  if length(v_code) <> 6 then
    return jsonb_build_object('ok', false, 'reason', 'otp_mismatch');
  end if;
  if not smartgov.consume_rate_limit(
    'survey_otp_verify:' || p_survey_id::text || ':' || v_email, 10, interval '15 minutes'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  select * into v_row
    from smartgov.survey_access_otps
   where survey_id = p_survey_id
     and email = v_email
     and code_hash = smartgov.sha256(v_code)
     and used_at is null
     and expires_at > now()
   order by created_at desc
   limit 1
   for update skip locked;

  if v_row.id is null then
    return jsonb_build_object('ok', false, 'reason', 'otp_mismatch');
  end if;

  v_proof := encode(extensions.gen_random_bytes(32), 'hex');
  update smartgov.survey_access_otps
     set used_at = now(),
         verified_at = now(),
         attempts = attempts + 1,
         proof_token_hash = smartgov.sha256(v_proof),
         proof_expires_at = now() + interval '2 hours'
   where id = v_row.id;

  return jsonb_build_object('ok', true, 'proofToken', v_proof);
end;
$$;

create or replace function smartgov.get_survey(
  p_session_token text,
  p_survey_id uuid,
  p_access_email text,
  p_access_proof text
)
returns jsonb
language plpgsql security definer set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_survey smartgov.surveys%rowtype;
  v_email text := lower(trim(coalesce(p_access_email, '')));
  v_is_owner boolean := false;
  v_proof_id uuid;
begin
  if p_session_token is not null and p_session_token <> '' then
    v_account := smartgov.authenticate(p_session_token);
  end if;

  select * into v_survey from smartgov.surveys where id = p_survey_id;
  if v_survey.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_account.id is not null and v_account.organization_id = v_survey.organization_id then
    v_is_owner := v_account.account_scope = 'owner';
  end if;

  if v_survey.access_mode = 'authenticated' then
    if v_account.id is null or v_account.organization_id <> v_survey.organization_id then
      return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
    end if;
  elsif v_survey.access_mode = 'email_list' then
    if not v_is_owner then
      if v_email = '' then
        return jsonb_build_object('ok', false, 'reason', 'invalid_email');
      end if;
      if not (v_email = any (v_survey.allowed_emails)) then
        return jsonb_build_object('ok', false, 'reason', 'forbidden');
      end if;
    end if;
  elsif v_survey.access_mode = 'email_otp' and not v_is_owner then
    if v_email = '' or coalesce(p_access_proof, '') = '' then
      return jsonb_build_object(
        'ok', true, 'needsOtp', true,
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
        'questions', '[]'::jsonb
      );
    end if;

    select o.id into v_proof_id
      from smartgov.survey_access_otps o
     where o.survey_id = v_survey.id
       and o.email = v_email
       and o.proof_token_hash = smartgov.sha256(p_access_proof)
       and o.proof_expires_at > now()
       and o.proof_used_at is null
     order by o.proof_expires_at desc
     limit 1;
    if v_proof_id is null then
      return jsonb_build_object('ok', false, 'reason', 'otp_required');
    end if;
  end if;

  if v_survey.status = 'draft' and not v_is_owner then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  return jsonb_build_object(
    'ok', true,
    'needsOtp', false,
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
      from smartgov.survey_questions q
      where q.survey_id = v_survey.id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function smartgov.submit_survey_response(
  p_session_token text,
  p_survey_id uuid,
  p_access_email text,
  p_answers jsonb,
  p_access_proof text
)
returns jsonb
language plpgsql security definer set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_survey smartgov.surveys%rowtype;
  v_email text := lower(trim(coalesce(p_access_email, '')));
  v_proof_id uuid;
  v_count integer;
begin
  if p_session_token is not null and p_session_token <> '' then
    v_account := smartgov.authenticate(p_session_token);
  end if;

  select * into v_survey from smartgov.surveys where id = p_survey_id;
  if v_survey.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if v_survey.access_mode = 'authenticated' then
    if v_account.id is null or v_account.organization_id <> v_survey.organization_id then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
  elsif v_survey.access_mode = 'email_list' then
    if v_email = '' or not (v_email = any (v_survey.allowed_emails)) then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
  elsif v_survey.access_mode = 'email_otp' then
    if v_email = '' or coalesce(p_access_proof, '') = '' then
      return jsonb_build_object('ok', false, 'reason', 'otp_required');
    end if;

    select o.id into v_proof_id
      from smartgov.survey_access_otps o
     where o.survey_id = v_survey.id
       and o.email = v_email
       and o.proof_token_hash = smartgov.sha256(p_access_proof)
       and o.proof_expires_at > now()
       and o.proof_used_at is null
     order by o.proof_expires_at desc
     limit 1
     for update skip locked;
    if v_proof_id is null then
      return jsonb_build_object('ok', false, 'reason', 'otp_required');
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

  if v_proof_id is not null then
    update smartgov.survey_access_otps
       set proof_used_at = now()
     where id = v_proof_id and proof_used_at is null;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.list_requirement_answer_versions(p_session_token text, p_requirement_id uuid, p_unit_id uuid)
returns jsonb language sql security definer as $$ select smartgov.list_requirement_answer_versions($1,$2,$3); $$;
create or replace function public.create_survey_otp(p_survey_id uuid, p_email text)
returns jsonb language sql security definer as $$ select smartgov.create_survey_otp($1,$2); $$;
create or replace function public.verify_survey_otp(p_survey_id uuid, p_email text, p_code text)
returns jsonb language sql security definer as $$ select smartgov.verify_survey_otp($1,$2,$3); $$;
create or replace function public.get_survey(p_session_token text, p_survey_id uuid, p_access_email text, p_access_proof text)
returns jsonb language sql security definer as $$ select smartgov.get_survey($1,$2,$3,$4); $$;
create or replace function public.submit_survey_response(p_session_token text, p_survey_id uuid, p_access_email text, p_answers jsonb, p_access_proof text)
returns jsonb language sql security definer as $$ select smartgov.submit_survey_response($1,$2,$3,$4,$5); $$;

revoke all on function smartgov.list_requirement_answer_versions(text, uuid, uuid) from public;
revoke all on function smartgov.create_survey_otp(uuid, text) from public;
revoke all on function smartgov.verify_survey_otp(uuid, text, text) from public;
revoke all on function smartgov.get_survey(text, uuid, text, text) from public;
revoke all on function smartgov.submit_survey_response(text, uuid, text, jsonb, text) from public;

grant execute on function public.list_requirement_answer_versions(text, uuid, uuid) to anon, authenticated;
grant execute on function public.create_survey_otp(uuid, text) to anon, authenticated;
grant execute on function public.verify_survey_otp(uuid, text, text) to anon, authenticated;
grant execute on function public.get_survey(text, uuid, text, text) to anon, authenticated;
grant execute on function public.submit_survey_response(text, uuid, text, jsonb, text) to anon, authenticated;
