-- The caller's own university and campus.
--
-- The federation's profile screen showed the account's `university_name` and
-- `campus_name` read-only. On the LSG side those two fields are the only place a
-- campus or college can say who it is: the unit name in `governance_units` is
-- the seat, and the organisation row is the whole university. Neither is
-- correct for the top-right badge on a campus or college workspace.
--
-- This is deliberately account-scoped. Editing your own university does not
-- rename the organisation, and renaming an organisation stays owner-only through
-- `update_org_profile`. The value here is a per-person label for the dashboard
-- chrome, and the badge falls back to the unit name when it is empty.

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

  if length(v_university) not between 2 and 160 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_identity');
  end if;

  if length(v_campus) > 160 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_identity');
  end if;

  update smartgov.accounts
     set university_name = v_university,
         campus_name = v_campus
   where id = v_account.id;

  return jsonb_build_object(
    'ok', true,
    'universityName', v_university,
    'campusName', v_campus);
end;
$$;

revoke all on function smartgov.update_my_identity(text, text, text) from public;

create or replace function public.update_my_identity(
  p_session_token text,
  p_university_name text,
  p_campus_name text
)
returns jsonb language sql security definer
set search_path = public, smartgov, pg_temp
as $$
  select smartgov.update_my_identity(p_session_token, p_university_name, p_campus_name);
$$;

revoke all on function public.update_my_identity(text, text, text) from public;
grant execute on function public.update_my_identity(text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
