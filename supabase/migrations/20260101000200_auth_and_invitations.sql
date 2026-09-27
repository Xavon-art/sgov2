-- SmartGov accounts, invitations, and sessions.
--
-- Design constraint: this project has no `service_role` key, so every write below
-- happens through a SECURITY DEFINER function callable by `anon`. The functions
-- are the entire privilege boundary -- the tables stay unreachable to `anon`.
--
-- Two rules shape every function here:
--
--   1. No function trusts an identity or organization id from the client.
--      Owner-facing functions take a session token and resolve the account
--      themselves, so a caller cannot reach another organization's data by
--      passing a different id.
--
--   2. `login_account` verifies credentials and mints the session in one
--      statement. A separate `create_session(account_id)` would let `anon`
--      mint a session for any account id it could guess.
--
-- Passwords are bcrypt hashes produced by pgcrypto, so no extra dependency is
-- needed and the plaintext never touches the database.

create schema if not exists smartgov;

-- ---------------------------------------------------------------- enums

do $$ begin
  create type smartgov.account_kind as enum ('usg', 'central');
exception when duplicate_object then null; end $$;

-- `owner` may send invitations; `invited` was brought in by one.
do $$ begin
  create type smartgov.account_scope as enum ('owner', 'invited');
exception when duplicate_object then null; end $$;

do $$ begin
  create type smartgov.account_status as enum ('pending', 'active', 'suspended');
exception when duplicate_object then null; end $$;

do $$ begin
  create type smartgov.invite_status as enum ('pending', 'activated', 'expired', 'revoked');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------- tables

-- Passwords are bcrypt (`crypt`). Codes and tokens are hex digests, never
-- plaintext: `otp_hash` is an HMAC of the six-digit code, and invite/session
-- tokens are stored as SHA-256.
create table if not exists smartgov.accounts (
  id              uuid primary key default gen_random_uuid(),
  email           text        not null,
  password_hash   text        not null,
  display_name    text        not null,
  account_kind    smartgov.account_kind   not null,
  account_scope   smartgov.account_scope  not null default 'owner',
  organization_id uuid        references public.organizations (id) on delete cascade,
  university_name text        not null default '',
  campus_name     text        not null default '',
  status          smartgov.account_status not null default 'pending',
  otp_hash        text,
  otp_expires_at  timestamptz,
  otp_attempts    smallint    not null default 0,
  created_at      timestamptz not null default now(),
  activated_at    timestamptz,
  -- Set once the welcome letter goes out, so a first login cannot re-send it.
  welcome_sent_at timestamptz,
  constraint accounts_min_password check (length(password_hash) >= 20)
);

-- citext is avoided on purpose so the migration does not depend on an
-- extension the project may not be able to create.
create unique index if not exists accounts_email_uniq
  on smartgov.accounts (lower(email));

create table if not exists smartgov.invites (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations (id) on delete cascade,
  email           text        not null,
  campus_name     text        not null default '',
  unit_type       public.unit_type not null default 'lsg',
  token_hash      text        not null,
  status          smartgov.invite_status not null default 'pending',
  invited_by      text        not null default '',
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null,
  activated_at    timestamptz
);

create index if not exists invites_org_idx
  on smartgov.invites (organization_id, created_at desc);
create index if not exists invites_token_idx
  on smartgov.invites (token_hash);
create index if not exists invites_email_idx
  on smartgov.invites (lower(email));

create table if not exists smartgov.sessions (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid        not null references smartgov.accounts (id) on delete cascade,
  token_hash   text        not null,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at   timestamptz not null
);

create unique index if not exists sessions_token_uniq
  on smartgov.sessions (token_hash);
create index if not exists sessions_account_idx
  on smartgov.sessions (account_id);

-- ---------------------------------------------------------------- helpers

create or replace function smartgov.sha256(p_value text)
returns text
language sql
immutable
strict
as $$
  select encode(digest(p_value, 'sha256'), 'hex');
$$;

create or replace function smartgov.hash_password(p_password text)
returns text
language sql
immutable
strict
as $$
  select crypt(p_password, gen_salt('bf', 10));
$$;

create or replace function smartgov.password_matches(p_password text, p_hash text)
returns boolean
language sql
immutable
strict
as $$
  select p_hash = crypt(p_password, p_hash);
$$;

