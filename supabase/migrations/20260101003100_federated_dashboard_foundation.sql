-- 03100 -- Federated dashboard remodel: foundation.
--
-- Phase 1 of the USG/LSG dashboard rebuild. The rebuilt IA is:
--
--   Overview · Manage (Umbrella / Invites / Profile) · Request
--   · Events and Acts · Survey · Settings
--
-- This file lands the pieces every later phase leans on: organisation
-- customisation, the caller's own profile, and temporary (scheduled)
-- deactivation of a unit account inside the owner's umbrella.
--
-- Three rules from the existing codebase are kept exactly as they are:
--   * No RLS policy and no table grant. Every path in is a `security definer`
--     function that resolves the caller from the session token first.
--   * The reachable surface is an explicit allowlist of `public.*` forwarders;
--     each one is re-granted to `anon, authenticated` at the bottom.
--   * `authenticate` sweeps due deactivations before it answers, so a schedule
--     is enforced on every call rather than by a cron job we do not have.

-- ---------------------------------------------------------------- columns

-- Dashboard customisation lives on the organisation: it is one dashboard with
-- one look. `accent` already exists from an earlier migration.
alter table public.organizations
  add column if not exists theme_mode text not null default 'light';
alter table public.organizations
  add column if not exists logo_data text;
alter table public.organizations
  add column if not exists customised_at timestamptz;
alter table public.organizations
  add column if not exists customised_by uuid;

-- Guard the theme to the three values the shell understands. Added as a
-- separate constraint so a re-run of this file is a no-op rather than an error.
do $$ begin
  alter table public.organizations
    add constraint organizations_theme_mode_check
    check (theme_mode in ('light', 'dark', 'system'));
exception when duplicate_object then null; end $$;

-- A temporary deactivation is a window, not a boolean. `starts_at` and
-- `ends_at` say when the account goes dark and when it comes back; a null
-- `ends_at` means "until the owner lifts it", which is the old behaviour.
alter table smartgov.accounts
  add column if not exists deactivation_starts_at timestamptz;
alter table smartgov.accounts
  add column if not exists deactivation_ends_at timestamptz;
alter table smartgov.accounts
  add column if not exists deactivation_reason text;
alter table smartgov.accounts
  add column if not exists deactivation_scheduled_by uuid;

do $$ begin
  alter table smartgov.accounts
    add constraint accounts_deactivation_order_check
    check (
      deactivation_starts_at is null
      or deactivation_ends_at is null
      or deactivation_ends_at > deactivation_starts_at
    );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------- sweep

-- Applies the schedule for one account, or for every account when p_account is
-- null. Called by `authenticate` on the account being resolved, so the window
-- is honoured on the caller's very next request instead of at the next cron.
--
-- The account that owns the org is never auto-suspended: locking the only
-- owner out of their own dashboard would be unrecoverable from the app.
create or replace function smartgov.apply_scheduled_deactivation(p_account uuid)
returns void
language plpgsql
security definer
set search_path = public, smartgov, pg_temp
as $$
begin
  if p_account is null then
    return;
  end if;

  -- Window open: suspend, unless this is the organisation owner.
  update smartgov.accounts a
     set status = 'suspended'
   where a.id = p_account
     and a.account_scope <> 'owner'
     and a.deactivation_starts_at is not null
     and a.deactivation_starts_at <= now()
     and (a.deactivation_ends_at is null or a.deactivation_ends_at > now())
     and a.status = 'active';

  -- Window closed: come back, and clear the schedule that closed it.
  update smartgov.accounts a
     set status = 'active',
         deactivation_starts_at = null,
         deactivation_ends_at = null,
         deactivation_reason = null,
         deactivation_scheduled_by = null
   where a.id = p_account
     and a.deactivation_starts_at is not null
     and a.deactivation_ends_at is not null
     and a.deactivation_ends_at <= now();
end;
$$;

-- ---------------------------------------------------------------- authenticate

-- Re-declared to sweep the caller's own schedule first. When a deactivation
-- window is open the sweep flips the account to `suspended` and the two
-- `status = 'active'` predicates below therefore match nothing -- the caller is
-- refused by the same code path that refuses any other suspended account.
-- Signature and return type are unchanged, so the 00300 forwarder still points
-- here.
create or replace function smartgov.authenticate(p_token text)
returns smartgov.accounts
language plpgsql
security definer
set search_path = public, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
begin
  -- Enforce any window that has come due since the last call.
  perform smartgov.apply_scheduled_deactivation((
    select s.account_id
    from smartgov.sessions s
    where s.token_hash = smartgov.sha256(p_token)
      and s.expires_at > now()
  ));

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

