-- SmartGov: expose the auth API to PostgREST, and close the holes found in review.
--
-- 20260101000200 created the `smartgov` schema and its functions, but nothing
-- in the application could actually call them. PostgREST on this project only
-- exposes the `public` schema, so every `supabase.rpc("login_account", ...)`
-- failed with PGRST202 and `/api/auth/login` returned 500. Two ways out:
-- add `smartgov` to the project's exposed-schema setting (a dashboard change we
-- cannot make from SQL), or publish thin `public` entry points. This migration
-- takes the second route, because it also lets the reachable surface be an
-- explicit allowlist rather than "every function in the schema".
--
-- The wrappers are the ONLY functions `anon` or `authenticated` may execute.
-- Execute on the `smartgov` originals is revoked below, so the audited
-- allowlist is the whole attack surface. Two of the eighteen are deliberately
-- never published:
--   * `smartgov.authenticate` returns a whole `smartgov.accounts` row, which
--     includes `password_hash` and `otp_hash`. Publishing it would hand every
--     caller a credential-hash dump.
--   * `refresh_invite_status` is a maintenance sweep with no caller.
-- `sha256`, `hash_password` and `password_matches` are likewise withheld, so
-- `anon` cannot use the database as a free bcrypt oracle.
--
-- Also folded in, all of which are hardening of 002:
--   * `create_owner_account` no longer trusts a client-supplied organization
--     id. Anyone holding the publishable key could previously claim ownership
--     of any organization and mint invitations for it.
--   * `set_otp` no longer hands an unlimited guessing budget to whoever holds an
--     invite token, and login/registration/invitation/OTP calls are rate
--     limited in the database so the limits hold for direct PostgREST callers
--     as well as for traffic through the Next.js routes.
--   * The blanket `grant execute on all functions in schema smartgov` from 002
--     is dropped; a function added to that schema later no longer becomes
--     publicly callable by accident.

-- ---------------------------------------------------------------- pgcrypto

-- 002 pinned `search_path = public, smartgov, pg_temp` onto its plpgsql
-- functions, but this project installs pgcrypto into `extensions`, not
-- `public`. `gen_random_bytes()` therefore did not resolve at runtime and
-- `login_account` and `create_invite` raised "function does not exist" the
-- moment they were reached, independently of the PGRST202 problem below.
--
-- The three helpers from 002 have the mirror-image fault: they are `language
-- sql` with no `set search_path` at all, so they resolved `digest`, `crypt` and
-- `gen_salt` against whatever search_path the caller happened to be using. They
-- worked when called from a session carrying the database default, and would
-- stop working the moment they were called from a function that pins a narrower
-- path -- which is exactly what the `public` wrappers below do.
--
-- Both are fixed by the same two things: qualify every pgcrypto call, and pin a
-- search_path that includes `extensions` on every function that reaches one.
create or replace function smartgov.sha256(p_value text)
returns text
language sql
immutable
strict
set search_path = public, extensions, pg_temp
as $$
  select encode(extensions.digest(p_value, 'sha256'), 'hex');
$$;

create or replace function smartgov.hash_password(p_password text)
returns text
language sql
immutable
strict
set search_path = public, extensions, pg_temp
as $$
  select extensions.crypt(p_password, extensions.gen_salt('bf', 10));
$$;

create or replace function smartgov.password_matches(p_password text, p_hash text)
returns boolean
language sql
strict
set search_path = public, extensions, pg_temp
as $$
  select p_hash = extensions.crypt(p_password, p_hash);
$$;

-- ---------------------------------------------------------------- rate limits

-- Fixed-window counters. `bucket` holds "<name>#<window slot>", so a window
-- rolling over naturally starts a fresh key rather than resetting a row, and a
-- burst cannot borrow the previous window's headroom.
create table if not exists smartgov.rate_limits (
  bucket   text        primary key,
  hits     integer     not null default 0,
  reset_at timestamptz not null
);