-- Resolves a session token to its account, refusing expired sessions and any
-- account that is not `active`. Returns null on every failure path so callers
-- never have to distinguish "no such token" from "wrong password".
create or replace function smartgov.resolve_account(p_token text)
returns table (
  id uuid,
  email text,
  display_name text,
  account_kind smartgov.account_kind,
  account_scope smartgov.account_scope,
  organization_id uuid,
  university_name text,
  campus_name text,
  status smartgov.account_status
)
language plpgsql
security definer
set search_path = public, smartgov, pg_temp
as $$
begin
  -- Two statements on purpose. `RETURNING` can only read the table being
  -- modified, so the touch and the read cannot share one UPDATE ... RETURNING
  -- with a join.
  update smartgov.sessions s
     set last_seen_at = now()
   where s.token_hash = smartgov.sha256(p_token)
     and s.expires_at > now()
     and exists (
       select 1
       from smartgov.accounts a
       where a.id = s.account_id
         and a.status = 'active'
     );

  return query
  select a.id, a.email, a.display_name, a.account_kind, a.account_scope,
         a.organization_id, a.university_name, a.campus_name, a.status
  from smartgov.sessions s
  join smartgov.accounts a on a.id = s.account_id
  where s.token_hash = smartgov.sha256(p_token)
     and s.expires_at > now()
     and a.status = 'active';
end;
$$;

-- Resolves a session token to the caller's *full* account row.
--
-- `resolve_account` projects a narrow column list for API responses, and that
-- projection must never be assigned straight into an `accounts` rowtype:
-- plpgsql's `select * into` maps by position, not by name, so the 9th
-- projected value would land in the wrong attribute. This helper returns the
-- row in true table order, which makes `select * into` safe.
create or replace function smartgov.authenticate(p_token text)
returns smartgov.accounts
language plpgsql
security definer
set search_path = public, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
begin
  update smartgov.sessions s
     set last_seen_at = now()
   where s.token_hash = smartgov.sha256(p_token)
     and s.expires_at > now()
     and exists (
       select 1
       from smartgov.accounts a
       where a.id = s.account_id
         and a.status = 'active'
     );

  select a.* into v_account
  from smartgov.sessions s
  join smartgov.accounts a on a.id = s.account_id
  where s.token_hash = smartgov.sha256(p_token)
    and s.expires_at > now()
    and a.status = 'active';

  if not found then
    return null;
  end if;

  return v_account;
end;
$$;

-- ---------------------------------------------------------------- registration

-- Called by the `/create` flow once the organization exists. Owners are trusted
-- at this point and go straight to `active`; only invited accounts pass through
-- the OTP step. See `verify_otp`.
create or replace function smartgov.create_owner_account(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, smartgov, pg_temp
as $$
declare
  v_email     text := lower(trim(coalesce(p_payload->>'email', '')));
  v_password  text := coalesce(p_payload->>'password', '');
  v_name      text := trim(coalesce(p_payload->>'displayName', ''));
  v_kind      smartgov.account_kind;
  v_org_id    uuid;
  v_account_id uuid;
  v_raw_kind  text := coalesce(p_payload->>'accountKind', 'usg');
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

  if v_raw_kind = 'central' then
    v_kind := 'central';
  else
    v_kind := 'usg';
  end if;

  v_org_id := nullif(p_payload->>'organizationId', '')::uuid;

  if v_org_id is not null then
    -- Trust the organization record for the university's name, but only when
    -- the row actually exists.
    select o.id into v_org_id
    from public.organizations o
    where o.id = v_org_id;

    if not found then
      v_org_id := null;
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
    v_org_id, trim(coalesce(p_payload->>'universityName', '')),
    trim(coalesce(p_payload->>'campusName', '')), 'active', now()
  )
  returning id into v_account_id;

  return jsonb_build_object(
    'ok', true,
    'accountId', v_account_id,
    'email', v_email,
    'accountKind', v_kind
  );
exception
  when invalid_text_representation then
    return jsonb_build_object('ok', false, 'reason', 'invalid_organization');
end;
$$;

-- ---------------------------------------------------------------- login

