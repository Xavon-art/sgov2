-- Account permissions and workspace role resolution.
--
-- Why this exists: the brief asks for a USG Admin, a USG Officer who can be
-- granted `can_invite`, and an LSG Officer who has no permissions at all. The
-- account table already carries `account_scope` (owner = USG Admin) and
-- `smartgov.is_org_reviewer` already answers "is this person on the USG board",
-- so all that was missing was the grantable permission itself.
--
-- Why a table and not a boolean: the brief asks for a `permissions` concept, and
-- the next permission will not be `can_invite`. A check constraint keeps the
-- current vocabulary closed until that migration widens it on purpose.
--
-- House rule, unchanged: no RLS policy here, no grant on the table. Every read
-- and write goes through a `security definer` function that resolves the caller
-- from the session token. The unit a caller acts on is derived from their own
-- membership, never from a parameter the client chooses.

create table if not exists smartgov.account_permissions (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  account_id      uuid not null references smartgov.accounts (id) on delete cascade,
  permission      text not null,
  granted_by      uuid references smartgov.accounts (id) on delete set null,
  granted_at      timestamptz not null default now(),
  primary key (account_id, permission),
  constraint account_permissions_known check (permission in ('can_invite'))
);

create index if not exists account_permissions_organization_idx
  on smartgov.account_permissions (organization_id);

revoke all on smartgov.account_permissions from public, anon, authenticated;

-- ------------------------------------------------------------------- permissions of one account

create or replace function smartgov.permissions_for(
  p_account smartgov.accounts
)
returns text[]
language sql
stable
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
  select coalesce(array_agg(ap.permission order by ap.permission), array[]::text[])
    from smartgov.account_permissions ap
   where ap.account_id = p_account.id
     and ap.organization_id = p_account.organization_id;
$$;

revoke all on function smartgov.permissions_for(smartgov.accounts) from public;

-- ------------------------------------------------------------------- workspace role

-- The one call a dashboard layout needs. It answers "which workspace is this
-- person in, and what may they do" so the /usg and /lsg guards can run without
-- each layout assembling the answer from two RPCs.
--
-- `side` is 'usg' when the account is the owner or sits on the USG board, and
-- 'lsg' otherwise. A dual seat resolves to 'usg' on purpose: it is the strictly
-- larger privilege set, and the LSG membership itself is untouched, so nothing
-- is lost by holding both.
create or replace function smartgov.account_workspace_role(p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account  smartgov.accounts%rowtype;
  v_perms    text[];
  v_unit     uuid;
  v_unitname text;
  v_is_org   boolean;
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  v_perms := smartgov.permissions_for(v_account);
  v_is_org := v_account.account_scope = 'owner'
             or smartgov.is_org_reviewer(v_account.id, v_account.organization_id);

  -- `lsg_unit_ids` yields a scalar per row, not a table with an `id` column, so
  -- it has to be wrapped in a subquery before it can be ordered. That keeps the
  -- answer stable when an account holds more than one LSG seat; which one it is
  -- will get a real picker in the LSG settings slice.
  select t.u into v_unit
    from (select smartgov.lsg_unit_ids(v_account.id, v_account.organization_id) as u) t
   order by t.u
   limit 1;

  select gu.name into v_unitname
    from public.governance_units gu
   where gu.id = v_unit;

  return jsonb_build_object(
    'ok', true,
    'side', case when v_is_org then 'usg' else 'lsg' end,
    'isAdmin', v_account.account_scope = 'owner',
    'canInvite', v_account.account_scope = 'owner'
                or 'can_invite' = any (v_perms),
    'permissions', to_jsonb(v_perms),
    'unitId', v_unit,
    'unitName', v_unitname,
    'accountScope', v_account.account_scope,
    'accountKind', v_account.account_kind
  );
end;
$$;

revoke all on function smartgov.account_workspace_role(text) from public;

-- ------------------------------------------------------------------- list, grant, revoke

-- Owners see every grant in the organization. Everyone else sees only their own,
-- which is enough for the LSG shell to show "your access" without learning about
-- anybody else's.
create or replace function smartgov.list_permissions(p_session_token text)
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

  if v_account.account_scope = 'owner' then
    return jsonb_build_object(
      'ok', true,
      'scope', 'organization',
      'grants', coalesce((
        select jsonb_agg(jsonb_build_object(
          'email', a.email,
          'displayName', a.display_name,
          'permission', ap.permission,
          'grantedAt', ap.granted_at
        ) order by a.email, ap.permission)
          from smartgov.account_permissions ap
          join smartgov.accounts a on a.id = ap.account_id
         where ap.organization_id = v_account.organization_id
      ), '[]'::jsonb)
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'scope', 'self',
    'grants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'email', a.email,
        'displayName', a.display_name,
        'permission', ap.permission,
        'grantedAt', ap.granted_at
      ) order by ap.permission)
        from smartgov.account_permissions ap
        join smartgov.accounts a on a.id = ap.account_id
       where ap.account_id = v_account.id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function smartgov.list_permissions(text) from public;