create index if not exists rate_limits_reset_idx
  on smartgov.rate_limits (reset_at);

alter table smartgov.rate_limits enable row level security;

-- Returns true while the caller is still inside its budget, and false once the
-- window is exhausted. One atomic upsert, so concurrent callers cannot race
-- past the cap.
create or replace function smartgov.consume_rate_limit(
  p_bucket text,
  p_limit  integer,
  p_window interval
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_seconds numeric := greatest(1, extract(epoch from p_window)::numeric);
  v_slot    bigint   := floor(extract(epoch from now()) / v_seconds)::bigint;
  v_hits    integer;
begin
  if p_bucket is null or p_bucket = '' or p_limit <= 0 then
    return false;
  end if;

  insert into smartgov.rate_limits as rl (bucket, hits, reset_at)
  values (p_bucket || '#' || v_slot::text, 1,
          to_timestamp(((v_slot + 1) * v_seconds)::double precision))
  on conflict (bucket) do update set hits = rl.hits + 1
  returning hits into v_hits;

  -- Opportunistic sweep. Sampling keeps the hot path from paying for a delete
  -- on every single call while still keeping the table bounded.
  if random() < 0.02 then
    delete from smartgov.rate_limits where reset_at < now() - interval '1 hour';
  end if;

  return v_hits <= p_limit;
end;
$$;

-- ---------------------------------------------------------------- limits

create or replace function smartgov.login_rate_limited(p_email text)
returns boolean
language sql
stable
as $$
  select
    -- Per address: stops one account being ground down, and is what a shared
    -- campus address needs.
    not smartgov.consume_rate_limit(
           'login:email:' || lower(trim(coalesce(p_email, ''))),
           10, interval '10 minutes')
    -- Global ceiling: a spray across many addresses is invisible to a
    -- per-address limit, so bound the total attempt volume as well.
    or not smartgov.consume_rate_limit(
           'login:global', 2000, interval '10 minutes');
$$;

create or replace function smartgov.register_rate_limited(p_email text)
returns boolean
language sql
stable
as $$
  select
    not smartgov.consume_rate_limit(
           'register:email:' || lower(trim(coalesce(p_email, ''))),
           5, interval '1 hour')
    or not smartgov.consume_rate_limit(
           'register:global', 500, interval '1 hour');
$$;

-- ------------------------------------------------------- owner registration

-- Same signature and return type as 002, so this replaces it in place.
--
-- The organization id is no longer taken on trust. 002 accepted any id that
-- merely existed, which meant the publishable key plus any organization id was
-- enough to become that organization's owner and start issuing invitations into
-- it. `create_organization` already records the officer who made the
-- organization as a founding member, so requiring that row to exist binds the
-- account to a real creation event, and requires the registering address to be
-- the address that made it.
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
    organization_id, university_name, campus_name, status, activated_at
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
    'active', now()
  )
  returning id into v_account_id;

  return jsonb_build_object(
    'ok', true,
    'accountId', v_account_id,
    'email', v_email,
    'accountKind', v_kind
  );
end;
$$;

-- ---------------------------------------------------------------- login