-- Verifies the password and mints the session atomically. Returns the raw token
-- exactly once; only its SHA-256 is stored.
create or replace function smartgov.login_account(p_email text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_raw     text := encode(gen_random_bytes(32), 'hex');
begin
  if p_email is null or p_password is null or p_email = '' or p_password = '' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_credentials');
  end if;

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

create or replace function smartgov.delete_session(p_token text)
returns boolean
language plpgsql
security definer
set search_path = public, smartgov, pg_temp
as $$
begin
  if p_token is null or p_token = '' then
    return false;
  end if;
  delete from smartgov.sessions where token_hash = smartgov.sha256(p_token);
  return true;
end;
$$;

-- ---------------------------------------------------------------- invitations

-- Only an active owner may invite, and the organization is taken from the
-- caller's own account -- never from the request body. A pending invite for the
-- same address is revoked so the newest link always wins.
create or replace function smartgov.create_invite(
  p_session_token text,
  p_email          text,
  p_campus_name    text,
  p_unit_type      text
)
returns jsonb
language plpgsql
security definer
set search_path = public, smartgov, pg_temp
as $$
declare
  v_account  smartgov.accounts%rowtype;
  v_email    text := lower(trim(coalesce(p_email, '')));
  v_raw      text := encode(gen_random_bytes(24), 'hex');
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

-- Status feed for the dashboard: pending versus activated per address.
create or replace function smartgov.list_invites(p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_rows    jsonb;
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if v_account.account_scope <> 'owner' or v_account.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'id', i.id,
             'email', i.email,
             'campusName', i.campus_name,
             'unitType', i.unit_type,
             'status', i.status,
             'invitedBy', i.invited_by,
             'createdAt', i.created_at,
             'activatedAt', i.activated_at,
             'expiresAt', i.expires_at
           ) order by i.created_at desc
         ), '[]'::jsonb)
    into v_rows
  from smartgov.invites i
  where i.organization_id = v_account.organization_id
    and i.status <> 'revoked';

  return jsonb_build_object('ok', true, 'invites', v_rows);
end;
$$;

-- Step 1 of the invited flow. Validates the link, then creates the account in
-- `pending`. The campus and parent organization come from the invite row, so
-- the invitee never types them. `governance_model` decides which dashboard the
-- account lands on: federated -> usg, unitary -> central.
create or replace function smartgov.accept_invite(p_token text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public, smartgov, pg_temp
as $$
declare
  v_invite    smartgov.invites%rowtype;
  v_account   smartgov.accounts%rowtype;
  v_account_id uuid;
  v_kind      smartgov.account_kind;
  v_org_name  text;
  v_university text;
begin
  if p_token is null or p_token = '' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_invite');
  end if;

  if p_password is null or length(p_password) < 8 then
    return jsonb_build_object('ok', false, 'reason', 'weak_password');
  end if;

  select i.* into v_invite
  from smartgov.invites i
  where i.token_hash = smartgov.sha256(p_token)
    and i.status = 'pending'
    and i.expires_at > now();

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'invalid_invite');
  end if;

  if exists (select 1 from smartgov.accounts a where lower(a.email) = v_invite.email) then
    return jsonb_build_object('ok', false, 'reason', 'already_registered');
  end if;

  select case when o.governance_model = 'unitary'
              then 'central'::smartgov.account_kind
              else 'usg'::smartgov.account_kind
         end,
         coalesce(o.name, ''),
         coalesce(o.university_name, '')
    into v_kind, v_org_name, v_university
  from public.organizations o
  where o.id = v_invite.organization_id;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'invalid_invite');
  end if;

  insert into smartgov.accounts (
    email, password_hash, display_name, account_kind, account_scope,
    organization_id, university_name, campus_name, status
  )
  values (
    v_invite.email, smartgov.hash_password(p_password), v_invite.email,
    v_kind, 'invited', v_invite.organization_id, v_university,
    v_invite.campus_name, 'pending'
  )
  returning id into v_account_id;

  return jsonb_build_object(
    'ok', true,
    'accountId', v_account_id,
    'email', v_invite.email,
    'accountKind', v_kind,
    'campusName', v_invite.campus_name,
    'organizationName', v_org_name,
    'universityName', v_university
  );
end;
$$;

-- Read-only peek at a live invite, so a re-send can address the code without
-- touching the password. It creates nothing.
--
-- An account that is already live is reported as `already_registered` rather
-- than as an invalid invite, so someone returning to an old link is pointed at
-- sign-in instead of being told the link died.
create or replace function smartgov.accept_invite_probe(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, smartgov, pg_temp
as $$
declare
  v_invite    smartgov.invites%rowtype;
  v_org       text;
  v_university text;
begin
  if p_token is null or p_token = '' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_invite');
  end if;

  select i.* into v_invite
  from smartgov.invites i
  where i.token_hash = smartgov.sha256(p_token)
    and i.expires_at > now();

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'invalid_invite');
  end if;

  if exists (
    select 1
    from smartgov.accounts a
    where lower(a.email) = v_invite.email
      and a.organization_id = v_invite.organization_id
      and a.status = 'active'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'already_registered');
  end if;

  if v_invite.status <> 'pending' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_invite');
  end if;

  select coalesce(o.name, ''), coalesce(o.university_name, '')
    into v_org, v_university
  from public.organizations o
  where o.id = v_invite.organization_id;

  return jsonb_build_object(
    'ok', true,
    'email', v_invite.email,
    'campusName', v_invite.campus_name,
    'organizationName', v_org,
    'universityName', v_university
  );