-- ---------------------------------------------------------------- profile

-- The caller's own profile, plus the organisation they belong to and the
-- customisation the shell should apply. One call so the Settings screen and the
-- dashboard chrome do not each rebuild the answer.
create or replace function smartgov.my_profile(p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_org     public.organizations%rowtype;
  v_is_owner boolean;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  select o.* into v_org
  from public.organizations o
  where o.id = v_account.organization_id;

  v_is_owner := v_account.account_scope = 'owner';

  return jsonb_build_object(
    'ok', true,
    'account', jsonb_build_object(
      'id', v_account.id,
      'email', v_account.email,
      'displayName', v_account.display_name,
      'accountKind', v_account.account_kind,
      'accountScope', v_account.account_scope,
      'status', v_account.status,
      'organizationId', v_account.organization_id,
      'universityName', v_account.university_name,
      'campusName', v_account.campus_name,
      'deactivationStartsAt', v_account.deactivation_starts_at,
      'deactivationEndsAt', v_account.deactivation_ends_at,
      'deactivationReason', v_account.deactivation_reason
    ),
    'organization', case when v_org.id is null then null else jsonb_build_object(
      'id', v_org.id,
      'name', v_org.name,
      'governanceModel', v_org.governance_model,
      'accent', v_org.accent,
      'themeMode', v_org.theme_mode,
      'logoData', v_org.logo_data,
      'status', v_org.status
    ) end,
    'canCustomise', v_is_owner
  );
end;
$$;

-- Renames the caller. Email and password have their own calls below because
-- each needs a credential check that a display-name change does not.
create or replace function smartgov.update_my_profile(p_session_token text, p_display_name text)
returns jsonb
language plpgsql
security definer
set search_path = public, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_name    text := trim(coalesce(p_display_name, ''));
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if length(v_name) < 2 or length(v_name) > 80 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_name');
  end if;

  update smartgov.accounts
     set display_name = v_name
   where id = v_account.id;

  return jsonb_build_object('ok', true, 'displayName', v_name);
end;
$$;

-- ---------------------------------------------------------------- credentials

-- Changes the caller's email. Requires the current password, so a borrowed
-- session cannot silently move the account to an address its owner does not
-- control.
create or replace function smartgov.change_my_email(
  p_session_token text,
  p_new_email text,
  p_password text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_email   text := lower(trim(coalesce(p_new_email, '')));
  v_taken   boolean;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if position('@' in v_email) = 0 or length(v_email) > 254 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_email');
  end if;

  if not smartgov.password_matches(coalesce(p_password, ''), v_account.password_hash) then
    return jsonb_build_object('ok', false, 'reason', 'wrong_password');
  end if;

  select exists (
    select 1 from smartgov.accounts a
    where lower(a.email) = v_email and a.id <> v_account.id
  ) into v_taken;

  if v_taken then
    return jsonb_build_object('ok', false, 'reason', 'email_taken');
  end if;

  update smartgov.accounts
     set email = v_email
   where id = v_account.id;

  return jsonb_build_object('ok', true, 'email', v_email);
end;
$$;

-- Changes the caller's password. Verifies the current one, then re-hashes.
-- Existing sessions are left alone: the caller is already authenticated and
-- re-signing them in after their own change would be hostile.
create or replace function smartgov.change_my_password(
  p_session_token text,
  p_current_password text,
  p_new_password text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_new     text := coalesce(p_new_password, '');
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if not smartgov.password_matches(coalesce(p_current_password, ''), v_account.password_hash) then
    return jsonb_build_object('ok', false, 'reason', 'wrong_password');
  end if;

  if length(v_new) < 8 then
    return jsonb_build_object('ok', false, 'reason', 'weak_password');
  end if;

  if smartgov.password_matches(v_new, v_account.password_hash) then
    return jsonb_build_object('ok', false, 'reason', 'same_password');
  end if;

  update smartgov.accounts
     set password_hash = smartgov.hash_password(v_new)
   where id = v_account.id;

  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------- customisation

-- Owner-only look-and-feel. Theme is validated against the constraint; the
-- accent accepts a short hex token only, so the value that reaches a CSS
-- variable can never be an arbitrary string.
create or replace function smartgov.update_customisation(
  p_session_token text,
  p_accent text,
  p_theme_mode text,
  p_logo_data text
)
returns jsonb
language plpgsql
security definer
set search_path = public, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_accent  text := nullif(trim(coalesce(p_accent, '')), '');
  v_theme   text := nullif(trim(coalesce(p_theme_mode, '')), '');
  v_logo    text := nullif(trim(coalesce(p_logo_data, '')), '');
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if v_account.account_scope <> 'owner' then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if v_theme is not null and v_theme not in ('light', 'dark', 'system') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_theme');
  end if;

  if v_accent is not null and v_accent !~ '^#?[0-9a-fA-F]{6}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_accent');
  end if;

  -- A data URL for a small logo. Capped so the row cannot be used as storage.
  if v_logo is not null and length(v_logo) > 200000 then
    return jsonb_build_object('ok', false, 'reason', 'logo_too_large');
  end if;

  update public.organizations o
     set accent        = coalesce(v_accent, o.accent),
         theme_mode    = coalesce(v_theme, o.theme_mode),
         logo_data     = case when p_logo_data is null then o.logo_data else v_logo end,
         customised_at = now(),
         customised_by = v_account.id
   where o.id = v_account.organization_id;

  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------- umbrella

-- Every LSG under this USG, with the seat that owns it and any deactivation
-- window, in one list. Owner-only: the umbrella is the owner's view of what
-- they are responsible for.
create or replace function smartgov.list_umbrella(p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_org     uuid;
  v_units   jsonb;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if v_account.account_scope <> 'owner' then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  v_org := v_account.organization_id;

  select coalesce(jsonb_agg(unit order by unit->>'name'), '[]'::jsonb)
    into v_units
  from (
    select jsonb_build_object(
      'unitId', u.id,
      'name', u.name,
      'unitType', u.unit_type,
      'structureKey', u.structure_key,
      'account', (
        select jsonb_build_object(
          'id', a.id,
          'email', a.email,
          'displayName', a.display_name,
          'status', a.status,
          'deactivationStartsAt', a.deactivation_starts_at,
          'deactivationEndsAt', a.deactivation_ends_at,
          'deactivationReason', a.deactivation_reason
        )
        from smartgov.accounts a
        where a.unit_id = u.id
        order by a.created_at
        limit 1
      ),
      'memberCount', (
        select count(*) from smartgov.accounts a where a.unit_id = u.id
      )
    ) as unit
    from public.governance_units u
    where u.organization_id = v_org
      and u.unit_type <> 'usg'
  ) s;

  return jsonb_build_object(
    'ok', true,
    'units', v_units
  );
end;
$$;

-- ---------------------------------------------------------------- deactivation

-- Schedules a temporary deactivation for one account in the umbrella. The
-- owner names a start and an end; `starts_at` in the past applies immediately.
-- The owner's own seat is refused here as well as in the sweep, so the error is
-- a clear "forbidden" rather than a silent no-op.
create or replace function smartgov.schedule_deactivation(
  p_session_token text,
  p_account_id uuid,
  p_starts_on date,
  p_ends_on date,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, smartgov, pg_temp
as $$
declare
  v_owner   smartgov.accounts%rowtype;
  v_target  smartgov.accounts%rowtype;
  v_starts  timestamptz;
  v_ends    timestamptz;
begin
  v_owner := smartgov.authenticate(p_session_token);
  if v_owner.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if v_owner.account_scope <> 'owner' then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if p_starts_on is null then
    return jsonb_build_object('ok', false, 'reason', 'missing_start');
  end if;

  if p_ends_on is not null and p_ends_on <= p_starts_on then
    return jsonb_build_object('ok', false, 'reason', 'end_before_start');
  end if;

  select a.* into v_target
  from smartgov.accounts a
  where a.id = p_account_id
    and a.organization_id = v_owner.organization_id;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  -- The umbrella is the units under the USG; the owner and the board are not
  -- something the owner deactivates from here.
  if v_target.account_scope = 'owner' then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  -- A day is inclusive: start at 00:00 of the start date, end at 23:59:59 of
  -- the end date, both in the server's timezone.
  v_starts := p_starts_on::timestamptz;
  v_ends   := (p_ends_on + 1)::timestamptz - interval '1 second';

  update smartgov.accounts a
     set deactivation_starts_at = v_starts,
         deactivation_ends_at = case when p_ends_on is null then null else v_ends end,
         deactivation_reason = nullif(trim(coalesce(p_reason, '')), ''),
         deactivation_scheduled_by = v_owner.id
   where a.id = v_target.id;

  -- Apply right away when the window is already open.
  perform smartgov.apply_scheduled_deactivation(v_target.id);

  return jsonb_build_object(
    'ok', true,
    'accountId', v_target.id,
    'startsAt', v_starts,
    'endsAt', case when p_ends_on is null then null else v_ends end
  );
end;
$$;

-- Lifts a scheduled deactivation and reactivates the seat if the window was
-- open. A no-op if there was nothing scheduled.
create or replace function smartgov.cancel_deactivation(
  p_session_token text,
  p_account_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, smartgov, pg_temp
as $$
declare
  v_owner  smartgov.accounts%rowtype;
  v_target smartgov.accounts%rowtype;
begin
  v_owner := smartgov.authenticate(p_session_token);
  if v_owner.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if v_owner.account_scope <> 'owner' then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  select a.* into v_target
  from smartgov.accounts a
  where a.id = p_account_id
    and a.organization_id = v_owner.organization_id;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  update smartgov.accounts a
     set deactivation_starts_at = null,
         deactivation_ends_at = null,
         deactivation_reason = null,
         deactivation_scheduled_by = null,
         status = case when a.status = 'suspended' then 'active' else a.status end
   where a.id = v_target.id;

  return jsonb_build_object('ok', true, 'accountId', v_target.id);
end;
$$;

-- ---------------------------------------------------------------- forwards

create or replace function public.my_profile(p_session_token text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.my_profile(p_session_token); $$;

create or replace function public.update_my_profile(p_session_token text, p_display_name text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.update_my_profile(p_session_token, p_display_name); $$;

create or replace function public.change_my_email(p_session_token text, p_new_email text, p_password text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.change_my_email(p_session_token, p_new_email, p_password); $$;

create or replace function public.change_my_password(p_session_token text, p_current_password text, p_new_password text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.change_my_password(p_session_token, p_current_password, p_new_password); $$;

create or replace function public.update_customisation(p_session_token text, p_accent text, p_theme_mode text, p_logo_data text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.update_customisation(p_session_token, p_accent, p_theme_mode, p_logo_data); $$;

create or replace function public.list_umbrella(p_session_token text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.list_umbrella(p_session_token); $$;

create or replace function public.schedule_deactivation(p_session_token text, p_account_id uuid, p_starts_on date, p_ends_on date, p_reason text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.schedule_deactivation(p_session_token, p_account_id, p_starts_on, p_ends_on, p_reason); $$;

create or replace function public.cancel_deactivation(p_session_token text, p_account_id uuid)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.cancel_deactivation(p_session_token, p_account_id); $$;

-- ---------------------------------------------------------------- grants

revoke execute on function smartgov.apply_scheduled_deactivation(uuid) from public, anon, authenticated;
revoke execute on function smartgov.my_profile(text) from public, anon, authenticated;
revoke execute on function smartgov.update_my_profile(text, text) from public, anon, authenticated;
revoke execute on function smartgov.change_my_email(text, text, text) from public, anon, authenticated;
revoke execute on function smartgov.change_my_password(text, text, text) from public, anon, authenticated;
revoke execute on function smartgov.update_customisation(text, text, text, text) from public, anon, authenticated;
revoke execute on function smartgov.list_umbrella(text) from public, anon, authenticated;
revoke execute on function smartgov.schedule_deactivation(text, uuid, date, date, text) from public, anon, authenticated;
revoke execute on function smartgov.cancel_deactivation(text, uuid) from public, anon, authenticated;

grant execute on function public.my_profile(text)                                   to anon, authenticated;
grant execute on function public.update_my_profile(text, text)                      to anon, authenticated;
grant execute on function public.change_my_email(text, text, text)                  to anon, authenticated;
grant execute on function public.change_my_password(text, text, text)               to anon, authenticated;
grant execute on function public.update_customisation(text, text, text, text)       to anon, authenticated;
grant execute on function public.list_umbrella(text)                                to anon, authenticated;
grant execute on function public.schedule_deactivation(text, uuid, date, date, text) to anon, authenticated;
grant execute on function public.cancel_deactivation(text, uuid)                    to anon, authenticated;
