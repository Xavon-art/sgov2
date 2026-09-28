-- Owner registration is gated behind an emailed OTP before approval.
--
-- Today `create_owner_account` writes the owner straight to `active`: a USG
-- registration is approved the moment a wizard finishes, before its email is
-- proven to belong to the person registering. Invited accounts already pass
-- through `set_otp` / `verify_otp`; this migration gives the owner flow the same
-- machinery, keyed to a one-time `verifyToken` the registrant is handed once at
-- registration time.
--
-- Shape of the flow that lands on top:
--
--   register  -> create_owner_account (status = 'pending') returns verifyToken
--             -> set_owner_otp(verifyToken, hmac(code)) stores the code
--             -> otpEmail goes out; the page keeps the verifyToken
--   verify    -> verify_owner_otp(verifyToken, hmac(code)):
--                  wrong code -> attempts left, five per code
--                  right code -> status = 'active', activated_at = now(),
--                                token + OTP fields cleared
--
--   approve   -> the page then signs in, so the dashboard (server-gated on an
--                `active` account) must be reachable; a static
--                `recentlyApproved` callout is exposed on the workspace payload
--                so the first dashboard visit shows the approval banner.
--
-- `login_account` already refuses `pending` accounts (`account_pending`), and
-- `resolve_account` only resolves `active`, so a half-verified owner cannot reach
-- any app surface.

-- ---------------------------------------------------------------- columns

-- The raw `verifyToken` never reaches the database: only its SHA-256 is stored,
-- matching how invite and session tokens are stored. It is returned once to the
-- registrant in the register response and never emailed, so unlike an invite
-- token there is no link to lose or forward.
alter table smartgov.accounts
  add column if not exists verify_token_hash text;

-- Resend metering lives on the account (mirroring `invites.otp_resends` /
-- `invites.otp_last_sent_at`) so a mailbox is not used as an amplifier, and the
-- five-resend budget binds for the life of the pending registration.
alter table smartgov.accounts
  add column if not exists otp_resends      integer not null default 0;
alter table smartgov.accounts
  add column if not exists otp_last_sent_at timestamptz;

create index if not exists accounts_verify_token_idx
  on smartgov.accounts (verify_token_hash)
  where verify_token_hash is not null;

-- ---------------------------------------------------------------- create

-- Same signature and hardening as 003; the only changes are the status written
-- (`pending` instead of `active`), the org context returned for the OTP email,
-- and the `verifyToken` minted once and returned to the registrant.
create or replace function smartgov.create_owner_account(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_email      text := lower(trim(coalesce(p_payload->>'email', '')));
  v_password   text := coalesce(p_payload->>'password', '');
  v_name       text := trim(coalesce(p_payload->>'displayName', ''));
  v_kind       smartgov.account_kind;
  v_org_id     uuid;
  v_account_id uuid;
  v_raw_kind   text := coalesce(p_payload->>'accountKind', 'usg');
  v_org_name   text;
  v_org_campus text;
  v_limited    boolean;
  v_verify_raw text := encode(extensions.gen_random_bytes(24), 'hex');
begin
  if v_email = '' or position('@' in v_email) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_email');
  end if;

  if length(v_password) < 8 then
    return jsonb_build_object('ok', false, 'reason', 'weak_password');
  end if;

  if v_name = '' then
    return jsonb_build_object('ok', false, 'reason', 'missing_name');
  end if;

  v_limited := smartgov.register_rate_limited(v_email);
  if v_limited then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  if v_raw_kind = 'central' then
    v_kind := 'central';
  else
    v_kind := 'usg';
  end if;

  begin
    v_org_id := nullif(btrim(coalesce(p_payload->>'organizationId', '')), '')::uuid;
  exception when invalid_text_representation then
    return jsonb_build_object('ok', false, 'reason', 'invalid_organization');
  end;

  if v_org_id is not null then
    -- The founding member is the proof of authorship. No row, no ownership.
    select o.name, o.campus_name into v_org_name, v_org_campus
    from public.organizations o
    where o.id = v_org_id
      and exists (
        select 1
        from public.organization_members m
        where m.organization_id = v_org_id
          and lower(m.email) = v_email
          and m.is_founding
      );

    if not found then
      return jsonb_build_object('ok', false, 'reason', 'not_organization_founder');
    end if;
  end if;

  if exists (select 1 from smartgov.accounts a where lower(a.email) = v_email) then
    return jsonb_build_object('ok', false, 'reason', 'email_taken');
  end if;

  insert into smartgov.accounts (
    email, password_hash, display_name, account_kind, account_scope,
    organization_id, university_name, campus_name, status,
    verify_token_hash
  )
  values (
    v_email, smartgov.hash_password(v_password), v_name, v_kind, 'owner',
    v_org_id,
    -- `university_name` and `campus_name` are NOT NULL with no default. The
    -- organization record is only consulted when one matched, and a unitary
    -- organization has a null `campus_name`, so the trailing '' is load-bearing:
    -- without it this raises 23502 for exactly the councils that never filled in
    -- a campus field.
    trim(coalesce(nullif(btrim(coalesce(p_payload->>'universityName', '')), ''), v_org_name, '')),
    trim(coalesce(nullif(btrim(coalesce(p_payload->>'campusName', '')), ''), v_org_campus, '')),
    'pending', smartgov.sha256(v_verify_raw)
  )
  returning id into v_account_id;

  if v_org_id is not null and v_org_name is null then
    select coalesce(o.name, ''), coalesce(o.campus_name, '')
      into v_org_name, v_org_campus
    from public.organizations o
    where o.id = v_org_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'accountId', v_account_id,
    'verifyToken', v_verify_raw,
    'email', v_email,
    'accountKind', v_kind,
    'organizationName', v_org_name,
    'campusName', v_org_campus
  );
