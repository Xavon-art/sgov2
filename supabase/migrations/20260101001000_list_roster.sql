-- The roster list for the seat-assignment picker.
--
-- The roster is only writable through invites and there is exactly one row per
-- person per organization, so without this function an officer could not be
-- moved from one seat to another: re-inviting the same email would collide
-- with the `roster_one_row_per_email` index, and the client has no other way
-- to learn an existing person's `roster_id`.
--
-- Owner-only, like every write-side function in 00800: the founding-member row
-- is the proof of authorship, and an organization id is never supplied by the
-- caller. An LSG officer never sees the roster at all because their own scope
-- does not extend past the chart rows that name them.

create or replace function smartgov.list_roster(p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account  smartgov.accounts%rowtype;
  v_is_owner boolean := false;
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if v_account.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;

  select exists (
    select 1 from public.organization_members m
    where m.organization_id = v_account.organization_id
      and m.email = v_account.email
      and m.is_founding
  ) into v_is_owner;

  if not v_is_owner then
    return jsonb_build_object('ok', false, 'reason', 'not_organization_founder');
  end if;

  return jsonb_build_object(
    'ok', true,
    'roster', (
      select coalesce(jsonb_agg(t.r order by t.full_name), '[]'::jsonb)
      from (
        select jsonb_build_object(
          'rosterId', r.id,
          'fullName', r.full_name,
          'email',    r.email
        ) as r
        from smartgov.roster r
        where r.organization_id = v_account.organization_id
      ) t
    )
  );
end;
$$;

revoke all on function smartgov.list_roster(text) from public;

create or replace function public.list_roster(p_session_token text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.list_roster(p_session_token); $$;

revoke all on function public.list_roster(text) from public;
grant execute on function public.list_roster(text) to anon, authenticated;