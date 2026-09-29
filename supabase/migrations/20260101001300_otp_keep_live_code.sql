-- OTP codes now keep their full lifetime.
--
-- Before this migration, every mint function replaced an *active* code as soon
-- as the two-minute cooldown had passed. A person who asked for a fresh code
-- (or simply re-submitted the recovery form) silently retired the code sitting
-- in their inbox, so the "correct" code they were reading was rejected by the
-- verifier a moment later. The client also offered a resend after thirty
-- seconds against a server that had no reason to refuse it, so codes could be
-- churned far faster than the fifteen minutes users were promised.
--
-- Each mint now refuses to touch a code that is still usable -- live (not
-- expired) and not yet burned through its five attempts -- and only mints a
-- fresh one when the previous code has expired, been exhausted, or never
-- existed. A denied send no longer looks like a successful one: the routes
-- surface `code: "resend_denied"` so the UI stops claiming "a new code is on
-- its way" when nothing was mailed.

-- ---------------------------------------------------------------- begin_password_reset

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

  -- An active code is never replaced: overwriting it would break the code
  -- already sitting in the person's inbox the moment they ask for a fresh one.
  -- Only a retired code -- expired, or spent through its five guess attempts --
  -- is replaced.
  if v_reset.otp_hash is not null
     and v_reset.otp_expires_at is not null
     and v_reset.otp_expires_at >= now()
     and v_reset.otp_attempts < 5 then
    return false;
  end if;

  -- Lifetime ceiling of five sends on the active row, and a two-minute gap
  -- between them, so the mailbox is not used as an amplifier.
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

-- ---------------------------------------------------------------- set_otp

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
  v_invite  smartgov.invites%rowtype;
  v_account smartgov.accounts%rowtype;
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

  select a.* into v_account
  from smartgov.accounts a
  where lower(a.email) = v_invite.email
    and a.organization_id = v_invite.organization_id
    and a.status = 'pending';

  if not found then
    return false;
  end if;

  -- Same rule as the reset flow: a usable code is never replaced, so the code
  -- the invitee is reading stays good for its full window. A retired one
  -- (expired, or five attempts spent) is replaced with a fresh code.
  if v_account.otp_hash is not null
     and v_account.otp_expires_at is not null
     and v_account.otp_expires_at >= now()
     and v_account.otp_attempts < 5 then
    return false;
  end if;

  if v_invite.otp_resends >= 5 then
    return false;
  end if;

  if v_invite.otp_last_sent_at is not null
     and v_invite.otp_last_sent_at > now() - interval '2 minutes' then
    return false;
  end if;

  update smartgov.invites
     set otp_resends      = otp_resends + 1,
         otp_last_sent_at = now()
   where id = v_invite.id;

  update smartgov.accounts a
     set otp_hash       = p_otp_hash,
         otp_expires_at = now() + make_interval(mins => greatest(1, least(p_ttl_minutes, 60))),
         otp_attempts   = 0
   where lower(a.email) = v_invite.email
     and a.organization_id = v_invite.organization_id
     and a.status = 'pending';

  return found;
end;
$$;

revoke all on function smartgov.set_otp(text, text, integer) from public;

-- ---------------------------------------------------------------- set_owner_otp

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

  -- Same rule as the two mints above: never replace a usable code.
  if v_account.otp_hash is not null
     and v_account.otp_expires_at is not null
     and v_account.otp_expires_at >= now()
     and v_account.otp_attempts < 5 then
    return false;
  end if;

  if v_account.otp_resends >= 5 then
    return false;
  end if;

  if v_account.otp_last_sent_at is not null
     and v_account.otp_last_sent_at > now() - interval '2 minutes' then
    return false;
  end if;

  update smartgov.accounts
     set otp_hash         = p_otp_hash,
         otp_expires_at   = now() + make_interval(mins => greatest(1, least(p_ttl_minutes, 60))),
         otp_attempts     = 0,
         otp_resends      = otp_resends + 1,
         otp_last_sent_at = now()
   where id = v_account.id;

  return found;
end;
$$;

revoke all on function smartgov.set_owner_otp(text, text, integer) from public;

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
grant execute on function public.begin_password_reset(text, text, integer) to anon, authenticated;

create or replace function public.set_otp(
  p_invite_token text,
  p_otp_hash     text,
  p_ttl_minutes  integer
)
returns boolean
language sql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.set_otp(p_invite_token, p_otp_hash, p_ttl_minutes); $$;

revoke all on function public.set_otp(text, text, integer) from public;
grant execute on function public.set_otp(text, text, integer) to anon, authenticated;

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
grant execute on function public.set_owner_otp(text, text, integer) to anon, authenticated;