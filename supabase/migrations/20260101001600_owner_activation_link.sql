-- Owner activation by emailed link.
--
-- The owner flow used to mail a six-digit code the registrant typed back on
-- the site. This replaces that with a magic link: the registration emails a
-- button that calls `activate_owner`, which activates the account and mints
-- the session in one step, so the click lands the owner on their dashboard.
--
-- A click cannot carry a password, so the verify token itself is the
-- credential. It is 24 random bytes, stored only as a hash, and was previously
-- the only way to drive the pending registration forward -- today it both
-- proves the registration belongs to the mailbox it was sent to and signs the
-- owner in.
--
-- Minting the session inside this function is deliberate. There is no separate
-- anon-callable `create_session`, because that would hand out a session for any
-- guessed account id; the only path in here is a live, still-hashed verification
-- token, which only the applicant's mailbox can supply.

create or replace function smartgov.activate_owner(p_verify_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_raw     text := encode(gen_random_bytes(32), 'hex');
  v_org     text;
  v_univ    text;
begin
  if p_verify_token is null or p_verify_token = '' then
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

  update smartgov.accounts
     set status            = 'active',
         activated_at      = now(),
         otp_hash          = null,
         otp_expires_at    = null,
         otp_attempts      = 0,
         otp_resends       = 0,
         otp_last_sent_at  = null,
         verify_token_hash = null
   where id = v_account.id;

  insert into smartgov.sessions (account_id, token_hash, expires_at)
  values (v_account.id, smartgov.sha256(v_raw), now() + interval '30 days');

  select coalesce(o.name, ''), coalesce(o.university_name, '')
    into v_org, v_univ
  from public.organizations o
  where o.id = v_account.organization_id;

  return jsonb_build_object(
    'ok', true,
    'alreadyActive', false,
    'token', v_raw,
    'email', v_account.email,
    'displayName', v_account.display_name,
    'accountKind', v_account.account_kind,
    'organizationName', v_org,
    'universityName', v_univ,
    'campusName', v_account.campus_name
  );
exception
  when others then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
end;
$$;

revoke all on function smartgov.activate_owner(text) from public;

-- Resend gate for the activation email, so someone who lost the first mail can
-- ask for another without the mailbox being used as an amplifier. It reuses the
-- `otp_resends` / `otp_last_sent_at` columns as the shared send budget; the
-- names are historical, the roles have not changed.
create or replace function smartgov.owner_send_activation(p_verify_token text)
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
    return jsonb_build_object('ok', true, 'alreadyActive', true);
  end if;

  if v_account.status <> 'pending' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  if v_account.otp_resends >= 5 then
    return jsonb_build_object('ok', false, 'reason', 'too_many_attempts');
  end if;

  if v_account.otp_last_sent_at is not null
     and v_account.otp_last_sent_at > now() - interval '2 minutes' then
    return jsonb_build_object('ok', true, 'cooldown');
  end if;

  update smartgov.accounts
     set otp_resends      = otp_resends + 1,
         otp_last_sent_at = now()
   where id = v_account.id;

  select coalesce(o.name, ''), coalesce(o.university_name, '')
    into v_org, v_univ
  from public.organizations o
  where o.id = v_account.organization_id;

  return jsonb_build_object(
    'ok', true,
    'email', v_account.email,
    'organizationName', v_org,
    'universityName', v_univ,
    'campusName', v_account.campus_name
  );
end;
$$;

revoke all on function smartgov.owner_send_activation(text) from public;

-- ------------------------------------------------------- public wrappers

create or replace function public.activate_owner(p_verify_token text)
returns jsonb
language sql
security definer
set search_path = public, smartgov, pg_temp
as $$ select smartgov.activate_owner(p_verify_token); $$;

revoke all on function public.activate_owner(text) from public;
grant execute on function public.activate_owner(text)              to anon, authenticated;

create or replace function public.owner_send_activation(p_verify_token text)
returns jsonb
language sql
security definer
set search_path = public, smartgov, pg_temp
as $$ select smartgov.owner_send_activation(p_verify_token); $$;

revoke all on function public.owner_send_activation(text) from public;
grant execute on function public.owner_send_activation(text)      to anon, authenticated;