end;
$$;

-- The six-digit code is generated in the application (it has to be emailed), so
-- the application stores an HMAC of it here. The plaintext never reaches the
-- database.
--
-- Takes the invite token rather than an account id, and resolves the account
-- from that invite, so only the holder of a live invite can plant a code. An
-- id-taking variant would let any caller overwrite the pending code on an
-- account they do not own.
create or replace function smartgov.set_otp(
  p_invite_token text,
  p_otp_hash     text,
  p_ttl_minutes  integer default 15
)
returns boolean
language plpgsql
security definer
set search_path = public, smartgov, pg_temp
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

  update smartgov.accounts a
     set otp_hash = p_otp_hash,
         otp_expires_at = now() + make_interval(mins => greatest(1, least(p_ttl_minutes, 60))),
         otp_attempts = 0
   where lower(a.email) = v_invite.email
     and a.organization_id = v_invite.organization_id
     and a.status = 'pending';

  return found;
end;
$$;

-- Step 2 of the invited flow.
--
-- Bound to the invite token rather than an account id on purpose. An account id
-- is a uuid, which is enumerable in bulk; the invite token is 24 random bytes
-- and already sits in the recipient's own URL, so it is the only secret they
-- actually hold. Accepting an id here would let a caller aim code guesses at an
-- arbitrary account.
--
-- Five wrong codes stops further attempts rather than allowing an unbounded
-- guess.
create or replace function smartgov.verify_otp(p_invite_token text, p_code_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public, smartgov, pg_temp
as $$
declare
  v_invite  smartgov.invites%rowtype;
  v_account smartgov.accounts%rowtype;
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
     set status = 'active',
         activated_at = now(),
         otp_hash = null,
         otp_expires_at = null,
         otp_attempts = 0
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

-- The welcome letter's context, without claiming it.
--
-- Deliberately separate from `mark_welcome_sent`: the caller sends the mail
-- first and only records the claim afterwards. Marking first would let a
-- transport failure silently consume the letter -- `welcome_sent_at` would be
-- set, `welcomeDue` would go false, and the note could never be retried.
create or replace function smartgov.welcome_context(p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_org    text;
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  select coalesce(o.name, '') into v_org
  from public.organizations o
  where o.id = v_account.organization_id;

  return jsonb_build_object(
    'ok', true,
    'due', (v_account.account_scope = 'invited' and v_account.welcome_sent_at is null),
    'email', v_account.email,
    'displayName', v_account.display_name,
    'campusName', v_account.campus_name,
    'universityName', v_account.university_name,
    'accountKind', v_account.account_kind,
    'organizationName', v_org
  );
end;
$$;

-- Records that the welcome letter went out. Call only once the mail has
-- actually been handed to the transport; a failed send must leave the account
-- unclaimed so the next sign-in retries. The `welcome_sent_at is null` guard
-- makes a duplicate call a no-op.
create or replace function smartgov.mark_welcome_sent(p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_org    text;
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  update smartgov.accounts
     set welcome_sent_at = now()
   where id = v_account.id
     and welcome_sent_at is null;

  select coalesce(o.name, '') into v_org
  from public.organizations o
  where o.id = v_account.organization_id;

  return jsonb_build_object(
    'ok', true,
    'email', v_account.email,
    'displayName', v_account.display_name,
    'campusName', v_account.campus_name,
    'universityName', v_account.university_name,
    'accountKind', v_account.account_kind,
    'organizationName', v_org
  );
end;
$$;

-- Everything the dashboard header needs in one call: the account, the
-- organization it belongs to, and the invitation tallies. Resolved from the
-- session token, so it can only ever describe the caller's own workspace.
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
    'activatedCount', v_active
  );
end;
$$;

-- ---------------------------------------------------------------- RLS

-- The tables are intentionally left policy-free. `anon` has no policy that
-- grants table access, so the SECURITY DEFINER functions above are the only
-- path in or out.
alter table smartgov.accounts enable row level security;
alter table smartgov.invites  enable row level security;
alter table smartgov.sessions enable row level security;

revoke all on all tables in schema smartgov from anon, authenticated;
revoke all on schema smartgov from anon, authenticated;

grant usage on schema smartgov to anon, authenticated;
grant execute on all functions in schema smartgov to anon, authenticated;

-- Invites that sat past their expiry report as expired on the next list call.
create or replace function smartgov.refresh_invite_status()
returns void
language sql
security definer
set search_path = public, smartgov, pg_temp
as $$
  update smartgov.invites
     set status = 'expired'
   where status = 'pending'
     and expires_at < now();
$$;

grant execute on function smartgov.refresh_invite_status() to anon, authenticated;
