-- 03070 -- Personal requests (LSG -> USG).
--
-- An LSG officer submits a personal request to the USG office: a title, a
-- purpose, a cover letter, an optional support document reference, and a
-- deadline (with timezone). The USG office approves or rejects it. Expired
-- requests are marked expired lazily when read.
--
-- Access is policy-free, like everything else: every read/write goes through a
-- SECURITY DEFINER function that proves the caller with smartgov.authenticate.

create table if not exists smartgov.personal_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  created_by uuid not null references smartgov.accounts (id) on delete cascade,
  title text not null,
  purpose text,
  cover_letter text,
  support_document text,
  deadline timestamptz,
  timezone text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'expired')),
  decided_by uuid references smartgov.accounts (id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now()
);

create index if not exists personal_requests_org_idx on smartgov.personal_requests (organization_id, created_at desc);
create index if not exists personal_requests_creator_idx on smartgov.personal_requests (created_by, created_at desc);


-- ---------------------------------------------------------------------------
-- 1. create_personal_request
-- ---------------------------------------------------------------------------
create or replace function smartgov.create_personal_request(
  p_session_token text,
  p_title text,
  p_purpose text,
  p_cover_letter text,
  p_support_document text,
  p_deadline timestamptz,
  p_timezone text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_id uuid;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if v_account.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;
  if p_title is null or length(trim(p_title)) < 1 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_title');
  end if;
  if p_deadline is not null and p_deadline < now() then
    return jsonb_build_object('ok', false, 'reason', 'past_deadline');
  end if;

  insert into smartgov.personal_requests (
    organization_id, created_by, title, purpose, cover_letter,
    support_document, deadline, timezone
  )
  values (
    v_account.organization_id, v_account.id, trim(p_title),
    nullif(trim(coalesce(p_purpose, '')), ''),
    nullif(trim(coalesce(p_cover_letter, '')), ''),
    nullif(trim(coalesce(p_support_document, '')), ''),
    p_deadline, nullif(trim(coalesce(p_timezone, '')), '')
  )
  returning id into v_id;

  return jsonb_build_object('ok', true, 'requestId', v_id);
end;
$$;

revoke all on function smartgov.create_personal_request(text, text, text, text, text, timestamptz, text) from public;


-- ---------------------------------------------------------------------------
-- 2. list_personal_requests
--    USG owner sees all in the org; LSG sees their own. Expired lazily.
-- ---------------------------------------------------------------------------
create or replace function smartgov.list_personal_requests(p_session_token text)
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

  -- lazy expiry
  update smartgov.personal_requests
     set status = 'expired'
   where organization_id = v_account.organization_id
     and status = 'pending'
     and deadline is not null
     and deadline < now();

  return jsonb_build_object(
    'ok', true,
    'requests', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', r.id,
          'title', r.title,
          'purpose', r.purpose,
          'coverLetter', r.cover_letter,
          'supportDocument', r.support_document,
          'deadline', r.deadline,
          'timezone', r.timezone,
          'status', r.status,
          'decisionNote', r.decision_note,
          'decidedAt', r.decided_at,
          'createdAt', r.created_at,
          'createdBy', r.created_by,
          'canDecide', (v_account.account_scope = 'owner')
        )
        order by r.created_at desc
      )
      from smartgov.personal_requests r
      where r.organization_id = v_account.organization_id
        and (v_account.account_scope = 'owner' or r.created_by = v_account.id)
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function smartgov.list_personal_requests(text) from public;


-- ---------------------------------------------------------------------------
-- 3. get_personal_request
-- ---------------------------------------------------------------------------
create or replace function smartgov.get_personal_request(p_session_token text, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_req smartgov.personal_requests%rowtype;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  select * into v_req from smartgov.personal_requests
    where id = p_request_id and organization_id = v_account.organization_id;
  if v_req.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if not (v_account.account_scope = 'owner' or v_req.created_by = v_account.id) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  -- lazy expiry
  if v_req.status = 'pending' and v_req.deadline is not null and v_req.deadline < now() then
    update smartgov.personal_requests set status = 'expired' where id = v_req.id;
    v_req.status := 'expired';
  end if;

  return jsonb_build_object(
    'ok', true,
    'request', jsonb_build_object(
      'id', v_req.id,
      'title', v_req.title,
      'purpose', v_req.purpose,
      'coverLetter', v_req.cover_letter,
      'supportDocument', v_req.support_document,
      'deadline', v_req.deadline,
      'timezone', v_req.timezone,
      'status', v_req.status,
      'decisionNote', v_req.decision_note,
      'decidedAt', v_req.decided_at,
      'createdAt', v_req.created_at,
      'createdBy', v_req.created_by,
      'canDecide', (v_account.account_scope = 'owner')
    )
  );
end;
$$;

revoke all on function smartgov.get_personal_request(text, uuid) from public;


-- ---------------------------------------------------------------------------
-- 4. decide_personal_request (approve / reject)
-- ---------------------------------------------------------------------------
create or replace function smartgov.decide_personal_request(
  p_session_token text,
  p_request_id uuid,
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
  v_req smartgov.personal_requests%rowtype;
  v_decision text := lower(trim(coalesce(p_decision, '')));
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if v_account.account_scope <> 'owner' then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if v_decision not in ('approved', 'rejected') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  select * into v_req from smartgov.personal_requests
    where id = p_request_id and organization_id = v_account.organization_id;
  if v_req.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_req.status <> 'pending' then
    return jsonb_build_object('ok', false, 'reason', 'already_decided');
  end if;

  update smartgov.personal_requests
     set status = v_decision,
         decided_by = v_account.id,
         decided_at = now(),
         decision_note = nullif(trim(coalesce(p_note, '')), '')
   where id = v_req.id;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function smartgov.decide_personal_request(text, uuid, text, text) from public;


-- ---------------------------------------------------------------------------
-- 5. PostgREST forwarders.
-- ---------------------------------------------------------------------------
create or replace function public.create_personal_request(p_session_token text, p_title text, p_purpose text, p_cover_letter text, p_support_document text, p_deadline timestamptz, p_timezone text)
returns jsonb language sql security definer set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.create_personal_request(p_session_token, p_title, p_purpose, p_cover_letter, p_support_document, p_deadline, p_timezone); $$;
revoke all on function public.create_personal_request(text, text, text, text, text, timestamptz, text) from public;
grant execute on function public.create_personal_request(text, text, text, text, text, timestamptz, text) to anon, authenticated;

create or replace function public.list_personal_requests(p_session_token text)
returns jsonb language sql security definer set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.list_personal_requests(p_session_token); $$;
revoke all on function public.list_personal_requests(text) from public;
grant execute on function public.list_personal_requests(text) to anon, authenticated;

create or replace function public.get_personal_request(p_session_token text, p_request_id uuid)
returns jsonb language sql security definer set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.get_personal_request(p_session_token, p_request_id); $$;
revoke all on function public.get_personal_request(text, uuid) from public;
grant execute on function public.get_personal_request(text, uuid) to anon, authenticated;

create or replace function public.decide_personal_request(p_session_token text, p_request_id uuid, p_decision text, p_note text)
returns jsonb language sql security definer set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.decide_personal_request(p_session_token, p_request_id, p_decision, p_note); $$;
revoke all on function public.decide_personal_request(text, uuid, text, text) from public;
grant execute on function public.decide_personal_request(text, uuid, text, text) to anon, authenticated;