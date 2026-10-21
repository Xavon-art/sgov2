-- 03040 -- Officer deactivation and handover.
--
-- An owner retires a USG officer from /usg/manage. The account is suspended,
-- not deleted, so the officer's authored history -- proposals, reviews, tasks,
-- budget requests -- survives and stays attributable. The seat is handed over
-- rather than emptied: the owner names a replacement, the successor accepts an
-- invite, and the successor takes over the *same account row*, and therefore
-- the same seat, memberships and history, under their own email and password.
-- A separate purge path deletes the account outright for the cases where the
-- person, not merely the seat, has to go.
--
-- This migration also re-declares accept_invite to grow the handover branch.
-- The branch cannot live in 00900, where accept_invite was last written: 00900
-- runs before the handover_account_id column this file adds, so a body that
-- reads it there would fail to compile. The signature is unchanged, so the
-- public forwarder and its grant from 00300 still point here.
--
-- Everything is `add column if not exists` / `create or replace`, so the file
-- may be re-applied without disturbing an existing database.

-- ---------------------------------------------------------------------------
-- 1. Audit columns on accounts.
--
-- `deactivated_email` is captured because handover swaps the row's email to the
-- successor's, which would otherwise leave the departing officer's address only
-- in the mail log. `deactivated_by` is `on delete set null` so that purging the
-- acting owner later does not cascade into the records it stamped.
-- ---------------------------------------------------------------------------
alter table smartgov.accounts add column if not exists deactivated_by uuid references smartgov.accounts (id) on delete set null;
alter table smartgov.accounts add column if not exists deactivated_at timestamptz;
alter table smartgov.accounts add column if not exists deactivation_reason text;
alter table smartgov.accounts add column if not exists deactivated_email text;

-- ---------------------------------------------------------------------------
-- 2. Handover flag on invites.
--
-- When set, the invite is not a request to create an account: it is a handover
-- link against the named account. `on delete cascade` because deleting the
-- account a pending handover points at should take the now-meaningless invite
-- with it rather than leave a link that can never resolve.
-- ---------------------------------------------------------------------------
alter table smartgov.invites add column if not exists handover_account_id uuid references smartgov.accounts (id) on delete cascade;

-- ---------------------------------------------------------------------------
-- 3. RPC: list_officers
--    The owner reads every non-owner usg account in their organization: email,
--    display name, status, the live seat reached through the roster row, and
--    the deactivation audit fields. Scoped to the caller's organization in SQL,
--    the same way unit_chart scopes a chart.
-- ---------------------------------------------------------------------------
create or replace function smartgov.list_officers(p_session_token text)
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

  if v_account.account_scope <> 'owner' then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if v_account.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;

  return jsonb_build_object(
    'ok', true,
    'officers', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', a.id,
          'email', a.email,
          'displayName', a.display_name,
          'status', a.status,
          'statusLabel', case
            when a.deactivated_at is not null then 'deactivated'
            when a.status = 'pending' then 'invited'
            else 'active'
          end,
          'deactivatedAt', a.deactivated_at,
          'deactivationReason', a.deactivation_reason,
          'deactivatedEmail', a.deactivated_email,
          'seat', (
            select string_agg(distinct g.name, ', ' order by g.name)
            from smartgov.roster r
            join smartgov.unit_memberships m
              on m.roster_id = r.id and m.end_date is null
            join public.governance_units g on g.id = m.unit_id
            where r.account_id = a.id
          )
        )
        order by a.status asc, a.display_name nulls last, a.email
      )
      from smartgov.accounts a
      where a.organization_id = v_account.organization_id
        and a.account_scope <> 'owner'
        and a.account_kind = 'usg'
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function smartgov.list_officers(text) from public;

