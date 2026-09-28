-- Invite a roster member straight into a seat.
--
-- The invite path is extended rather than forked. There is already a reviewed,
-- rate-limited, mailed, OTP-gated flow for "get this person into the
-- organization", and a second one for "get this person into a seat" would mean
-- two sets of mail templates, two rate-limit budgets, and two ways for a
-- partially completed flow to leave rows behind.
--
-- So the seat is filled at invite time, in the same transaction that mints the
-- invite. Accepting the invite then has exactly one job left -- link the new
-- account to the roster row -- and "invite a person into a seat" is one action
-- that either fully happens or does not, rather than two that can half-fail
-- with an invite sent and an empty seat.
--
-- The membership is written here rather than on activation for a second
-- reason: the roster row is the thing that has to survive a person who never
-- accepts. A council officer who is emailed an invite and ignores it still
-- occupies the seat, which is what the org chart should say.

-- ---------------------------------------------------------------- invite shape

-- Nullable, because an invite into the organization at large is still a thing
-- the dashboard does. `on delete cascade` so removing a unit or a position
-- takes its pending invitations with it rather than leaving invitations for a
-- seat that no longer exists.
alter table smartgov.invites
  add column if not exists unit_id uuid references public.governance_units (id) on delete cascade;
alter table smartgov.invites
  add column if not exists position_id uuid references smartgov.org_positions (id) on delete cascade;

-- Postgres treats added parameters as a new signature, so the four-argument form
-- has to go rather than be left alongside. Left in place it would be a live
-- overload that fills a seat nobody asked to be filled; the `public` wrapper
-- exists for the same reason.
drop function if exists smartgov.create_invite(text, text, text, text);
drop function if exists public.create_invite(text, text, text, text);

-- ---------------------------------------------------------------- create

create or replace function smartgov.create_invite(
  p_session_token text,
  p_email         text,
  p_campus_name   text,
  p_unit_type     text,
  p_unit_id       uuid default null,
  p_position_id   uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account       smartgov.accounts%rowtype;
  v_email         text := lower(trim(coalesce(p_email, '')));
  v_raw           text := encode(extensions.gen_random_bytes(24), 'hex');
  v_unit          public.unit_type := 'lsg';
  v_invite_id     uuid;
  v_org_name      text;
  v_roster_id     uuid;
  v_membership_id uuid;
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
  -- one organization spamming a single inbox. The session ceiling is also what
  -- bounds filling a council in one sitting -- a university with 24 units is
  -- 24 to 72 officers, so the endpoint that mints them must not be able to mint
  -- them without limit.
  if not smartgov.consume_rate_limit(
       'invite:session:' || v_account.id::text, 30, interval '1 hour')
     or not smartgov.consume_rate_limit(
       'invite:email:' || v_email, 5, interval '1 hour') then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  if exists (select 1 from smartgov.accounts a where lower(a.email) = v_email) then
    return jsonb_build_object('ok', false, 'reason', 'already_registered');
  end if;

  -- `department` joins the list for the same reason 00500 added the enum value:
  -- a department's Local Student Government is a department.
  if p_unit_type in ('lsg', 'college', 'campus', 'council', 'department') then
    v_unit := p_unit_type::public.unit_type;
  end if;

  -- One without the other is not a seat, it is half a request, and guessing
  -- which half the caller meant would be worse than asking.
  if (p_unit_id is null and p_position_id is not null)
     or (p_unit_id is not null and p_position_id is null) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  if p_unit_id is not null then
    -- Every id is checked against the caller's own organization before it is
    -- used. Without this an owner could hold a seat in a council they do not
    -- belong to, and could mail invitations naming units of another
    -- organization.
    if not exists (
      select 1
      from public.governance_units gu
      where gu.id = p_unit_id
        and gu.organization_id = v_account.organization_id
    ) or not exists (
      select 1
      from smartgov.org_positions op
      where op.id = p_position_id
        and op.organization_id = v_account.organization_id
    ) then
      return jsonb_build_object('ok', false, 'reason', 'not_found');
    end if;

    if not exists (
      select 1
      from smartgov.unit_positions up
      where up.unit_id = p_unit_id
        and up.position_id = p_position_id
    ) then
      return jsonb_build_object('ok', false, 'reason', 'seat_not_enabled');
    end if;

    if exists (
      select 1
      from smartgov.unit_memberships m
      where m.unit_id = p_unit_id
        and m.position_id = p_position_id
        and m.end_date is null
    ) then
      return jsonb_build_object('ok', false, 'reason', 'seat_occupied');
    end if;
  end if;

  update smartgov.invites
     set status = 'revoked'
   where organization_id = v_account.organization_id
     and lower(email) = v_email
     and status = 'pending';

  insert into smartgov.invites (
    organization_id, email, campus_name, unit_type, unit_id, position_id,
    token_hash, invited_by, expires_at
  )
  values (
    v_account.organization_id, v_email, trim(coalesce(p_campus_name, '')),
    v_unit, p_unit_id, p_position_id,
    smartgov.sha256(v_raw), v_account.display_name, now() + interval '14 days'
  )
  returning id into v_invite_id;

  if p_unit_id is not null then
    -- The roster row carries the email as its display name until the person
    -- registers and the account supplies a real one, which is the same
    -- placeholder `accept_invite` already uses for `display_name`. Re-inviting
    -- someone returns the row that is already there, and deliberately does not
    -- overwrite a name a human has since corrected.
    insert into smartgov.roster (organization_id, full_name, email)
    values (v_account.organization_id, v_email, v_email)
    on conflict (organization_id, lower(email)) do update
      set email = excluded.email
    returning id into v_roster_id;

    insert into smartgov.unit_memberships (roster_id, unit_id, position_id)
    values (v_roster_id, p_unit_id, p_position_id)
    returning id into v_membership_id;
  end if;

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
    'rosterId', v_roster_id,
    'membershipId', v_membership_id,
    'expiresAt', (now() + interval '14 days')
  );
