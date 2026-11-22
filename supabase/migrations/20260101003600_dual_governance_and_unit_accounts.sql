alter type smartgov.account_kind add value if not exists 'lsg';

alter table smartgov.accounts
  add column if not exists unit_id uuid references public.governance_units (id) on delete cascade,
  add column if not exists is_unit_account boolean not null default false,
  add column if not exists governance_model public.governance_model;

do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'smartgov'
       and table_name = 'accounts'
       and column_name = 'governance_model'
       and data_type = 'text'
       and udt_name = 'text'
  ) then
    alter table smartgov.accounts
      alter column governance_model type public.governance_model
      using case
        when governance_model::text in ('federated', 'unitary')
          then governance_model::text::public.governance_model
        else null
      end;
  end if;
end $$;

update smartgov.accounts a
   set governance_model = o.governance_model
  from public.organizations o
 where a.organization_id = o.id
   and a.governance_model is distinct from o.governance_model;

alter table smartgov.invites
  add column if not exists is_unit_account boolean not null default false;

do $$ begin
  alter table smartgov.accounts
    add constraint accounts_unit_account_shape
    check (
      not is_unit_account
      or (unit_id is not null and account_kind::text = 'lsg')
    );
exception when duplicate_object then null; end $$;

create unique index if not exists accounts_one_active_unit_account_idx
  on smartgov.accounts (unit_id)
  where is_unit_account and status in ('active', 'pending');

revoke all on table smartgov.accounts from public, anon, authenticated;
revoke all on table smartgov.invites from public, anon, authenticated;

create or replace function smartgov.is_org_owner(p_account smartgov.accounts)
returns boolean
language sql stable
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
  select not coalesce(p_account.is_unit_account, false)
     and p_account.account_scope = 'owner';
$$;
revoke all on function smartgov.is_org_owner(smartgov.accounts) from public, anon, authenticated;

create or replace function smartgov.is_central_manager(p_account smartgov.accounts)
returns boolean
language sql stable
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
  select smartgov.is_org_owner(p_account);
$$;
revoke all on function smartgov.is_central_manager(smartgov.accounts) from public, anon, authenticated;

create or replace function smartgov.is_central_account(p_account smartgov.accounts)
returns boolean
language sql stable
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
  select coalesce(p_account.governance_model::text, '') = 'unitary'
      or p_account.account_kind::text = 'central';
$$;
revoke all on function smartgov.is_central_account(smartgov.accounts) from public, anon, authenticated;

create or replace function smartgov.gov_root_unit(p_organization uuid)
returns uuid
language sql stable
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
  select gu.id
    from public.governance_units gu
    join public.organizations o on o.id = gu.organization_id
   where gu.organization_id = p_organization
     and (
       (o.governance_model::text = 'federated' and gu.unit_type::text = 'usg')
       or (coalesce(o.governance_model::text, '') <> 'federated' and gu.parent_id is null)
     )
   order by gu.created_at
   limit 1;
$$;
revoke all on function smartgov.gov_root_unit(uuid) from public;

create or replace function smartgov.lsg_unit_ids(p_account uuid, p_organization uuid)
returns setof uuid
language sql stable
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
  select a.unit_id
    from smartgov.accounts a
   where a.id = p_account
     and a.organization_id = p_organization
     and coalesce(a.is_unit_account, false)
     and a.unit_id is not null
  union
  select m.unit_id
    from smartgov.roster r
    join smartgov.unit_memberships m on m.roster_id = r.id and m.end_date is null
   where r.account_id = p_account
     and r.organization_id = p_organization
     and not exists (
       select 1 from smartgov.accounts a
        where a.id = p_account and coalesce(a.is_unit_account, false)
     );
$$;
revoke all on function smartgov.lsg_unit_ids(uuid, uuid) from public;

create or replace function smartgov.is_org_reviewer(p_account uuid, p_organization uuid)
returns boolean
language sql stable
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
  select exists (
    select 1
      from smartgov.roster r
      join smartgov.unit_memberships m on m.roster_id = r.id and m.end_date is null
      join public.governance_units u on u.id = m.unit_id
      join smartgov.accounts a on a.id = p_account
     where r.account_id = p_account
       and r.organization_id = p_organization
       and u.organization_id = p_organization
       and u.id = smartgov.gov_root_unit(p_organization)
       and not coalesce(a.is_unit_account, false)
  );
$$;
revoke all on function smartgov.is_org_reviewer(uuid, uuid) from public;

create or replace function smartgov.is_usg_side(p_account smartgov.accounts)
returns boolean
language sql stable
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
  select not coalesce(p_account.is_unit_account, false)
     and (
       p_account.account_scope = 'owner'
       or p_account.account_kind::text = 'central'
       or smartgov.is_org_reviewer(p_account.id, p_account.organization_id)
     );
$$;
revoke all on function smartgov.is_usg_side(smartgov.accounts) from public;

create or replace function smartgov.can_approve_document(p_account smartgov.accounts)
returns boolean
language sql stable
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
  select smartgov.is_central_manager(p_account)
      or smartgov.is_org_reviewer(p_account.id, p_account.organization_id);
$$;
revoke all on function smartgov.can_approve_document(smartgov.accounts) from public, anon, authenticated;

create or replace function smartgov.authenticate(p_token text)
returns smartgov.accounts
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
begin
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
          and (
            not coalesce(a.is_unit_account, false)
            or exists (
              select 1 from public.governance_units u
               where u.id = a.unit_id and u.organization_id = a.organization_id
            )
          )
     );

  select a.* into v_account
    from smartgov.sessions s
    join smartgov.accounts a on a.id = s.account_id
   where s.token_hash = smartgov.sha256(p_token)
     and s.expires_at > now()
     and a.status = 'active'
     and (
       not coalesce(a.is_unit_account, false)
       or exists (
         select 1 from public.governance_units u
          where u.id = a.unit_id and u.organization_id = a.organization_id
       )
     );

  if not found then
    return null;
  end if;
  return v_account;
end;
$$;
revoke all on function smartgov.authenticate(text) from public, anon, authenticated;