create or replace function smartgov.login_account(p_email text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_raw     text;
begin
  if p_email is null or p_password is null or p_email = '' or p_password = '' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_credentials');
  end if;

  if smartgov.login_rate_limited(p_email) then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  -- Minted before the password check so a wrong guess costs a row write and the
  -- timing does not reveal whether the address exists.
  v_raw := encode(extensions.gen_random_bytes(32), 'hex');

  select a.* into v_account
  from smartgov.accounts a
  where lower(a.email) = lower(trim(p_email));

  if not found then
    -- Spend comparable time so a missing account is not distinguishable by
    -- timing from a wrong password.
    perform smartgov.password_matches(p_password, smartgov.hash_password('dummy'));
    return jsonb_build_object('ok', false, 'reason', 'invalid_credentials');
  end if;

  if not smartgov.password_matches(p_password, v_account.password_hash) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_credentials');
  end if;

  if v_account.status <> 'active' then
    return jsonb_build_object('ok', false, 'reason', 'account_pending');
  end if;

  insert into smartgov.sessions (account_id, token_hash, expires_at)
  values (v_account.id, smartgov.sha256(v_raw), now() + interval '30 days');

  return jsonb_build_object(
    'ok', true,
    'token', v_raw,
    -- The welcome letter is owed to an invited account that has not had one.
    'welcomeDue', (v_account.account_scope = 'invited' and v_account.welcome_sent_at is null),
    'account', jsonb_build_object(
      'id', v_account.id,
      'email', v_account.email,
      'displayName', v_account.display_name,
      'accountKind', v_account.account_kind,
      'accountScope', v_account.account_scope,
      'organizationId', v_account.organization_id,
      'universityName', v_account.university_name,
      'campusName', v_account.campus_name
    )
  );
end;
$$;

-- ---------------------------------------------------------------- invitations

create or replace function smartgov.create_invite(
  p_session_token text,
  p_email          text,
  p_campus_name    text,
  p_unit_type      text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account  smartgov.accounts%rowtype;
  v_email    text := lower(trim(coalesce(p_email, '')));
  v_raw      text := encode(extensions.gen_random_bytes(24), 'hex');
  v_unit     public.unit_type := 'lsg';
  v_invite_id uuid;
  v_org_name text;
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if v_account.account_scope <> 'owner' then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if v_account.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;

  if v_email = '' or position('@' in v_email) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_email');
  end if;

  -- Two ceilings, because they defend against different things: the per-session
  -- one stops one compromised account mailing out, and the per-address one stops
  -- one organization spamming a single inbox.
  if not smartgov.consume_rate_limit(
       'invite:session:' || v_account.id::text, 30, interval '1 hour')
     or not smartgov.consume_rate_limit(
       'invite:email:' || v_email, 5, interval '1 hour') then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  if exists (select 1 from smartgov.accounts a where lower(a.email) = v_email) then
    return jsonb_build_object('ok', false, 'reason', 'already_registered');
  end if;

  if p_unit_type in ('lsg', 'college', 'campus', 'council') then
    v_unit := p_unit_type::public.unit_type;
  end if;

  update smartgov.invites
     set status = 'revoked'
   where organization_id = v_account.organization_id
     and lower(email) = v_email
     and status = 'pending';

  insert into smartgov.invites (
    organization_id, email, campus_name, unit_type, token_hash,
    invited_by, expires_at
  )
  values (
    v_account.organization_id, v_email, trim(coalesce(p_campus_name, '')),
    v_unit, smartgov.sha256(v_raw), v_account.display_name, now() + interval '14 days'
  )
  returning id into v_invite_id;

  select o.name into v_org_name
  from public.organizations o
  where o.id = v_account.organization_id;

  return jsonb_build_object(
    'ok', true,
    'token', v_raw,
    'inviteId', v_invite_id,
    'email', v_email,
    'organizationName', v_org_name,
    'universityName', v_account.university_name,
    'expiresAt', (now() + interval '14 days')
  );
end;
$$;

-- ---------------------------------------------------------------- OTP

-- Lifetime resend budget, held on the invite rather than in a rate-limit
-- window. A window would not do: the invite is valid for 14 days, so a
-- per-window cap can be spent again and again and the guess budget stays
-- effectively unbounded.
alter table smartgov.invites
  add column if not exists otp_resends      integer not null default 0;
alter table smartgov.invites
  add column if not exists otp_last_sent_at timestamptz;

-- In 002 this set `otp_attempts = 0`, so the sequence "guess, re-send, guess"
-- never terminated: every re-send handed back a fresh set of five tries. The
-- attempt counter is still per code, but the number of codes an invite can
-- produce is now capped for the life of the invite, which bounds the total
-- guesses at five resends times five attempts.
create or replace function smartgov.set_otp(
  p_invite_token text,
  p_otp_hash     text,
  p_ttl_minutes  integer default 15
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_invite smartgov.invites%rowtype;
begin
  if p_invite_token is null or p_invite_token = ''
     or p_otp_hash is null or p_otp_hash = '' then
    return false;
  end if;

  select i.* into v_invite
  from smartgov.invites i
  where i.token_hash = smartgov.sha256(p_invite_token)
    and i.status = 'pending'
    and i.expires_at > now();

  if not found then
    return false;
  end if;

  if v_invite.otp_resends >= 5 then
    return false;
  end if;

  -- Cooldown, so the mailbox is not used as an amplifier either.
  if v_invite.otp_last_sent_at is not null
     and v_invite.otp_last_sent_at > now() - interval '2 minutes' then
    return false;
  end if;

  update smartgov.invites
     set otp_resends      = otp_resends + 1,
         otp_last_sent_at = now()
   where id = v_invite.id;

  update smartgov.accounts a
     set otp_hash      = p_otp_hash,
         otp_expires_at = now() + make_interval(mins => greatest(1, least(p_ttl_minutes, 60))),
         otp_attempts   = 0
   where lower(a.email) = v_invite.email
     and a.organization_id = v_invite.organization_id
     and a.status = 'pending';

  return found;
end;
$$;

-- Same signature and return type as 002. Adds a per-invite ceiling on raw
-- verification calls, so a caller cannot burn the account's attempt budget
-- faster than the route handler would allow.
create or replace function smartgov.verify_otp(p_invite_token text, p_code_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_invite  smartgov.invites%rowtype;
  v_account smartgov.accounts%rowtype;
  v_key     text;
begin
  if p_invite_token is null or p_invite_token = ''
     or p_code_hash is null or p_code_hash = '' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  select i.* into v_invite
  from smartgov.invites i
  where i.token_hash = smartgov.sha256(p_invite_token)
    and i.expires_at > now();

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'invalid_invite');
  end if;

  v_key := 'otp:verify:' || v_invite.id::text;

  if not smartgov.consume_rate_limit(v_key, 20, interval '15 minutes') then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  select a.* into v_account
  from smartgov.accounts a
  where lower(a.email) = v_invite.email
    and a.organization_id = v_invite.organization_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  if v_account.status = 'active' then
    return jsonb_build_object('ok', true, 'alreadyActive', true, 'email', v_account.email);
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
     set status       = 'active',
         activated_at = now(),
         otp_hash      = null,
         otp_expires_at = null,
         otp_attempts  = 0
   where id = v_account.id;

  update smartgov.invites
     set status = 'activated', activated_at = now()
   where id = v_invite.id
     and status = 'pending';

  return jsonb_build_object(
    'ok', true,
    'email', v_account.email,
    'campusName', v_account.campus_name,
    'universityName', v_account.university_name,
    'accountKind', v_account.account_kind
  );
exception
  when others then
    return jsonb_build_object('ok', false, 'reason', 'verify_failed');
end;
$$;

-- ---------------------------------------------------------------- PostgREST surface

-- Thin `public` entry points. Each one only forwards; all validation and all
-- authorization stay in the `smartgov` originals, so a wrapper cannot be
-- stricter or looser than the logic it calls.
--
-- SECURITY DEFINER so the originals can be unreachable directly: these are then
-- the only callable functions, and this list is the whole surface. Do not add
-- logic to a wrapper.
create or replace function public.login_account(p_email text, p_password text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.login_account(p_email, p_password); $$;

create or replace function public.create_owner_account(p_payload jsonb)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.create_owner_account(p_payload); $$;

create or replace function public.delete_session(p_token text)
returns boolean language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.delete_session(p_token); $$;

create or replace function public.resolve_account(p_token text)
returns table (
  id              uuid,
  email           text,
  display_name    text,
  account_kind    smartgov.account_kind,
  account_scope   smartgov.account_scope,
  organization_id uuid,
  university_name text,
  campus_name     text,
  status          smartgov.account_status
)
language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select * from smartgov.resolve_account(p_token); $$;

create or replace function public.create_invite(
  p_session_token text,
  p_email         text,
  p_campus_name   text,
  p_unit_type     text
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.create_invite(p_session_token, p_email, p_campus_name, p_unit_type); $$;

create or replace function public.list_invites(p_session_token text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.list_invites(p_session_token); $$;

create or replace function public.accept_invite(p_token text, p_password text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.accept_invite(p_token, p_password); $$;

create or replace function public.accept_invite_probe(p_token text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.accept_invite_probe(p_token); $$;

create or replace function public.set_otp(
  p_invite_token text,
  p_otp_hash     text,
  p_ttl_minutes  integer
)
returns boolean language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.set_otp(p_invite_token, p_otp_hash, p_ttl_minutes); $$;

create or replace function public.verify_otp(p_invite_token text, p_code_hash text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.verify_otp(p_invite_token, p_code_hash); $$;

create or replace function public.welcome_context(p_session_token text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.welcome_context(p_session_token); $$;

create or replace function public.mark_welcome_sent(p_session_token text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.mark_welcome_sent(p_session_token); $$;

create or replace function public.account_workspace(p_session_token text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.account_workspace(p_session_token); $$;

-- ---------------------------------------------------------------- grants

-- The reachable surface is exactly the list above. Revoking `all` first means
-- this is a full replacement of 002's blanket `grant execute on all functions
-- in schema smartgov`, including the effect it had on `authenticate`,
-- `hash_password`, `password_matches`, `sha256` and `refresh_invite_status`.
revoke all on schema smartgov from anon, authenticated;

revoke execute on all functions in schema smartgov from public;
revoke execute on all functions in schema smartgov from anon, authenticated;

revoke all on table smartgov.rate_limits from public;
revoke all on table smartgov.rate_limits from anon, authenticated;

grant execute on function public.login_account(text, text)                  to anon, authenticated;
grant execute on function public.create_owner_account(jsonb)                to anon, authenticated;
grant execute on function public.delete_session(text)                       to anon, authenticated;
grant execute on function public.resolve_account(text)                      to anon, authenticated;
grant execute on function public.create_invite(text, text, text, text)       to anon, authenticated;
grant execute on function public.list_invites(text)                         to anon, authenticated;
grant execute on function public.accept_invite(text, text)                  to anon, authenticated;
grant execute on function public.accept_invite_probe(text)                  to anon, authenticated;
grant execute on function public.set_otp(text, text, integer)               to anon, authenticated;
grant execute on function public.verify_otp(text, text)                     to anon, authenticated;
grant execute on function public.welcome_context(text)                      to anon, authenticated;
grant execute on function public.mark_welcome_sent(text)                    to anon, authenticated;
grant execute on function public.account_workspace(text)                    to anon, authenticated;

-- ---------------------------------------------------------------- inherited grants

-- 001 revoked the four core tables from `anon` but left the default Supabase
-- grants to `authenticated` in place. No policy exists for that role either, so
-- today RLS is what stops it; closing the grant too means a future policy is
-- not the only thing standing between a signed-in user and every organization's
-- submissions. Nothing in the app authenticates as `authenticated`.
revoke all on table public.organizations       from anon, authenticated;
revoke all on table public.organization_members from anon, authenticated;
revoke all on table public.governance_units     from anon, authenticated;
revoke all on table public.submissions          from anon, authenticated;

-- Same reasoning: a trigger function is not an entry point.
revoke execute on function public.touch_updated_at() from public;
revoke execute on function public.touch_updated_at() from anon, authenticated;
