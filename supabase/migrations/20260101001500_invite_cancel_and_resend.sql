-- Owner dashboard actions for an invitation row: cancel and resend. Both are
-- owner-only and scoped to the caller's own organization, like every other
-- invite write -- the organization is read off the authenticated account and
-- never out of the request body, and the row is locked `for update` before it
-- is acted on, so a status that changes under the read cannot be acted on stale.
--
-- CANCEL (`revoke_invite`) has to kill more than the link. `accept_invite_probe`
-- refuses anything but `pending`, so flipping the status is enough to stop the
-- acceptance page. It is NOT enough to stop the activation: `verify_otp`
-- resolves the invite by `token_hash` and `expires_at` with no status filter,
-- and an invitee who was already mailed a code before the cancel could still
-- complete activation through the canceled link and land an active account in
-- the organization. So the cancellation also clears the stored OTP for that
-- signup, which leaves an already-mailed code with nothing to match against
-- (`set_otp` already refuses to mint a fresh code on a non-`pending` invite, so
-- this is the only path that needed closing).
--
-- RESEND (`resend_invite`) mints a fresh raw token and stores only its SHA-256,
-- so the previously mailed link is dead the moment the new welcome email goes
-- out. The row keeps its identity: the same invite id, the same email, the same
-- unit and seat, only the token and the expiry move. It is refused on an
-- `activated` invite (the person is already in) and on a `revoked` one (that is
-- a cancel, and the fix is to send a new invite), which is why the two actions
-- are not interchangeable on every row.

-- --------------------------------------------------------------- revoke

create or replace function smartgov.revoke_invite(
  p_session_token text,
  p_invite_id     uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_status  smartgov.invite_status;
  v_email   text;
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if v_account.account_scope <> 'owner' then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if not smartgov.consume_rate_limit(
       'invite:revoke:' || v_account.id::text, 60, interval '10 minutes') then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  -- `for update` because the status is read and then acted on: without the lock
  -- a concurrent `verify_otp` can commit `activated` between the read and the
  -- update below, and this would then revoke a row whose invitee is already in
  -- the organization. `accept_invite` is not the writer here -- it only creates
  -- the `pending` account.
  select i.status, i.email into v_status, v_email
    from smartgov.invites i
   where i.id = p_invite_id
     and i.organization_id = v_account.organization_id
   for update;

  if v_status is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if v_status = 'activated' then
    return jsonb_build_object('ok', false, 'reason', 'invite_activated');
  end if;

  if v_status <> 'revoked' then
    update smartgov.invites
       set status = 'revoked'
     where id = p_invite_id
       and organization_id = v_account.organization_id;
  end if;

  -- The gap `verify_otp` leaves open: it matches the invite by token hash
  -- alone, so a code mailed before the cancel would still activate the account.
  -- Clearing the stored OTP removes the only thing that code could match, and
  -- doing it unconditionally (not only on the transition) means a second cancel
  -- also sweeps up a code minted since. `a.status = 'pending'` is the same
  -- guard both OTP minters use (00200 `set_otp`, 00300 `set_otp`): only a
  -- pending account can be holding a verifiable code, and an `active` one has
  -- nothing left to protect.
  update smartgov.accounts a
     set otp_hash = null,
         otp_expires_at = null
   where lower(a.email) = v_email
     and a.organization_id = v_account.organization_id
     and a.status = 'pending';

  return jsonb_build_object('ok', true, 'inviteId', p_invite_id);
exception
  -- The only partner that inverts this order is `verify_otp` (00300), which
  -- takes `accounts` first and then writes this row. Both are retryable, so
  -- answer with a reason instead of a 500.
  when serialization_failure or deadlock_detected then
    return jsonb_build_object('ok', false, 'reason', 'retry');
end;
$$;

revoke all on function smartgov.revoke_invite(text, uuid) from public;

-- --------------------------------------------------------------- resend

create or replace function smartgov.resend_invite(
  p_session_token text,
  p_invite_id     uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account    smartgov.accounts%rowtype;
  v_status     smartgov.invite_status;
  v_email      text;
  v_campus     text;
  v_org_name   text;
  v_raw        text := encode(extensions.gen_random_bytes(24), 'hex');
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if v_account.account_scope <> 'owner' then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if not smartgov.consume_rate_limit(
       'invite:resend:' || v_account.id::text, 20, interval '10 minutes') then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  -- Locked for the same reason as in `revoke_invite`: the accepted/refused
  -- decision below is made from this read, so it has to be the current one.
  select i.status, i.email, i.campus_name into v_status, v_email, v_campus
    from smartgov.invites i
   where i.id = p_invite_id
     and i.organization_id = v_account.organization_id
   for update;

  if v_status is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if v_status = 'activated' then
    return jsonb_build_object('ok', false, 'reason', 'invite_activated');
  end if;

  if v_status = 'revoked' then
    return jsonb_build_object('ok', false, 'reason', 'invite_cancelled');
  end if;

  select o.name into v_org_name
    from public.organizations o
   where o.id = v_account.organization_id;

  update smartgov.invites
     set token_hash = smartgov.sha256(v_raw),
         status     = 'pending',
         expires_at = now() + interval '14 days'
   where id = p_invite_id
     and organization_id = v_account.organization_id;

  -- The raw token is returned once and never stored: the row keeps only its
  -- SHA-256, exactly as `create_invite` mints it, so a dump of the table is not
  -- a list of working invite links.
  return jsonb_build_object(
    'ok', true,
    'token', v_raw,
    'inviteId', p_invite_id,
    'email', v_email,
    'campusName', v_campus,
    'organizationName', v_org_name,
    'universityName', v_account.university_name
  );
end;
$$;

revoke all on function smartgov.resend_invite(text, uuid) from public;

-- ------------------------------------------------------ PostgREST surface

create or replace function public.revoke_invite(
  p_session_token text,
  p_invite_id     uuid
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
  select smartgov.revoke_invite(p_session_token, p_invite_id);
$$;

revoke all on function public.revoke_invite(text, uuid) from public;
grant execute on function public.revoke_invite(text, uuid) to anon, authenticated;

create or replace function public.resend_invite(
  p_session_token text,
  p_invite_id     uuid
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
  select smartgov.resend_invite(p_session_token, p_invite_id);
$$;

revoke all on function public.resend_invite(text, uuid) from public;
grant execute on function public.resend_invite(text, uuid) to anon, authenticated;