end;
$$;

-- ---------------------------------------------------------------- owner OTP

-- Stores the OTP HMAC for a still-pending owner registration. Keyed on the raw
-- `verifyToken` (resolved through its hash) rather than an account id, so only
-- the registrant who was handed the token can plant or overwrite a code -- the
-- same reasoning as `set_otp` for invites.
create or replace function smartgov.set_owner_otp(
  p_verify_token text,
  p_otp_hash     text,
  p_ttl_minutes  integer default 15
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
begin
  if p_verify_token is null or p_verify_token = ''
     or p_otp_hash is null or p_otp_hash = '' then
    return false;
  end if;

  select a.* into v_account
  from smartgov.accounts a
  where a.verify_token_hash = smartgov.sha256(p_verify_token)
    and a.status = 'pending';

  if not found then
    return false;
  end if;

  if v_account.otp_resends >= 5 then
    return false;
  end if;

  -- Cooldown, so the mailbox is not used as an amplifier either.
  if v_account.otp_last_sent_at is not null
     and v_account.otp_last_sent_at > now() - interval '2 minutes' then
    return false;
  end if;

  update smartgov.accounts
     set otp_hash       = p_otp_hash,
         otp_expires_at = now() + make_interval(mins => greatest(1, least(p_ttl_minutes, 60))),
         otp_attempts   = 0,
         otp_resends    = otp_resends + 1,
         otp_last_sent_at = now()
   where id = v_account.id;

  return found;
end;
$$;

revoke all on function smartgov.set_owner_otp(text, text, integer) from public;

-- Activates the registration on a correct code. Mirrors `verify_otp`:
-- five attempts per code, an IP-rate-limited budget held on the account id, and
-- a `for update` lock so a concurrent pair of guesses cannot both read the
-- remaining budget.
create or replace function smartgov.verify_owner_otp(p_verify_token text, p_code_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_org     text;
  v_univ    text;
  v_key     text;
begin
  if p_verify_token is null or p_verify_token = ''
     or p_code_hash is null or p_code_hash = '' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  select a.* into v_account
  from smartgov.accounts a
  where a.verify_token_hash = smartgov.sha256(p_verify_token)
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  if v_account.status = 'active' then
    return jsonb_build_object('ok', true, 'alreadyActive', true, 'email', v_account.email);
  end if;

  if v_account.status <> 'pending' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  v_key := 'owner-otp:verify:' || v_account.id::text;

  if not smartgov.consume_rate_limit(v_key, 20, interval '15 minutes') then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  if v_account.otp_hash is null or v_account.otp_expires_at is null
     or v_account.otp_expires_at < now() then
    return jsonb_build_object('ok', false, 'reason', 'otp_expired');
  end if;

  if v_account.otp_attempts >= 5 then
    return jsonb_build_object('ok', false, 'reason', 'too_many_attempts');
  end if;

  if v_account.otp_hash <> p_code_hash then
    update smartgov.accounts
       set otp_attempts = otp_attempts + 1
     where id = v_account.id;

    return jsonb_build_object(
      'ok', false,
      'reason', 'otp_mismatch',
      'attemptsLeft', greatest(0, 5 - (v_account.otp_attempts + 1)::int)
    );
  end if;

  update smartgov.accounts
     set status          = 'active',
         activated_at    = now(),
         otp_hash        = null,
         otp_expires_at  = null,
         otp_attempts    = 0,
         otp_resends     = 0,
         otp_last_sent_at = null,
         verify_token_hash = null
   where id = v_account.id;

  -- Org context for the approval email. Owner accounts with a `central` scope
  -- have no organization row; the empty strings keep the mail template happy.
  select coalesce(o.name, ''), coalesce(o.university_name, '')
    into v_org, v_univ
  from public.organizations o
  where o.id = v_account.organization_id;

  return jsonb_build_object(
    'ok', true,
    'alreadyActive', false,
    'email', v_account.email,
    'displayName', v_account.display_name,
    'accountKind', v_account.account_kind,
    'organizationName', v_org,
    'universityName', v_univ,
    'campusName', v_account.campus_name
  );
exception
  when others then
    return jsonb_build_object('ok', false, 'reason', 'verify_failed');
end;
$$;

revoke all on function smartgov.verify_owner_otp(text, text) from public;

-- Read-only probe so the resend route can address the OTP email without knowing
-- the account id. Mirrors `accept_invite_probe` for invites.
create or replace function smartgov.owner_registration_probe(p_verify_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_org     text;
  v_univ    text;
begin
  if p_verify_token is null or p_verify_token = '' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  select a.* into v_account
  from smartgov.accounts a
  where a.verify_token_hash = smartgov.sha256(p_verify_token);

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  if v_account.status = 'active' then
    return jsonb_build_object('ok', false, 'reason', 'already_registered');
  end if;

  select coalesce(o.name, ''), coalesce(o.university_name, '')
    into v_org, v_univ
  from public.organizations o
  where o.id = v_account.organization_id;

  return jsonb_build_object(
    'ok', true,
    'email', v_account.email,
    'campusName', v_account.campus_name,
    'organizationName', v_org,
    'universityName', v_univ
  );
end;
$$;

revoke all on function smartgov.owner_registration_probe(text) from public;

-- ---------------------------------------------------------------- dashboard

-- One-shot approval banner. Only the "recently" window is persisted (nothing is
-- written), because the email is the durable notification and this callout only
-- needs to bridge the first dashboard visit right after approval.
create or replace function smartgov.account_workspace(p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_org    public.organizations%rowtype;
  v_total  bigint;
  v_pending bigint;
  v_active bigint;
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if v_account.organization_id is not null then
    select * into v_org
    from public.organizations o
    where o.id = v_account.organization_id;
  end if;

  select
    count(*),
    count(*) filter (where status = 'pending'),
    count(*) filter (where status = 'activated')
  into v_total, v_pending, v_active
  from smartgov.invites i
  where i.organization_id = v_account.organization_id
    and i.status <> 'revoked';

  return jsonb_build_object(
    'ok', true,
    'email', v_account.email,
    'displayName', v_account.display_name,
    'accountKind', v_account.account_kind,
    'accountScope', v_account.account_scope,
    'universityName', coalesce(v_org.university_name, v_account.university_name),
    'campusName', v_account.campus_name,
    'organizationName', coalesce(v_org.name, ''),
    'charterNumber', coalesce(v_org.charter_number, ''),
    'academicYear', coalesce(v_org.academic_year, ''),
    'accent', coalesce(v_org.accent, '#16324f'),
    'governanceModel', v_org.governance_model,
    'inviteCount', v_total,
    'pendingCount', v_pending,
    'activatedCount', v_active,
    -- True for an owner whose account became active in the last few minutes.
    -- `account_scope` is an owner-only stamp, so invited members never see an
    -- "your USG was approved" banner for someone else's registration.
    'recentlyApproved',
      (v_account.account_scope = 'owner'
       and v_account.activated_at is not null
       and v_account.activated_at > now() - interval '15 minutes')
  );
end;
$$;

-- ---------------------------------------------------------------- PostgREST surface

-- New `smartgov` originals come back with PUBLIC execute by default, so each one
-- is revoked above, at the end of its own block, and reachable only through its
-- `public` allow-list wrapper below.

create or replace function public.set_owner_otp(
  p_verify_token text,
  p_otp_hash     text,
  p_ttl_minutes  integer default 15
)
returns boolean
language sql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.set_owner_otp(p_verify_token, p_otp_hash, p_ttl_minutes); $$;

revoke all on function public.set_owner_otp(text, text, integer) from public;

create or replace function public.verify_owner_otp(p_verify_token text, p_code_hash text)
returns jsonb
language sql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.verify_owner_otp(p_verify_token, p_code_hash); $$;

revoke all on function public.verify_owner_otp(text, text) from public;

create or replace function public.owner_registration_probe(p_verify_token text)
returns jsonb
language sql
security definer
set search_path = public, smartgov, pg_temp
as $$ select smartgov.owner_registration_probe(p_verify_token); $$;

revoke all on function public.owner_registration_probe(text) from public;

grant execute on function public.set_owner_otp(text, text, integer)          to anon, authenticated;
grant execute on function public.verify_owner_otp(text, text)                to anon, authenticated;
grant execute on function public.owner_registration_probe(text)              to anon, authenticated;