drop function if exists public.resolve_account(text);
drop function if exists smartgov.resolve_account(text);

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
  status smartgov.account_status,
  unit_id uuid,
  governance_model public.governance_model,
  is_unit_account boolean
)
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
begin
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
       select 1 from smartgov.accounts a
        where a.id = s.account_id
          and a.status = 'active'
          and (
            not coalesce(a.is_unit_account, false)
            or exists (
              select 1 from public.governance_units u
               where u.id = a.unit_id and u.organization_id = a.organization_id
            )
          )
     );

  return query
  select a.id, a.email, a.display_name, a.account_kind, a.account_scope,
         a.organization_id, a.university_name, a.campus_name, a.status,
         a.unit_id, coalesce(o.governance_model, a.governance_model),
         coalesce(a.is_unit_account, false)
    from smartgov.sessions s
    join smartgov.accounts a on a.id = s.account_id
    left join public.organizations o on o.id = a.organization_id
   where s.token_hash = smartgov.sha256(p_token)
     and s.expires_at > now()
     and a.status = 'active'
     and (
       not coalesce(a.is_unit_account, false)
       or exists (
         select 1 from public.governance_units u
          where u.id = a.unit_id and u.organization_id = a.organization_id
       )
     );
end;
$$;
revoke all on function smartgov.resolve_account(text) from public, anon, authenticated;

create or replace function public.resolve_account(p_token text)
returns table (
  id uuid,
  email text,
  display_name text,
  account_kind smartgov.account_kind,
  account_scope smartgov.account_scope,
  organization_id uuid,
  university_name text,
  campus_name text,
  status smartgov.account_status,
  unit_id uuid,
  governance_model public.governance_model,
  is_unit_account boolean
)
language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select * from smartgov.resolve_account(p_token); $$;
revoke all on function public.resolve_account(text) from public;
grant execute on function public.resolve_account(text) to anon, authenticated;