create or replace function smartgov.grant_permission(
  p_session_token text,
  p_email         text,
  p_permission    text
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

  -- Only the USG Admin grants permissions. An officer holding `can_invite` may
  -- invite people but may not widen the permission set, which keeps privilege
  -- growth a one-role action.
  if v_caller.account_scope <> 'owner' then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if p_permission not in ('can_invite') then
    return jsonb_build_object('ok', false, 'reason', 'unknown_permission');
  end if;

  select a.* into v_target
    from smartgov.accounts a
   where lower(a.email) = lower(btrim(p_email))
     and a.organization_id = v_caller.organization_id
     and a.status = 'active';

  if v_target.id is null then
    return jsonb_build_object('ok', false, 'reason', 'account_not_found');
  end if;

  if v_target.account_scope = 'owner' then
    return jsonb_build_object('ok', false, 'reason', 'owner_is_always_admin');
  end if;

  insert into smartgov.account_permissions (
    organization_id, account_id, permission, granted_by
  )
  values (
    v_caller.organization_id, v_target.id, p_permission, v_caller.id
  )
  on conflict (account_id, permission)
  do update set granted_by = v_caller.id, granted_at = now();

  return jsonb_build_object('ok', true, 'email', v_target.email, 'permission', p_permission);
end;
$$;

revoke all on function smartgov.grant_permission(text, text, text) from public;

create or replace function smartgov.revoke_permission(
  p_session_token text,
  p_email         text,
  p_permission    text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_caller smartgov.accounts%rowtype;
begin
  v_caller := smartgov.authenticate(p_session_token);

  if v_caller.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if v_caller.account_scope <> 'owner' then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  delete from smartgov.account_permissions ap
   using smartgov.accounts a
   where ap.account_id = a.id
     and lower(a.email) = lower(btrim(p_email))
     and a.organization_id = v_caller.organization_id
     and ap.permission = p_permission;

  return jsonb_build_object('ok', true, 'email', btrim(p_email), 'permission', p_permission);
end;
$$;

revoke all on function smartgov.revoke_permission(text, text, text) from public;

-- ------------------------------------------------------------------- public forwarders

create or replace function public.account_workspace_role(p_session_token text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.account_workspace_role(p_session_token); $$;
revoke all on function public.account_workspace_role(text) from public;
grant execute on function public.account_workspace_role(text) to anon, authenticated;

create or replace function public.list_permissions(p_session_token text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.list_permissions(p_session_token); $$;
revoke all on function public.list_permissions(text) from public;
grant execute on function public.list_permissions(text) to anon, authenticated;

create or replace function public.grant_permission(p_session_token text, p_email text, p_permission text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.grant_permission(p_session_token, p_email, p_permission); $$;
revoke all on function public.grant_permission(text, text, text) from public;
grant execute on function public.grant_permission(text, text, text) to anon, authenticated;

create or replace function public.revoke_permission(p_session_token text, p_email text, p_permission text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.revoke_permission(p_session_token, p_email, p_permission); $$;
revoke all on function public.revoke_permission(text, text, text) from public;
grant execute on function public.revoke_permission(text, text, text) to anon, authenticated;