-- ---------------------------------------------------------------------------
-- 4. RPC: deactivate_officer
--    Owner-gated. Suspends the target account, stamps the audit fields, revokes
--    any earlier pending handover for the same account, and -- when a
--    replacement address is named -- mints a handover invite for it. The
--    response carries the raw token; sending the mail is the caller's job, the
--    same division of labour every other invite in this schema follows.
-- ---------------------------------------------------------------------------
create or replace function smartgov.deactivate_officer(
  p_session_token     text,
  p_account_id        uuid,
  p_reason            text,
  p_replacement_email text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_owner    smartgov.accounts%rowtype;
  v_target   smartgov.accounts%rowtype;
  v_email    text := lower(trim(coalesce(p_replacement_email, '')));
  v_raw      text;
  v_org_name text;
begin
  v_owner := smartgov.authenticate(p_session_token);

  if v_owner.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if v_owner.account_scope <> 'owner' then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if v_owner.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;

  select * into v_target
  from smartgov.accounts
  where id = p_account_id
    and organization_id = v_owner.organization_id;

  if v_target.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  -- An owner cannot be retired this way, and neither can the caller retire
  -- themselves: the organization would lock itself out of its own console.
  if v_target.id = v_owner.id or v_target.account_scope = 'owner' then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  -- A named replacement has to be a usable address that is not already an
  -- account: handover re-points the target row's email at it, and two accounts
  -- cannot share an address.
  if v_email <> '' then
    if position('@' in v_email) = 0 then
      return jsonb_build_object('ok', false, 'reason', 'invalid_email');
    end if;

    if exists (select 1 from smartgov.accounts a where lower(a.email) = v_email) then
      return jsonb_build_object('ok', false, 'reason', 'replacement_registered');
    end if;

    -- Bounds one sitting's worth of handovers, the same shape create_invite
    -- uses to bound one sitting's worth of invitations.
    if not smartgov.consume_rate_limit(
         'deactivate:' || v_owner.id::text, 30, interval '1 hour') then
      return jsonb_build_object('ok', false, 'reason', 'rate_limited');
    end if;
  end if;

  update smartgov.accounts
     set status = 'suspended',
         deactivated_by = v_owner.id,
         deactivated_at = now(),
         deactivation_reason = p_reason,
         deactivated_email = v_target.email
   where id = v_target.id;

  -- Supersede any earlier handover for this account so a stale link cannot
  -- claim the seat after this one.
  update smartgov.invites
     set status = 'revoked'
   where handover_account_id = v_target.id
     and status = 'pending';

  if v_email <> '' then
    v_raw := encode(extensions.gen_random_bytes(24), 'hex');

    insert into smartgov.invites (
      organization_id, email, campus_name, unit_type, token_hash,
      invited_by, expires_at, handover_account_id
    )
    values (
      v_target.organization_id, v_email, v_target.campus_name, 'usg',
      smartgov.sha256(v_raw), v_owner.display_name, now() + interval '14 days',
      v_target.id
    );
  end if;

  select coalesce(o.name, '') into v_org_name
  from public.organizations o
  where o.id = v_target.organization_id;

  return jsonb_build_object(
    'ok', true,
    'accountId', v_target.id,
    'deactivatedEmail', v_target.email,
    'deactivatedName', v_target.display_name,
    'reason', p_reason,
    'replacementEmail', nullif(v_email, ''),
    'organizationName', v_org_name,
    'universityName', v_target.university_name,
    'campusName', v_target.campus_name,
    'handoverToken', v_raw,
    'expiresAt', case when v_raw is null then null else now() + interval '14 days' end
  );
end;
$$;

revoke all on function smartgov.deactivate_officer(text, uuid, text, text) from public;

-- ---------------------------------------------------------------------------
-- 5. RPC: purge_officer
--    The hard delete, for when the person -- not merely the seat -- has to go.
--    The account row is deleted last, which is what cascade does for sessions,
--    password resets and permissions, and what SET NULL does for the verdicts
--    and audit stamps on other people's rows. Everything the target *authored*
--    is re-pointed at the acting owner rather than deleted: an officer leaving
--    is not a reason for the organization to lose its proposals, reviews or
--    tasks. Their roster row is deleted, which cascades the live memberships and
--    frees the seat -- purge and handover are opposites on exactly this point.
-- ---------------------------------------------------------------------------
create or replace function smartgov.purge_officer(
  p_session_token text,
  p_account_id    uuid,
  p_confirm_email text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_owner  smartgov.accounts%rowtype;
  v_target smartgov.accounts%rowtype;
  v_seats  integer;
begin
  v_owner := smartgov.authenticate(p_session_token);

  if v_owner.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if v_owner.account_scope <> 'owner' then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if v_owner.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;

  select * into v_target
  from smartgov.accounts
  where id = p_account_id
    and organization_id = v_owner.organization_id;

  if v_target.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if v_target.id = v_owner.id or v_target.account_scope = 'owner' then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  -- Typing the address back is the whole of the confirmation: a bare id is too
  -- easy to send by accident for an operation with no undo.
  if lower(trim(coalesce(p_confirm_email, ''))) <> lower(v_target.email) then
    return jsonb_build_object('ok', false, 'reason', 'confirm_mismatch');
  end if;

  select count(*)
    into v_seats
    from smartgov.unit_memberships m
    join smartgov.roster r on r.id = m.roster_id
   where r.account_id = v_target.id
     and m.end_date is null;

  -- Free the seats first: deleting the roster row cascades the memberships, and
  -- it has to happen while the account still identifies the row.
  delete from smartgov.roster where account_id = v_target.id;

  -- Re-point authored history at the acting owner. Every column below is NOT
  -- NULL and a plain reference to accounts, so a bare delete would be rejected
  -- by the foreign key -- and would take the organization's records with it if
  -- the key were cascade instead.
  update smartgov.programs                  set created_by   = v_owner.id where created_by   = v_target.id;
  update smartgov.proposals                 set created_by   = v_owner.id where created_by   = v_target.id;
  update smartgov.proposal_versions         set submitted_by = v_owner.id where submitted_by = v_target.id;
  update smartgov.proposal_requirements     set created_by   = v_owner.id where created_by   = v_target.id;
  update smartgov.reviews                   set decided_by   = v_owner.id where decided_by   = v_target.id;
  update smartgov.budget_requests           set requested_by = v_owner.id where requested_by = v_target.id;
  update smartgov.document_uploads          set uploaded_by  = v_owner.id where uploaded_by  = v_target.id;
  update smartgov.tasks                     set created_by   = v_owner.id where created_by   = v_target.id;
  update smartgov.submission_verifications  set verified_by  = v_owner.id where verified_by  = v_target.id;

  -- The account last: sessions, password resets and permissions cascade away,
  -- and the SET NULL references (decisions, grants, audit stamps) are cleared.
  delete from smartgov.accounts where id = v_target.id;

  return jsonb_build_object(
    'ok', true,
    'purgedEmail', v_target.email,
    'purgedName', v_target.display_name,
    'seatsFreed', v_seats
  );
end;
$$;

revoke all on function smartgov.purge_officer(text, uuid, text) from public;

-- ---------------------------------------------------------------------------
-- 6. Redeclare accept_invite with the handover branch.
--
-- The branch runs before the normal flow because a handover is not a new
-- account -- it is the target row adopting a new identity. The normal flow,
-- including the roster link, is unchanged. The 00300 grant to anon,
-- authenticated survives `create or replace`, so anonymous invite acceptance
-- keeps working.
-- ---------------------------------------------------------------------------
create or replace function smartgov.accept_invite(p_token text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_invite     smartgov.invites%rowtype;
  v_target     smartgov.accounts%rowtype;
  v_account_id uuid;
  v_kind       smartgov.account_kind;
  v_org_name   text;
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

  -- ----- handover -----
  -- The successor moves onto the suspended account instead of getting a new
  -- one, so the seat, memberships and history never change hands through a gap.
  if v_invite.handover_account_id is not null then
    select * into v_target
    from smartgov.accounts
    where id = v_invite.handover_account_id
      and organization_id = v_invite.organization_id;

    -- A missing target, a wrong organization, or an account that is neither
    -- suspended nor pending means the handover was superseded or tampered with.
    if v_target.id is null then
      return jsonb_build_object('ok', false, 'reason', 'invalid_invite');
    end if;

    if v_target.status not in ('suspended', 'pending') then
      return jsonb_build_object('ok', false, 'reason', 'invalid_invite');
    end if;

    -- The successor's address must not already be an account: the swap below
    -- would collide with it.
    if exists (
      select 1 from smartgov.accounts a
      where lower(a.email) = lower(v_invite.email)
        and a.id <> v_target.id
    ) then
      return jsonb_build_object('ok', false, 'reason', 'already_registered');
    end if;

    update smartgov.accounts
       set email = v_invite.email,
           password_hash = smartgov.hash_password(p_password),
           display_name = v_invite.email,
           status = 'pending',
           otp_hash = null,
           otp_expires_at = null,
           otp_attempts = 0
     where id = v_target.id;

    select coalesce(o.name, '') into v_org_name
    from public.organizations o
    where o.id = v_invite.organization_id;

    return jsonb_build_object(
      'ok', true,
      'accountId', v_target.id,
      'email', v_invite.email,
      'accountKind', v_target.account_kind,
      'campusName', v_target.campus_name,
      'organizationName', v_org_name,
      'universityName', v_target.university_name,
      'handover', true
    );
  end if;

  -- ----- normal -----
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
  -- accepting has to do about the org chart: link the roster row that is already
  -- there to the account that was just created.
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

-- ---------------------------------------------------------------------------
-- 7. PostgREST forwarders.
--    Thin wrappers only: every gate lives in the smartgov original, so a
--    wrapper cannot be looser than the logic it calls. The three are owner
--    endpoints but are granted the same way as the rest of the surface --
--    authenticate inside each function is what refuses a non-owner.
-- ---------------------------------------------------------------------------
create or replace function public.list_officers(p_session_token text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.list_officers(p_session_token); $$;

revoke all on function public.list_officers(text) from public;
grant execute on function public.list_officers(text) to anon, authenticated;

create or replace function public.deactivate_officer(
  p_session_token     text,
  p_account_id        uuid,
  p_reason            text,
  p_replacement_email text
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.deactivate_officer(p_session_token, p_account_id, p_reason, p_replacement_email); $$;

revoke all on function public.deactivate_officer(text, uuid, text, text) from public;
grant execute on function public.deactivate_officer(text, uuid, text, text) to anon, authenticated;

create or replace function public.purge_officer(
  p_session_token text,
  p_account_id    uuid,
  p_confirm_email text
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.purge_officer(p_session_token, p_account_id, p_confirm_email); $$;

revoke all on function public.purge_officer(text, uuid, text) from public;
grant execute on function public.purge_officer(text, uuid, text) to anon, authenticated;