create or replace function smartgov.create_owner_account(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_email text := lower(trim(coalesce(p_payload->>'email', '')));
  v_password text := coalesce(p_payload->>'password', '');
  v_name text := trim(coalesce(p_payload->>'displayName', ''));
  v_kind smartgov.account_kind;
  v_org_id uuid;
  v_account_id uuid;
  v_raw_kind text := coalesce(p_payload->>'accountKind', '');
  v_org_name text;
  v_org_campus text;
  v_model public.governance_model;
  v_verify_raw text := encode(extensions.gen_random_bytes(24), 'hex');
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
  if smartgov.register_rate_limited(v_email) then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  begin
    v_org_id := nullif(btrim(coalesce(p_payload->>'organizationId', '')), '')::uuid;
  exception when invalid_text_representation then
    return jsonb_build_object('ok', false, 'reason', 'invalid_organization');
  end;

  if v_org_id is not null then
    select o.name, o.campus_name, o.governance_model
      into v_org_name, v_org_campus, v_model
      from public.organizations o
     where o.id = v_org_id
       and exists (
         select 1 from public.organization_members m
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

  if coalesce(v_model::text, '') = 'unitary' or v_raw_kind = 'central' then
    v_kind := 'central';
  else
    v_kind := 'usg';
  end if;

  insert into smartgov.accounts (
    email, password_hash, display_name, account_kind, account_scope,
    organization_id, university_name, campus_name, status,
    verify_token_hash, governance_model, is_unit_account
  )
  values (
    v_email, smartgov.hash_password(v_password), v_name, v_kind, 'owner',
    v_org_id,
    trim(coalesce(nullif(btrim(coalesce(p_payload->>'universityName', '')), ''), v_org_name, '')),
    trim(coalesce(nullif(btrim(coalesce(p_payload->>'campusName', '')), ''), v_org_campus, '')),
    'pending', smartgov.sha256(v_verify_raw), v_model, false
  )
  returning id into v_account_id;

  return jsonb_build_object(
    'ok', true,
    'accountId', v_account_id,
    'verifyToken', v_verify_raw,
    'email', v_email,
    'accountKind', v_kind,
    'organizationName', v_org_name,
    'campusName', v_org_campus,
    'governanceModel', v_model
  );
end;
$$;
revoke all on function smartgov.create_owner_account(jsonb) from public, anon, authenticated;

create or replace function smartgov.login_account(p_email text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_raw text;
begin
  if p_email is null or p_password is null or p_email = '' or p_password = '' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_credentials');
  end if;
  if smartgov.login_rate_limited(p_email) then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  v_raw := encode(extensions.gen_random_bytes(32), 'hex');

  select a.* into v_account
    from smartgov.accounts a
   where lower(a.email) = lower(trim(p_email));

  if not found then
    perform smartgov.password_matches(p_password, smartgov.hash_password('dummy'));
    return jsonb_build_object('ok', false, 'reason', 'invalid_credentials');
  end if;

  if not smartgov.password_matches(p_password, v_account.password_hash) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_credentials');
  end if;

  perform smartgov.apply_scheduled_deactivation(v_account.id);

  select a.* into v_account
    from smartgov.accounts a
   where a.id = v_account.id;

  if v_account.status <> 'active' then
    return jsonb_build_object('ok', false, 'reason', 'account_pending');
  end if;
  if coalesce(v_account.is_unit_account, false) and not exists (
    select 1 from public.governance_units u
     where u.id = v_account.unit_id and u.organization_id = v_account.organization_id
  ) then
    return jsonb_build_object('ok', false, 'reason', 'unit_unavailable');
  end if;

  insert into smartgov.sessions (account_id, token_hash, expires_at)
  values (v_account.id, smartgov.sha256(v_raw), now() + interval '30 days');

  return jsonb_build_object(
    'ok', true,
    'token', v_raw,
    'welcomeDue', (v_account.account_scope = 'invited' and v_account.welcome_sent_at is null),
    'account', jsonb_build_object(
      'id', v_account.id,
      'email', v_account.email,
      'displayName', v_account.display_name,
      'accountKind', v_account.account_kind,
      'accountScope', v_account.account_scope,
      'organizationId', v_account.organization_id,
      'universityName', v_account.university_name,
      'campusName', v_account.campus_name,
      'unitId', v_account.unit_id,
      'governanceModel', coalesce(
        (select o.governance_model from public.organizations o where o.id = v_account.organization_id),
        v_account.governance_model
      ),
      'isUnitAccount', coalesce(v_account.is_unit_account, false)
    )
  );
end;
$$;
revoke all on function smartgov.login_account(text, text) from public, anon, authenticated;

create or replace function smartgov.create_invite(
  p_session_token text,
  p_email text,
  p_campus_name text,
  p_unit_type text,
  p_unit_id uuid default null,
  p_position_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_email text := lower(trim(coalesce(p_email, '')));
  v_raw text := encode(extensions.gen_random_bytes(24), 'hex');
  v_unit public.unit_type := 'lsg';
  v_invite_id uuid;
  v_org_name text;
  v_roster_id uuid;
  v_membership_id uuid;
  v_model text;
  v_root uuid;
  v_is_unit boolean := false;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if not smartgov.is_central_manager(v_account) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if v_account.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;
  if v_email = '' or position('@' in v_email) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_email');
  end if;
  if not smartgov.consume_rate_limit('invite:session:' || v_account.id::text, 30, interval '1 hour')
     or not smartgov.consume_rate_limit('invite:email:' || v_email, 5, interval '1 hour') then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;
  if exists (select 1 from smartgov.accounts a where lower(a.email) = v_email) then
    return jsonb_build_object('ok', false, 'reason', 'already_registered');
  end if;

  if p_unit_type in ('lsg', 'college', 'campus', 'council', 'department') then
    v_unit := p_unit_type::public.unit_type;
  end if;

  if p_unit_id is null and p_position_id is not null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  select o.governance_model::text into v_model
    from public.organizations o where o.id = v_account.organization_id;
  v_root := smartgov.gov_root_unit(v_account.organization_id);
  v_is_unit := coalesce(p_unit_id is not null and (v_root is null or p_unit_id <> v_root), false);

  if p_unit_id is not null then
    if not exists (
      select 1 from public.governance_units gu
       where gu.id = p_unit_id and gu.organization_id = v_account.organization_id
    ) or (
      p_position_id is not null
      and not exists (
        select 1 from smartgov.org_positions op
         where op.id = p_position_id and op.organization_id = v_account.organization_id
      )
    ) then
      return jsonb_build_object('ok', false, 'reason', 'not_found');
    end if;

    if v_is_unit and exists (
      select 1 from smartgov.accounts a
       where a.unit_id = p_unit_id
         and coalesce(a.is_unit_account, false)
         and a.status in ('active', 'pending')
    ) then
      return jsonb_build_object('ok', false, 'reason', 'unit_account_exists');
    end if;

    if p_position_id is not null then
      if not exists (
        select 1 from smartgov.unit_positions up
         where up.unit_id = p_unit_id and up.position_id = p_position_id
      ) then
        return jsonb_build_object('ok', false, 'reason', 'seat_not_enabled');
      end if;
      if exists (
        select 1 from smartgov.unit_memberships m
         where m.unit_id = p_unit_id and m.position_id = p_position_id and m.end_date is null
      ) then
        return jsonb_build_object('ok', false, 'reason', 'seat_occupied');
      end if;
    end if;
  end if;

  update smartgov.invites
     set status = 'revoked'
   where organization_id = v_account.organization_id
     and lower(email) = v_email
     and status = 'pending';

  insert into smartgov.invites (
    organization_id, email, campus_name, unit_type, unit_id, position_id,
    token_hash, invited_by, expires_at, is_unit_account
  )
  values (
    v_account.organization_id, v_email, trim(coalesce(p_campus_name, '')),
    v_unit, p_unit_id, p_position_id,
    smartgov.sha256(v_raw), v_account.display_name, now() + interval '14 days', v_is_unit
  )
  returning id into v_invite_id;

  if p_unit_id is not null then
    insert into smartgov.roster (organization_id, full_name, email)
    values (v_account.organization_id, v_email, v_email)
    on conflict (organization_id, lower(email)) do update set email = excluded.email
    returning id into v_roster_id;

    if not exists (
      select 1 from smartgov.unit_memberships m
       where m.unit_id = p_unit_id
         and m.roster_id = v_roster_id
         and m.position_id is not distinct from p_position_id
         and m.end_date is null
    ) then
      insert into smartgov.unit_memberships (roster_id, unit_id, position_id)
      values (v_roster_id, p_unit_id, p_position_id)
      returning id into v_membership_id;
    end if;
  end if;

  select o.name into v_org_name
    from public.organizations o where o.id = v_account.organization_id;

  return jsonb_build_object(
    'ok', true,
    'token', v_raw,
    'inviteId', v_invite_id,
    'email', v_email,
    'unitId', p_unit_id,
    'isUnitAccount', v_is_unit,
    'governanceModel', v_model,
    'organizationName', v_org_name,
    'campusName', trim(coalesce(p_campus_name, '')),
    'rosterId', v_roster_id,
    'membershipId', v_membership_id
  );
end;
$$;
revoke all on function smartgov.create_invite(text, text, text, text, uuid, uuid) from public, anon, authenticated;

create or replace function smartgov.accept_invite(p_token text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_invite smartgov.invites%rowtype;
  v_target smartgov.accounts%rowtype;
  v_account_id uuid;
  v_kind smartgov.account_kind;
  v_org_name text;
  v_university text;
  v_model text;
  v_root uuid;
  v_is_unit boolean;
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

  if v_invite.handover_account_id is not null then
    select * into v_target
      from smartgov.accounts
     where id = v_invite.handover_account_id
       and organization_id = v_invite.organization_id;
    if v_target.id is null or v_target.status not in ('suspended', 'pending') then
      return jsonb_build_object('ok', false, 'reason', 'invalid_invite');
    end if;
    if exists (
      select 1 from smartgov.accounts a
       where lower(a.email) = lower(v_invite.email) and a.id <> v_target.id
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
      from public.organizations o where o.id = v_invite.organization_id;
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

  if exists (select 1 from smartgov.accounts a where lower(a.email) = v_invite.email) then
    return jsonb_build_object('ok', false, 'reason', 'already_registered');
  end if;

  select o.governance_model::text, coalesce(o.name, ''), coalesce(o.university_name, '')
    into v_model, v_org_name, v_university
    from public.organizations o where o.id = v_invite.organization_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'invalid_invite');
  end if;

  v_root := smartgov.gov_root_unit(v_invite.organization_id);
  v_is_unit := coalesce(v_invite.is_unit_account, false)
               or coalesce(
                 v_invite.unit_id is not null and (v_root is null or v_invite.unit_id <> v_root),
                 false
               );

  if v_is_unit then
    v_kind := 'lsg';
  elsif coalesce(v_model, '') = 'unitary' then
    v_kind := 'central';
  else
    v_kind := 'usg';
  end if;

  insert into smartgov.accounts (
    email, password_hash, display_name, account_kind, account_scope,
    organization_id, university_name, campus_name, status,
    unit_id, governance_model, is_unit_account
  )
  values (
    v_invite.email, smartgov.hash_password(p_password), v_invite.email,
    v_kind, 'invited', v_invite.organization_id, v_university,
    v_invite.campus_name, 'pending',
    case when v_is_unit then v_invite.unit_id else null end,
    v_model::public.governance_model, v_is_unit
  )
  returning id into v_account_id;

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
    'universityName', v_university,
    'unitId', case when v_is_unit then v_invite.unit_id else null end,
    'governanceModel', v_model,
    'isUnitAccount', v_is_unit
  );
end;
$$;
revoke all on function smartgov.accept_invite(text, text) from public, anon, authenticated;

create or replace function smartgov.create_unit_account(
  p_session_token text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_caller smartgov.accounts%rowtype;
  v_email text := lower(trim(coalesce(p_payload->>'email', '')));
  v_name text := trim(coalesce(p_payload->>'displayName', ''));
  v_unit_id uuid;
  v_position_id uuid;
  v_password text := coalesce(p_payload->>'password', '');
  v_invite jsonb;
  v_accepted jsonb;
  v_account_id uuid;
  v_token text;
  v_model text;
begin
  v_caller := smartgov.authenticate(p_session_token);
  if v_caller.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if not smartgov.is_central_manager(v_caller) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if v_email = '' or v_name = '' or v_password = '' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;
  if length(v_password) < 8 then
    return jsonb_build_object('ok', false, 'reason', 'weak_password');
  end if;

  begin
    v_unit_id := (p_payload->>'unitId')::uuid;
    if p_payload ? 'positionId' and coalesce(p_payload->>'positionId', '') <> '' then
      v_position_id := (p_payload->>'positionId')::uuid;
    end if;
  exception when invalid_text_representation then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end;

  if v_unit_id is null or v_unit_id = smartgov.gov_root_unit(v_caller.organization_id) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_unit');
  end if;

  v_invite := smartgov.create_invite(
    p_session_token, v_email,
    trim(coalesce(p_payload->>'campusName', '')), 'lsg', v_unit_id, v_position_id
  );
  if coalesce(v_invite->>'ok', 'false') <> 'true' then
    return v_invite;
  end if;

  v_accepted := smartgov.accept_invite(v_invite->>'token', v_password);
  if coalesce(v_accepted->>'ok', 'false') <> 'true' then
    return v_accepted;
  end if;
  v_account_id := (v_accepted->>'accountId')::uuid;
  v_model := v_accepted->>'governanceModel';

  update smartgov.accounts
     set display_name = v_name,
         campus_name = trim(coalesce(p_payload->>'campusName', campus_name)),
         status = 'active',
         activated_at = now()
   where id = v_account_id;

  update smartgov.roster
     set full_name = v_name
   where organization_id = v_caller.organization_id
     and lower(email) = v_email;

  v_token := smartgov.login_account(v_email, v_password)->>'token';

  return jsonb_build_object(
    'ok', true,
    'accountId', v_account_id,
    'email', v_email,
    'displayName', v_name,
    'accountKind', 'lsg',
    'isUnitAccount', true,
    'unitId', v_unit_id,
    'governanceModel', v_model,
    'password', v_password,
    'token', v_token
  );
end;
$$;
revoke all on function smartgov.create_unit_account(text, jsonb) from public, anon, authenticated;

create or replace function smartgov.rename_unit_account(
  p_session_token text,
  p_account_id uuid,
  p_display_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_caller smartgov.accounts%rowtype;
  v_target smartgov.accounts%rowtype;
  v_name text := trim(coalesce(p_display_name, ''));
begin
  v_caller := smartgov.authenticate(p_session_token);
  if v_caller.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if not smartgov.is_central_manager(v_caller) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if length(v_name) < 2 or length(v_name) > 80 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_name');
  end if;

  select * into v_target
    from smartgov.accounts
   where id = p_account_id
     and organization_id = v_caller.organization_id
     and coalesce(is_unit_account, false);
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  update smartgov.accounts set display_name = v_name where id = v_target.id;
  update smartgov.roster set full_name = v_name
   where organization_id = v_caller.organization_id and lower(email) = lower(v_target.email);

  return jsonb_build_object('ok', true, 'accountId', v_target.id, 'displayName', v_name);
end;
$$;
revoke all on function smartgov.rename_unit_account(text, uuid, text) from public, anon, authenticated;

create or replace function smartgov.reset_unit_account_credentials(
  p_session_token text,
  p_account_id uuid,
  p_password text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_caller smartgov.accounts%rowtype;
  v_target smartgov.accounts%rowtype;
  v_password text := coalesce(p_password, '');
begin
  v_caller := smartgov.authenticate(p_session_token);
  if v_caller.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if not smartgov.is_central_manager(v_caller) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if length(v_password) < 8 then
    return jsonb_build_object('ok', false, 'reason', 'weak_password');
  end if;

  select * into v_target
    from smartgov.accounts
   where id = p_account_id
     and organization_id = v_caller.organization_id
     and coalesce(is_unit_account, false);
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  update smartgov.accounts
     set password_hash = smartgov.hash_password(v_password),
         otp_hash = null,
         otp_expires_at = null,
         otp_attempts = 0
   where id = v_target.id;

  return jsonb_build_object('ok', true, 'accountId', v_target.id, 'password', v_password);
end;
$$;
revoke all on function smartgov.reset_unit_account_credentials(text, uuid, text) from public, anon, authenticated;

create or replace function smartgov.resend_unit_account_credentials(
  p_session_token text,
  p_account_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_password text := encode(extensions.gen_random_bytes(12), 'hex');
  v_result jsonb;
begin
  v_result := smartgov.reset_unit_account_credentials(p_session_token, p_account_id, v_password);
  return v_result;
end;
$$;
revoke all on function smartgov.resend_unit_account_credentials(text, uuid) from public, anon, authenticated;

create or replace function smartgov.set_unit_account_pause(
  p_session_token text,
  p_account_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_caller smartgov.accounts%rowtype;
  v_target smartgov.accounts%rowtype;
begin
  v_caller := smartgov.authenticate(p_session_token);
  if v_caller.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if not smartgov.is_central_manager(v_caller) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if p_starts_at is null or (p_ends_at is not null and p_ends_at <= p_starts_at) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  select * into v_target
    from smartgov.accounts
   where id = p_account_id
     and organization_id = v_caller.organization_id
     and coalesce(is_unit_account, false);
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  update smartgov.accounts
     set deactivation_starts_at = p_starts_at,
         deactivation_ends_at = p_ends_at,
         deactivation_reason = nullif(trim(coalesce(p_reason, '')), ''),
         deactivation_scheduled_by = v_caller.id
   where id = v_target.id;
  perform smartgov.apply_scheduled_deactivation(v_target.id);

  return jsonb_build_object(
    'ok', true,
    'accountId', v_target.id,
    'startsAt', p_starts_at,
    'endsAt', p_ends_at
  );
end;
$$;
revoke all on function smartgov.set_unit_account_pause(text, uuid, timestamptz, timestamptz, text) from public, anon, authenticated;

create or replace function smartgov.account_workspace_role(p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_perms text[];
  v_unit uuid;
  v_unitname text;
  v_governance_model public.governance_model;
  v_is_central boolean;
  v_is_admin boolean;
  v_is_root boolean;
  v_is_unit_account boolean;
  v_side text;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  v_perms := smartgov.permissions_for(v_account);
  v_is_unit_account := coalesce(v_account.is_unit_account, false);
  v_is_admin := v_account.account_scope = 'owner' and not v_is_unit_account;
  select o.governance_model into v_governance_model
    from public.organizations o where o.id = v_account.organization_id;
  v_governance_model := coalesce(v_governance_model, v_account.governance_model);
  v_is_central := coalesce(v_governance_model::text, '') = 'unitary'
                  or v_account.account_kind::text = 'central';
  v_is_root := smartgov.is_org_reviewer(v_account.id, v_account.organization_id);

  if v_is_unit_account then
    v_side := 'lsg';
  elsif v_is_admin or v_is_central or v_is_root then
    v_side := 'usg';
  else
    v_side := 'lsg';
  end if;

  if v_is_unit_account then
    v_unit := v_account.unit_id;
  else
    select t.u into v_unit
      from (select smartgov.lsg_unit_ids(v_account.id, v_account.organization_id) as u) t
     order by t.u
     limit 1;
  end if;

  select gu.name into v_unitname from public.governance_units gu where gu.id = v_unit;

  return jsonb_build_object(
    'ok', true,
    'side', v_side,
    'isAdmin', v_is_admin,
    'isCentral', v_is_central,
    'isUnitAccount', v_is_unit_account,
    'governanceModel', v_governance_model,
    'canInvite', not v_is_unit_account and (v_is_admin or 'can_invite' = any (v_perms)),
    'canTargetUnits', not v_is_unit_account and (v_is_admin or 'can_target_units' = any (v_perms)),
    'permissions', to_jsonb(v_perms),
    'unitId', v_unit,
    'unitName', v_unitname,
    'accountScope', v_account.account_scope,
    'accountKind', v_account.account_kind
  );
end;
$$;
revoke all on function smartgov.account_workspace_role(text) from public, anon, authenticated;
revoke all on function public.account_workspace_role(text) from public;
grant execute on function public.account_workspace_role(text) to anon, authenticated;

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
  v_accent text := nullif(trim(coalesce(p_accent, '')), '');
  v_theme text := nullif(trim(coalesce(p_theme_mode, '')), '');
  v_logo text := case when p_logo_data is null then null else trim(p_logo_data) end;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if coalesce(v_account.is_unit_account, false) or not (
    smartgov.is_central_manager(v_account)
    or smartgov.is_org_reviewer(v_account.id, v_account.organization_id)
  ) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if v_theme is not null and v_theme not in ('light', 'dark', 'system') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_theme');
  end if;
  if v_accent is not null and v_accent !~ '^#?[0-9a-fA-F]{6}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_accent');
  end if;
  if v_logo is not null and length(v_logo) > 200000 then
    return jsonb_build_object('ok', false, 'reason', 'logo_too_large');
  end if;

  update public.organizations o
     set accent = coalesce(v_accent, o.accent),
         theme_mode = coalesce(v_theme, o.theme_mode),
         logo_data = case when p_logo_data is null then o.logo_data else nullif(v_logo, '') end,
         customised_at = now(),
         customised_by = v_account.id
   where o.id = v_account.organization_id;

  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function smartgov.update_customisation(text, text, text, text) from public, anon, authenticated;

create or replace function smartgov.update_my_identity(
  p_session_token text,
  p_university_name text,
  p_campus_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_university text := btrim(coalesce(p_university_name, ''));
  v_campus text := btrim(coalesce(p_campus_name, ''));
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if length(v_campus) > 160 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_identity');
  end if;
  if coalesce(v_account.is_unit_account, false) then
    if v_university <> '' and v_university <> v_account.university_name then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
    v_university := v_account.university_name;
  elsif v_university <> '' and not smartgov.is_central_manager(v_account) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if v_university = '' then
    v_university := v_account.university_name;
  end if;
  if length(v_university) not between 2 and 160 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_identity');
  end if;

  update smartgov.accounts
     set university_name = v_university,
         campus_name = v_campus
   where id = v_account.id;

  return jsonb_build_object(
    'ok', true,
    'universityName', v_university,
    'campusName', v_campus
  );
end;
$$;
revoke all on function smartgov.update_my_identity(text, text, text) from public, anon, authenticated;

create or replace function smartgov.list_umbrella(p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_org uuid;
  v_root uuid;
  v_units jsonb;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if not smartgov.is_central_manager(v_account) and not smartgov.is_org_reviewer(v_account.id, v_account.organization_id) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  v_org := v_account.organization_id;
  v_root := smartgov.gov_root_unit(v_org);

  select coalesce(jsonb_agg(unit order by unit->>'name'), '[]'::jsonb)
    into v_units
    from (
      select jsonb_build_object(
        'unitId', u.id,
        'name', u.name,
        'unitType', u.unit_type,
        'parentId', u.parent_id,
        'structureKey', u.structure_key,
        'memberCount', (
          select count(distinct m.roster_id)
            from smartgov.unit_memberships m
           where m.unit_id = u.id
             and (m.end_date is null or m.end_date >= current_date)
        ),
        'members', coalesce((
          select jsonb_agg(member order by member->>'name')
            from (
              select jsonb_build_object(
                'rosterId', r.id,
                'name', coalesce(nullif(trim(r.full_name), ''), r.email),
                'email', r.email,
                'position', p.label,
                'account', case when a.id is null then null else jsonb_build_object(
                  'id', a.id,
                  'email', a.email,
                  'displayName', a.display_name,
                  'accountKind', a.account_kind,
                  'isUnitAccount', coalesce(a.is_unit_account, false),
                  'status', a.status,
                  'deactivationStartsAt', a.deactivation_starts_at,
                  'deactivationEndsAt', a.deactivation_ends_at,
                  'deactivationReason', a.deactivation_reason
                ) end
              ) as member
              from smartgov.unit_memberships m
              join smartgov.roster r on r.id = m.roster_id
              left join smartgov.accounts a on a.id = r.account_id
              left join smartgov.unit_positions up on up.unit_id = m.unit_id and up.position_id = m.position_id
              left join smartgov.org_positions p on p.id = up.position_id
             where m.unit_id = u.id
               and (m.end_date is null or m.end_date >= current_date)
            ) mm
        ), '[]'::jsonb)
      ) as unit
      from public.governance_units u
     where u.organization_id = v_org
       and (v_root is null or u.id <> v_root)
     ) s;

  return jsonb_build_object('ok', true, 'units', v_units);
end;
$$;
revoke all on function smartgov.list_umbrella(text) from public, anon, authenticated;

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
  if not smartgov.is_central_manager(v_account) and not smartgov.is_org_reviewer(v_account.id, v_account.organization_id) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if v_account.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;

  return jsonb_build_object(
    'ok', true,
    'officers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id,
        'email', a.email,
        'displayName', a.display_name,
        'accountKind', a.account_kind,
        'isCentral', smartgov.is_central_account(a) or coalesce(
          (select o.governance_model::text from public.organizations o where o.id = a.organization_id),
          ''
        ) = 'unitary',
        'isUnitAccount', coalesce(a.is_unit_account, false),
        'unitId', a.unit_id,
        'governanceModel', coalesce(
          (select o.governance_model from public.organizations o where o.id = a.organization_id),
          a.governance_model
        ),
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
            join smartgov.unit_memberships m on m.roster_id = r.id and m.end_date is null
            join public.governance_units g on g.id = m.unit_id
           where r.account_id = a.id
        )
      ) order by a.status asc, a.display_name nulls last, a.email)
      from smartgov.accounts a
     where a.organization_id = v_account.organization_id
       and a.account_scope <> 'owner'
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function smartgov.list_officers(text) from public, anon, authenticated;

create or replace function smartgov.deactivate_officer(
  p_session_token text,
  p_account_id uuid,
  p_reason text,
  p_replacement_email text,
  p_starts_at timestamptz default null,
  p_ends_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_owner smartgov.accounts%rowtype;
  v_target smartgov.accounts%rowtype;
  v_email text := lower(trim(coalesce(p_replacement_email, '')));
  v_raw text;
  v_org_name text;
  v_start timestamptz := coalesce(p_starts_at, now());
  v_end timestamptz := p_ends_at;
begin
  v_owner := smartgov.authenticate(p_session_token);
  if v_owner.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if not smartgov.is_central_manager(v_owner) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if v_owner.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;

  select * into v_target
    from smartgov.accounts
   where id = p_account_id and organization_id = v_owner.organization_id;
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
    if not smartgov.consume_rate_limit('deactivate:' || v_owner.id::text, 30, interval '1 hour') then
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
   where handover_account_id = v_target.id and status = 'pending';

  if v_email <> '' then
    v_raw := encode(extensions.gen_random_bytes(24), 'hex');
    insert into smartgov.invites (
      organization_id, email, campus_name, unit_type, unit_id, is_unit_account,
      token_hash, invited_by, expires_at, handover_account_id
    )
    values (
      v_target.organization_id, v_email, v_target.campus_name,
      case when coalesce(v_target.is_unit_account, false) then 'lsg'::public.unit_type else 'usg'::public.unit_type end,
      v_target.unit_id, coalesce(v_target.is_unit_account, false),
      smartgov.sha256(v_raw), v_owner.display_name, now() + interval '14 days', v_target.id
    );
  end if;

  select coalesce(o.name, '') into v_org_name
    from public.organizations o where o.id = v_target.organization_id;

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
revoke all on function smartgov.deactivate_officer(text, uuid, text, text, timestamptz, timestamptz) from public, anon, authenticated;

create or replace function smartgov.deactivate_officer(
  p_session_token text,
  p_account_id uuid,
  p_reason text,
  p_replacement_email text
)
returns jsonb
language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
  select smartgov.deactivate_officer(p_session_token, p_account_id, p_reason, p_replacement_email, null, null);
$$;
revoke all on function smartgov.deactivate_officer(text, uuid, text, text) from public, anon, authenticated;

create or replace function smartgov.purge_officer(
  p_session_token text,
  p_account_id uuid,
  p_confirm_email text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_owner smartgov.accounts%rowtype;
  v_target smartgov.accounts%rowtype;
  v_seats integer;
begin
  v_owner := smartgov.authenticate(p_session_token);
  if v_owner.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if not smartgov.is_central_manager(v_owner) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if v_owner.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;

  select * into v_target
    from smartgov.accounts
   where id = p_account_id and organization_id = v_owner.organization_id;
  if v_target.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_target.id = v_owner.id or v_target.account_scope = 'owner' then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if lower(trim(coalesce(p_confirm_email, ''))) <> lower(v_target.email) then
    return jsonb_build_object('ok', false, 'reason', 'confirm_mismatch');
  end if;

  select count(*) into v_seats
    from smartgov.unit_memberships m
    join smartgov.roster r on r.id = m.roster_id
   where r.account_id = v_target.id and m.end_date is null;

  delete from smartgov.roster where account_id = v_target.id;

  update smartgov.programs set created_by = v_owner.id where created_by = v_target.id;
  update smartgov.proposals set created_by = v_owner.id where created_by = v_target.id;
  update smartgov.proposal_versions set submitted_by = v_owner.id where submitted_by = v_target.id;
  update smartgov.proposal_requirements set created_by = v_owner.id where created_by = v_target.id;
  update smartgov.reviews set decided_by = v_owner.id where decided_by = v_target.id;
  update smartgov.budget_requests set requested_by = v_owner.id where requested_by = v_target.id;
  update smartgov.document_uploads set uploaded_by = v_owner.id where uploaded_by = v_target.id;
  update smartgov.tasks set created_by = v_owner.id where created_by = v_target.id;
  update smartgov.submission_verifications set verified_by = v_owner.id where verified_by = v_target.id;

  delete from smartgov.accounts where id = v_target.id;

  return jsonb_build_object(
    'ok', true,
    'purgedEmail', v_target.email,
    'purgedName', v_target.display_name,
    'seatsFreed', v_seats
  );
end;
$$;
revoke all on function smartgov.purge_officer(text, uuid, text) from public, anon, authenticated;

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
  v_owner smartgov.accounts%rowtype;
  v_target smartgov.accounts%rowtype;
  v_starts timestamptz;
  v_ends timestamptz;
begin
  v_owner := smartgov.authenticate(p_session_token);
  if v_owner.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if not smartgov.is_central_manager(v_owner) then
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
   where a.id = p_account_id and a.organization_id = v_owner.organization_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_target.account_scope = 'owner' then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  v_starts := p_starts_on::timestamptz;
  v_ends := case when p_ends_on is null then null else (p_ends_on + 1)::timestamptz - interval '1 second' end;

  update smartgov.accounts a
     set deactivation_starts_at = v_starts,
         deactivation_ends_at = v_ends,
         deactivation_reason = nullif(trim(coalesce(p_reason, '')), ''),
         deactivation_scheduled_by = v_owner.id
   where a.id = v_target.id;
  perform smartgov.apply_scheduled_deactivation(v_target.id);

  return jsonb_build_object(
    'ok', true,
    'accountId', v_target.id,
    'startsAt', v_starts,
    'endsAt', v_ends
  );
end;
$$;
revoke all on function smartgov.schedule_deactivation(text, uuid, date, date, text) from public, anon, authenticated;

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
  v_owner smartgov.accounts%rowtype;
  v_target smartgov.accounts%rowtype;
begin
  v_owner := smartgov.authenticate(p_session_token);
  if v_owner.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if not smartgov.is_central_manager(v_owner) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  select a.* into v_target
    from smartgov.accounts a
   where a.id = p_account_id and a.organization_id = v_owner.organization_id;
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
revoke all on function smartgov.cancel_deactivation(text, uuid) from public, anon, authenticated;

create or replace function smartgov.approve_document(
  p_session_token text,
  p_submission_id uuid,
  p_decision text,
  p_remark text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_row record;
  v_decision text := lower(btrim(coalesce(p_decision, '')));
  v_remark text := nullif(btrim(coalesce(p_remark, '')), '');
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if v_account.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;
  if not smartgov.can_approve_document(v_account) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if v_decision not in ('pending', 'approved', 'rejected') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;
  if v_decision = 'rejected' and v_remark is null then
    return jsonb_build_object('ok', false, 'reason', 'remark_required');
  end if;

  select isub.id, isub.requirement_item_id, isub.original_name, ri.label as item_label
    into v_row
    from smartgov.item_submissions isub
    join smartgov.proposal_versions pv on pv.id = isub.version_id
    join smartgov.proposals p on p.id = pv.proposal_id
    join smartgov.requirement_items ri on ri.id = isub.requirement_item_id
    join smartgov.document_uploads d on d.storage_path = isub.storage_path
   where isub.id = p_submission_id
     and isub.submission_kind = 'file'
     and d.large_object_oid is not null
     and p.organization_id = v_account.organization_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  insert into smartgov.document_catalog (
    submission_id, organization_id, title, group_kind, group_id, group_label,
    approval_status, approval_remark, approved_by, approved_at
  ) values (
    p_submission_id, v_account.organization_id,
    coalesce(nullif(btrim(v_row.original_name), ''), v_row.item_label),
    'requirement', v_row.requirement_item_id, v_row.item_label,
    v_decision, v_remark,
    case when v_decision = 'approved' then v_account.id else null end,
    case when v_decision = 'approved' then now() else null end
  )
  on conflict (submission_id) do update
     set approval_status = excluded.approval_status,
         approval_remark = excluded.approval_remark,
         approved_by = excluded.approved_by,
         approved_at = excluded.approved_at,
         updated_at = now();

  return jsonb_build_object(
    'ok', true,
    'submissionId', p_submission_id,
    'status', v_decision
  );
end;
$$;
revoke all on function smartgov.approve_document(text, uuid, text, text) from public, anon, authenticated;

create or replace function smartgov.set_document_metadata(
  p_session_token text,
  p_submission_id uuid,
  p_title text,
  p_description text,
  p_keywords text,
  p_group_kind text,
  p_group_id uuid,
  p_group_label text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_can_approve boolean;
  v_row record;
  v_existing smartgov.document_catalog%rowtype;
  v_title text := btrim(coalesce(p_title, ''));
  v_desc text := btrim(coalesce(p_description, ''));
  v_keywords text := btrim(coalesce(p_keywords, ''));
  v_kind text := lower(btrim(coalesce(p_group_kind, 'requirement')));
  v_label text := nullif(btrim(coalesce(p_group_label, '')), '');
  v_group_id uuid := p_group_id;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if v_account.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;
  if coalesce(v_account.is_unit_account, false) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  v_can_approve := smartgov.can_approve_document(v_account);

  if length(v_title) < 2 or length(v_title) > 160 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_title');
  end if;
  if length(v_desc) > 2000 or length(v_keywords) > 500 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  select * into v_existing
    from smartgov.document_catalog where submission_id = p_submission_id;
  if found then
    if nullif(btrim(coalesce(p_group_kind, '')), '') is null then
      v_kind := lower(btrim(v_existing.group_kind));
    end if;
    if v_existing.group_kind in ('event', 'resolution')
       and v_kind = lower(btrim(v_existing.group_kind))
       and v_group_id is null then
      v_group_id := v_existing.group_id;
    end if;
  end if;
  if v_kind not in ('requirement', 'resolution', 'event') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;
  if v_label is not null and length(v_label) > 160 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  select isub.id, isub.requirement_item_id, isub.original_name,
         p.created_by, p.unit_id, ri.label as item_label, d.uploaded_by
    into v_row
    from smartgov.item_submissions isub
    join smartgov.proposal_versions pv on pv.id = isub.version_id
    join smartgov.proposals p on p.id = pv.proposal_id
    join smartgov.requirement_items ri on ri.id = isub.requirement_item_id
    join smartgov.document_uploads d on d.storage_path = isub.storage_path
   where isub.id = p_submission_id
     and isub.submission_kind = 'file'
     and p.organization_id = v_account.organization_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if not (v_can_approve or v_row.created_by = v_account.id or v_row.uploaded_by = v_account.id) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if v_kind = 'requirement' then
    if v_group_id is null then
      v_group_id := v_row.requirement_item_id;
    elsif not exists (
      select 1 from smartgov.requirement_items ri
       where ri.id = v_group_id and ri.organization_id = v_account.organization_id
    ) then
      return jsonb_build_object('ok', false, 'reason', 'not_found');
    end if;
    if v_label is null then
      v_label := v_row.item_label;
    end if;
  elsif v_kind = 'resolution' then
    if v_group_id is not null and not exists (
      select 1 from smartgov.resolutions r
       where r.id = v_group_id and r.organization_id = v_account.organization_id
    ) then
      return jsonb_build_object('ok', false, 'reason', 'not_found');
    end if;
  elsif v_kind = 'event' then
    if v_group_id is not null and not exists (
      select 1 from smartgov.events e
       where e.id = v_group_id and e.organization_id = v_account.organization_id
    ) then
      return jsonb_build_object('ok', false, 'reason', 'not_found');
    end if;
  end if;

  insert into smartgov.document_catalog (
    submission_id, organization_id, title, description, keywords,
    group_kind, group_id, group_label
  ) values (
    p_submission_id, v_account.organization_id, v_title, v_desc, v_keywords,
    v_kind, v_group_id, v_label
  )
  on conflict (submission_id) do update
     set title = excluded.title,
         description = excluded.description,
         keywords = excluded.keywords,
         group_kind = excluded.group_kind,
         group_id = excluded.group_id,
         group_label = excluded.group_label,
         approval_status = 'pending',
         approval_remark = null,
         approved_by = null,
         approved_at = null,
         updated_at = now();

  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function smartgov.set_document_metadata(text, uuid, text, text, text, text, uuid, text) from public, anon, authenticated;

create or replace function public.create_unit_account(p_session_token text, p_payload jsonb)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.create_unit_account(p_session_token, p_payload); $$;
revoke all on function public.create_unit_account(text, jsonb) from public;
grant execute on function public.create_unit_account(text, jsonb) to anon, authenticated;

create or replace function public.rename_unit_account(p_session_token text, p_account_id uuid, p_display_name text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.rename_unit_account(p_session_token, p_account_id, p_display_name); $$;
revoke all on function public.rename_unit_account(text, uuid, text) from public;
grant execute on function public.rename_unit_account(text, uuid, text) to anon, authenticated;

create or replace function public.reset_unit_account_credentials(p_session_token text, p_account_id uuid, p_password text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.reset_unit_account_credentials(p_session_token, p_account_id, p_password); $$;
revoke all on function public.reset_unit_account_credentials(text, uuid, text) from public;
grant execute on function public.reset_unit_account_credentials(text, uuid, text) to anon, authenticated;

create or replace function public.resend_unit_account_credentials(p_session_token text, p_account_id uuid)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.resend_unit_account_credentials(p_session_token, p_account_id); $$;
revoke all on function public.resend_unit_account_credentials(text, uuid) from public;
grant execute on function public.resend_unit_account_credentials(text, uuid) to anon, authenticated;

create or replace function public.set_unit_account_pause(
  p_session_token text,
  p_account_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_reason text
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.set_unit_account_pause(p_session_token, p_account_id, p_starts_at, p_ends_at, p_reason); $$;
revoke all on function public.set_unit_account_pause(text, uuid, timestamptz, timestamptz, text) from public;
grant execute on function public.set_unit_account_pause(text, uuid, timestamptz, timestamptz, text) to anon, authenticated;

revoke all on function smartgov.can_approve_document(smartgov.accounts) from public;
revoke all on function smartgov.is_central_manager(smartgov.accounts) from public;

NOTIFY pgrst, 'reload schema';
