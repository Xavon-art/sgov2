-- Password recovery for accounts that already hold a password.
--
-- The two earlier OTP flows (invite activation, owner registration approval)
-- are keyed on a raw token only the intended mailbox ever sees, so the server
-- records the token's hash and the account is found through it. A password
-- reset cannot do that: the requester shares only an email address, so the
-- reset state must be stored on the account itself.
--
-- Flow:
--
--   forgot     -> begin_password_reset(email, hmac(code)) creates (or refreshes)
--                 an active reset row and returns true only when an `active`
--                 account with that email exists. The route mints the code and
--                 sends the email only on success, then answers identically
--                 either way so the endpoint cannot probe for registered
--                 addresses.
--   reset      -> complete_password_reset(email, hmac(code), new_password):
--                   wrong code -> attempts left, five per code
--                   right code -> password_hash replaced, every session revoked,
--                                 reset row completed
--
-- There is deliberately no `set search_path` relaxation and no policy here:
-- `password_resets` is RLS-enabled with zero policies, and both writes are
-- `security definer`, exactly like the tables and functions around them.

-- ---------------------------------------------------------------- table

create table if not exists smartgov.password_resets (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references smartgov.accounts (id) on delete cascade,
  otp_hash         text,
  otp_expires_at   timestamptz,
  otp_attempts     smallint not null default 0,
  otp_resends      integer  not null default 0,
  otp_last_sent_at timestamptz,
  created_at       timestamptz not null default now(),
  completed_at     timestamptz
);

alter table smartgov.password_resets enable row level security;

-- One live reset per account: the flow is sequential, so a second request
-- refreshes the existing row rather than stacking a second one.
create unique index if not exists password_resets_one_active_per_account
  on smartgov.password_resets (account_id)
  where completed_at is null;

create index if not exists password_resets_account_idx
  on smartgov.password_resets (account_id);

-- ---------------------------------------------------------------- begin

-- Creates or refreshes the active reset row for an `active` account. Returns
-- false when no such account exists, which is the caller's signal to say "we
-- have emailed a code if an account exists" without ever minting or sending.
create or replace function smartgov.begin_password_reset(
  p_email          text,
  p_otp_hash       text,
  p_ttl_minutes    integer default 15
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_reset   smartgov.password_resets%rowtype;
begin
  if p_email is null or p_email = ''
     or p_otp_hash is null or p_otp_hash = '' then
    return false;
  end if;

  select a.* into v_account
  from smartgov.accounts a
  where lower(a.email) = lower(trim(p_email))
    and a.status = 'active';

  if not found then
    return false;
  end if;

  select r.* into v_reset
  from smartgov.password_resets r
  where r.account_id = v_account.id
    and r.completed_at is null
  for update;

  if not found then
    -- A brand-new recovery: a fresh row carries a fresh resend budget.
    insert into smartgov.password_resets (
      account_id, otp_hash, otp_expires_at
    )
    values (
      v_account.id, p_otp_hash,
      now() + make_interval(mins => greatest(1, least(p_ttl_minutes, 60)))
    );
    return true;
  end if;

  -- A row older than its own window no longer counts against the budget: the
  -- old code has lapsed, so re-minting for it is not an amplifier. A live row
  -- is capped at five sends for its lifetime and spaced two minutes apart,
  -- mirroring `set_otp`.
  if v_reset.otp_expires_at < now() then
    update smartgov.password_resets
       set otp_hash         = p_otp_hash,
           otp_expires_at   = now() + make_interval(mins => greatest(1, least(p_ttl_minutes, 60))),
           otp_attempts     = 0,
           otp_resends      = otp_resends + 1,
           otp_last_sent_at = now()
     where id = v_reset.id;
    return true;
  end if;

  if v_reset.otp_resends >= 5 then
    return false;
  end if;

  if v_reset.otp_last_sent_at is not null
     and v_reset.otp_last_sent_at > now() - interval '2 minutes' then
    return false;
  end if;

  update smartgov.password_resets
     set otp_hash         = p_otp_hash,
         otp_expires_at   = now() + make_interval(mins => greatest(1, least(p_ttl_minutes, 60))),
         otp_attempts     = 0,
         otp_resends      = otp_resends + 1,
         otp_last_sent_at = now()
   where id = v_reset.id;

  return found;
end;
$$;

revoke all on function smartgov.begin_password_reset(text, text, integer) from public;

-- ---------------------------------------------------------------- complete

-- Changes the password on a correct code and revokes every session. The new
-- password is hashed inside the function (`accept_invite` does the same), so
-- the plaintext exists only on the wire to this function and is never written.
create or replace function smartgov.complete_password_reset(
  p_email         text,
  p_code_hash     text,
  p_new_password  text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_reset   smartgov.password_resets%rowtype;
  v_key     text;
begin
  if p_email is null or p_email = ''
     or p_code_hash is null or p_code_hash = ''
     or p_new_password is null or length(p_new_password) < 8 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  select a.* into v_account
  from smartgov.accounts a
  where lower(a.email) = lower(trim(p_email))
    and a.status = 'active'
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  select r.* into v_reset
  from smartgov.password_resets r
  where r.account_id = v_account.id
    and r.completed_at is null
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  v_key := 'password-reset:verify:' || v_account.id::text;

  if not smartgov.consume_rate_limit(v_key, 20, interval '15 minutes') then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  if v_reset.otp_hash is null or v_reset.otp_expires_at is null
     or v_reset.otp_expires_at < now() then
    return jsonb_build_object('ok', false, 'reason', 'otp_expired');
  end if;

  if v_reset.otp_attempts >= 5 then
    return jsonb_build_object('ok', false, 'reason', 'too_many_attempts');
  end if;

  if v_reset.otp_hash <> p_code_hash then
    update smartgov.password_resets
       set otp_attempts = otp_attempts + 1
     where id = v_reset.id;

    return jsonb_build_object(
      'ok', false,
      'reason', 'otp_mismatch',
      'attemptsLeft', greatest(0, 5 - (v_reset.otp_attempts + 1)::int)
    );
  end if;

  -- The password actually changes and every existing session dies in the same
  -- update; a replayed visit to this function finds `completed_at` set and
  -- answers `invalid_request`.
  update smartgov.accounts a
     set password_hash = smartgov.hash_password(p_new_password)
   where a.id = v_account.id;

  delete from smartgov.sessions s
   where s.account_id = v_account.id;

  update smartgov.password_resets
     set otp_hash         = null,
         otp_expires_at   = null,
         otp_attempts     = 0,
         otp_last_sent_at = null,
         completed_at     = now()
   where id = v_reset.id;

  return jsonb_build_object(
    'ok', true,
    'email', v_account.email,
    'displayName', v_account.display_name
  );
end;
$$;

revoke all on function smartgov.complete_password_reset(text, text, text) from public;

-- ---------------------------------------------------------------- PostgREST surface

create or replace function public.begin_password_reset(
  p_email         text,
  p_otp_hash      text,
  p_ttl_minutes   integer default 15
)
returns boolean
language sql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.begin_password_reset(p_email, p_otp_hash, p_ttl_minutes); $$;

revoke all on function public.begin_password_reset(text, text, integer) from public;

create or replace function public.complete_password_reset(
  p_email         text,
  p_code_hash     text,
  p_new_password  text
)
returns jsonb
language sql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.complete_password_reset(p_email, p_code_hash, p_new_password); $$;

revoke all on function public.complete_password_reset(text, text, text) from public;

grant execute on function public.begin_password_reset(text, text, integer) to anon, authenticated;
grant execute on function public.complete_password_reset(text, text, text)   to anon, authenticated;