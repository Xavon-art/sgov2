-- 03270 -- Officer profile fields and controlled read/update.
--
-- These four fields describe the person holding the account, not how they sign
-- in or what they may do. They live on `smartgov.accounts` beside the identity
-- fields, but the only way in or out is the three functions below: every one of
-- them resolves the caller from the session token inside a SECURITY DEFINER
-- body. No client can name a target account, organization, unit, email or role,
-- and no direct table grant or RLS policy is introduced here.

alter table smartgov.accounts
  add column if not exists full_name          text,
  add column if not exists campus_department  text,
  add column if not exists program            text,
  add column if not exists position           text;

-- ---------------------------------------------------------------- own profile

create or replace function smartgov.get_officer_profile(p_session_token text)
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
  if v_account.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;

  return jsonb_build_object(
    'ok', true,
    'profile', jsonb_build_object(
      'fullName', coalesce(v_account.full_name, ''),
      'campusDepartment', coalesce(v_account.campus_department, ''),
      'program', coalesce(v_account.program, ''),
      'position', coalesce(v_account.position, '')
    )
  );
end;
$$;

revoke all on function smartgov.get_officer_profile(text) from public;

-- ------------------------------------------------------------- roster by USG

-- Only the USG side may read the officer fields of everybody in the federation.
-- `is_usg_side` is the same server-resolved role test the other USG-only reads
-- use, so an LSG officer cannot widen this by calling the function directly.
create or replace function smartgov.list_officer_profiles(p_session_token text)
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
  if v_account.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;
  if not smartgov.is_usg_side(v_account) or v_account.account_scope <> 'owner' then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  return jsonb_build_object(
    'ok', true,
    'rows', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'accountId', a.id,
          'fullName', coalesce(a.full_name, ''),
          'campusDepartment', coalesce(a.campus_department, ''),
          'program', coalesce(a.program, ''),
          'position', coalesce(a.position, ''),
          'email', a.email,
          'displayName', coalesce(a.display_name, ''),
          'role', a.account_scope::text,
          'status', a.status::text
        ) order by a.display_name nulls last, a.email
      )
      from smartgov.accounts a
      where a.organization_id = v_account.organization_id
        and a.account_scope = 'invited'
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function smartgov.list_officer_profiles(text) from public;

-- ------------------------------------------------------------------- own edit

-- There is deliberately no account id parameter. An officer can only ever edit
-- the row the session resolves to; email, role, organization and status are not
-- among the arguments, so they cannot be changed through this surface.
create or replace function smartgov.update_officer_profile(
  p_session_token text,
  p_full_name text,
  p_campus_department text,
  p_program text,
  p_position text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_full_name text         := btrim(coalesce(p_full_name, ''));
  v_campus_department text := btrim(coalesce(p_campus_department, ''));
  v_program text           := btrim(coalesce(p_program, ''));
  v_position text          := btrim(coalesce(p_position, ''));
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if v_account.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;
  if length(v_full_name) > 200
     or length(v_campus_department) > 200
     or length(v_program) > 200
     or length(v_position) > 200 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_officer_field');
  end if;

  update smartgov.accounts a
     set full_name         = v_full_name,
         campus_department = v_campus_department,
         program           = v_program,
         position          = v_position
   where a.id = v_account.id
     and a.organization_id = v_account.organization_id;

  return jsonb_build_object(
    'ok', true,
    'profile', jsonb_build_object(
      'fullName', v_full_name,
      'campusDepartment', v_campus_department,
      'program', v_program,
      'position', v_position
    )
  );
end;
$$;

revoke all on function smartgov.update_officer_profile(text, text, text, text, text) from public;

-- ---------------------------------------------------------- public wrappers

create or replace function public.get_officer_profile(p_session_token text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.get_officer_profile(p_session_token); $$;
revoke all on function public.get_officer_profile(text) from public;
grant execute on function public.get_officer_profile(text) to anon, authenticated;

create or replace function public.list_officer_profiles(p_session_token text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.list_officer_profiles(p_session_token); $$;
revoke all on function public.list_officer_profiles(text) from public;
grant execute on function public.list_officer_profiles(text) to anon, authenticated;

create or replace function public.update_officer_profile(
  p_session_token text,
  p_full_name text,
  p_campus_department text,
  p_program text,
  p_position text
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.update_officer_profile(p_session_token, p_full_name, p_campus_department, p_program, p_position); $$;
revoke all on function public.update_officer_profile(text, text, text, text, text) from public;
grant execute on function public.update_officer_profile(text, text, text, text, text) to anon, authenticated;