exception
  -- Only reachable when a concurrent call took the same seat, or when this
  -- person already holds a different seat in this unit -- the two partial
  -- indexes on `unit_memberships`. One reason covers both because the caller
  -- only needs to know the assignment did not take and should re-read the chart.
  -- The rollback also takes the invite and the roster row with it, which is the
  -- point: an invite that names a seat nobody got is worse than no invite. It
  -- also refunds this call's rate-limit charge, which is why the occupied case is
  -- refused by the pre-check above instead of by this handler: reaching here
  -- needs a genuine race, and a caller cannot farm it.
  when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'seat_occupied');
end;
$$;

revoke all on function smartgov.create_invite(text, text, text, text, uuid, uuid) from public;

-- ---------------------------------------------------------------- accept

-- Same signature as 002, which is the only place it is defined; 003 did not
-- replace it. Two changes: the roster row is linked to the account that has just
-- been created, and `search_path` names `extensions` like everything written
-- since 003.
create or replace function smartgov.accept_invite(p_token text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_invite     smartgov.invites%rowtype;
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

  -- The seat was filled when the invite was minted, so this is the whole of what
  -- accepting has to do about the org chart: the membership exists, is active,
  -- and does not move. Keyed on the address within the invite's organization
  -- rather than on the invite's own id, so an invite into the organization at
  -- large still links a roster row somebody added by hand -- the person did
  -- just register, and that is true however they arrived.
  update smartgov.roster
     set account_id = v_account_id
   where organization_id = v_invite.organization_id
     and lower(email) = lower(v_invite.email);

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

revoke all on function smartgov.accept_invite(text, text) from public;

-- ---------------------------------------------------------------- PostgREST surface

-- `public.create_invite` is replaced rather than added to, because the four
-- argument overload was dropped above and this is what the browser reaches for.
-- The trailing arguments keep their defaults so the dashboard's existing
-- organization-wide invite -- which sends four named arguments -- keeps working
-- against a six-argument function.
create or replace function public.create_invite(
  p_session_token text,
  p_email         text,
  p_campus_name   text,
  p_unit_type     text,
  p_unit_id       uuid default null,
  p_position_id   uuid default null
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
  select smartgov.create_invite(
    p_session_token, p_email, p_campus_name, p_unit_type, p_unit_id, p_position_id
  );
$$;

revoke all on function public.create_invite(text, text, text, text, uuid, uuid) from public;
grant execute on function public.create_invite(text, text, text, text, uuid, uuid) to anon, authenticated;

-- `public.accept_invite` needs no change: its signature is the same two
-- arguments and a forwarder has nothing to forward differently. The new
-- behaviour is entirely inside the `smartgov` original.
