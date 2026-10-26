-- 03090 -- Organization profile customization (accent, theme, logo).

alter table public.organizations add column if not exists theme text not null default 'light'
  check (theme in ('light', 'dark'));
alter table public.organizations add column if not exists logo_url text;

create or replace function smartgov.update_org_profile(
  p_session_token text,
  p_accent text,
  p_theme text,
  p_logo_url text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_theme text;
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

  v_theme := coalesce(nullif(trim(p_theme), ''), 'light');
  if v_theme not in ('light', 'dark') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  update public.organizations
     set accent = coalesce(nullif(trim(p_accent), ''), accent),
         theme = v_theme,
         logo_url = nullif(trim(coalesce(p_logo_url, '')), '')
   where id = v_account.organization_id;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function smartgov.update_org_profile(text, text, text, text) from public;

create or replace function public.update_org_profile(p_session_token text, p_accent text, p_theme text, p_logo_url text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.update_org_profile(p_session_token, p_accent, p_theme, p_logo_url); $$;
revoke all on function public.update_org_profile(text, text, text, text) from public;
grant execute on function public.update_org_profile(text, text, text, text) to anon, authenticated;

-- Redefine account_workspace to expose theme + logoUrl.
create or replace function smartgov.account_workspace(p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_org    public.organizations%rowtype;
  v_total  bigint;
  v_pending bigint;
  v_active bigint;
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if v_account.organization_id is not null then
    select * into v_org
    from public.organizations o
    where o.id = v_account.organization_id;
  end if;

  select
    count(*),
    count(*) filter (where status = 'pending'),
    count(*) filter (where status = 'activated')
  into v_total, v_pending, v_active
  from smartgov.invites i
  where i.organization_id = v_account.organization_id
    and i.status <> 'revoked';

  return jsonb_build_object(
    'ok', true,
    'email', v_account.email,
    'displayName', v_account.display_name,
    'accountKind', v_account.account_kind,
    'accountScope', v_account.account_scope,
    'universityName', coalesce(v_org.university_name, v_account.university_name),
    'campusName', v_account.campus_name,
    'organizationName', coalesce(v_org.name, ''),
    'charterNumber', coalesce(v_org.charter_number, ''),
    'academicYear', coalesce(v_org.academic_year, ''),
    'accent', coalesce(v_org.accent, '#16324f'),
    'theme', coalesce(v_org.theme, 'light'),
    'logoUrl', v_org.logo_url,
    'governanceModel', v_org.governance_model,
    'inviteCount', v_total,
    'pendingCount', v_pending,
    'activatedCount', v_active,
    'recentlyApproved',
      (v_account.account_scope = 'owner'
       and v_account.activated_at is not null
       and v_account.activated_at > now() - interval '15 minutes')
  );
end;
$$;

revoke all on function smartgov.account_workspace(text) from public;