-- 03120 -- List accounts in the organization for messaging recipients.

create or replace function smartgov.list_org_accounts(p_session_token text)
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
    'accounts', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', a.id,
          'email', a.email,
          'displayName', a.display_name,
          'accountKind', a.account_kind,
          'accountScope', a.account_scope
        ) order by a.display_name nulls last, a.email
      )
      from smartgov.accounts a
      where a.organization_id = v_account.organization_id
        and a.id <> v_account.id
        and a.status = 'active'
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function smartgov.list_org_accounts(text) from public;

create or replace function public.list_org_accounts(p_session_token text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.list_org_accounts(p_session_token); $$;
revoke all on function public.list_org_accounts(text) from public;
grant execute on function public.list_org_accounts(text) to anon, authenticated;