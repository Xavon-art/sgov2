-- 03080 -- Scheduled (temporary) deactivation.
--
-- An officer can be deactivated with an optional end date; when that date
-- passes the account reactivates itself lazily on the next sign-in. A
-- `reactivate_if_due` helper performs that check for the signed-in account.

alter table smartgov.accounts add column if not exists deactivation_starts_at timestamptz;
alter table smartgov.accounts add column if not exists deactivation_ends_at timestamptz;

-- Redefine deactivate_officer to record the schedule. Trailing parameters with
-- defaults keep the old call sites working.
create or replace function smartgov.deactivate_officer(
  p_session_token     text,
  p_account_id        uuid,
  p_reason            text,
  p_replacement_email text,
  p_starts_at         timestamptz default null,
  p_ends_at           timestamptz default null
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
  v_start    timestamptz := coalesce(p_starts_at, now());
  v_end      timestamptz := p_ends_at;
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

  if v_email <> '' then
    if position('@' in v_email) = 0 then
      return jsonb_build_object('ok', false, 'reason', 'invalid_email');
    end if;

    if exists (select 1 from smartgov.accounts a where lower(a.email) = v_email) then
      return jsonb_build_object('ok', false, 'reason', 'replacement_registered');
    end if;

    if not smartgov.consume_rate_limit(
         'deactivate:' || v_owner.id::text, 30, interval '1 hour') then
      return jsonb_build_object('ok', false, 'reason', 'rate_limited');
    end if;
  end if;

  if v_start <= now() then
    update smartgov.accounts
       set status = 'suspended',
           deactivated_by = v_owner.id,
           deactivated_at = now(),
           deactivation_reason = p_reason,
           deactivated_email = v_target.email,
           deactivation_starts_at = v_start,
           deactivation_ends_at = v_end
     where id = v_target.id;
  else
    update smartgov.accounts
       set deactivated_by = v_owner.id,
           deactivated_at = null,
           deactivation_reason = p_reason,
           deactivated_email = v_target.email,
           deactivation_starts_at = v_start,
           deactivation_ends_at = v_end
     where id = v_target.id;
  end if;

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
    'startsAt', v_start,
    'endsAt', v_end
  );
end;
$$;

revoke all on function smartgov.deactivate_officer(text, uuid, text, text, timestamptz, timestamptz) from public;


-- reactivate_if_due: reactivates the signed-in account if its deactivation ended.
create or replace function smartgov.reactivate_if_due(p_session_token text)
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

  if v_account.status = 'suspended'
     and v_account.deactivation_ends_at is not null
     and v_account.deactivation_ends_at <= now() then
    update smartgov.accounts
       set status = 'active',
           deactivated_at = null,
           deactivation_reason = null,
           deactivation_starts_at = null,
           deactivation_ends_at = null
     where id = v_account.id;
    return jsonb_build_object('ok', true, 'reactivated', true);
  end if;

  -- scheduled suspension that has come due
  if v_account.status = 'active'
     and v_account.deactivation_starts_at is not null
     and v_account.deactivation_starts_at <= now()
     and (v_account.deactivation_ends_at is null or v_account.deactivation_ends_at > now()) then
    update smartgov.accounts
       set status = 'suspended',
           deactivated_at = now()
     where id = v_account.id;
    return jsonb_build_object('ok', true, 'suspended', true);
  end if;

  return jsonb_build_object('ok', true, 'reactivated', false);
end;
$$;

revoke all on function smartgov.reactivate_if_due(text) from public;


-- forwarders
create or replace function public.deactivate_officer(
  p_session_token text, p_account_id uuid, p_reason text,
  p_replacement_email text, p_starts_at timestamptz default null,
  p_ends_at timestamptz default null
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.deactivate_officer(p_session_token, p_account_id, p_reason, p_replacement_email, p_starts_at, p_ends_at); $$;
revoke all on function public.deactivate_officer(text, uuid, text, text, timestamptz, timestamptz) from public;
grant execute on function public.deactivate_officer(text, uuid, text, text, timestamptz, timestamptz) to anon, authenticated;

create or replace function public.reactivate_if_due(p_session_token text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.reactivate_if_due(p_session_token); $$;
revoke all on function public.reactivate_if_due(text) from public;
grant execute on function public.reactivate_if_due(text) to anon, authenticated;