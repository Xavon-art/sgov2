create or replace function smartgov.structure_session_id(p_session_token text)
returns uuid
language sql
stable
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
  select s.id
    from smartgov.sessions s
    join smartgov.accounts a on a.id = s.account_id
   where s.token_hash = smartgov.sha256(p_session_token)
     and s.expires_at > now()
     and a.status = 'active'
$$;

revoke all on function smartgov.structure_session_id(text) from public;

create or replace function smartgov.persist_structure_holder_photo(
  p_session_token uuid,
  p_unit_id       uuid,
  p_email         text,
  p_photo         text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account  smartgov.accounts%rowtype;
  v_access   jsonb;
  v_email    text := lower(btrim(coalesce(p_email, '')));
  v_photo    bytea;
  v_hex      text;
  v_mime     text := 'image/jpeg';
  v_roster   uuid;
begin
  select a.* into v_account
    from smartgov.sessions s
    join smartgov.accounts a on a.id = s.account_id
   where s.id = p_session_token
     and s.expires_at > now()
     and a.status = 'active';

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if v_account.organization_id is null or p_unit_id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  v_access := smartgov.gov_unit_access(v_account, p_unit_id);
  if not (v_access->>'canEdit')::boolean then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if v_email = '' or coalesce(p_photo, '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  begin
    v_photo := decode(p_photo, 'base64');
  exception when others then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end;

  if length(v_photo) = 0 or length(v_photo) > 524288 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  select r.id into v_roster
    from smartgov.roster r
   where r.organization_id = v_account.organization_id
     and lower(r.email) = v_email;

  if v_roster is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  perform smartgov.gov_persist_holder_photo(
    v_account.organization_id,
    jsonb_build_object('email', v_email, 'photo', p_photo));

  v_hex := encode(v_photo, 'hex');
  if starts_with(v_hex, '89504e47') then
    v_mime := 'image/png';
  elsif starts_with(v_hex, '52494646') then
    v_mime := 'image/webp';
  end if;

  update smartgov.roster r
     set photo_mime = v_mime
   where r.id = v_roster;

  return jsonb_build_object(
    'ok', true,
    'hasPhoto', true,
    'rosterId', v_roster);
end;
$$;

revoke all on function smartgov.persist_structure_holder_photo(uuid, uuid, text, text) from public;

create or replace function public.persist_structure_holder_photo(
  p_session_token text,
  p_unit_id       uuid,
  p_email         text,
  p_photo         text
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
  select smartgov.persist_structure_holder_photo(
    smartgov.structure_session_id(p_session_token), p_unit_id, p_email, p_photo);
$$;

revoke all on function public.persist_structure_holder_photo(text, uuid, text, text) from public;
grant execute on function public.persist_structure_holder_photo(text, uuid, text, text) to anon, authenticated;

create or replace function smartgov.show_structure_holder_photo(
  p_session_token uuid,
  p_unit_id       uuid,
  p_email         text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account  smartgov.accounts%rowtype;
  v_access   jsonb;
  v_email    text := lower(btrim(coalesce(p_email, '')));
  v_reviewer boolean;
  v_people   uuid[];
  v_roster   uuid;
  v_oid      oid;
  v_mime     text;
  v_bytes    bytea;
  v_allowed  boolean := false;
begin
  select a.* into v_account
    from smartgov.sessions s
    join smartgov.accounts a on a.id = s.account_id
   where s.id = p_session_token
     and s.expires_at > now()
     and a.status = 'active';

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if v_account.organization_id is null or p_unit_id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  v_access := smartgov.gov_unit_access(v_account, p_unit_id);
  if not (v_access->>'canRead')::boolean then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if v_email = '' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  v_reviewer := v_account.account_scope = 'owner'
             or smartgov.is_org_reviewer(v_account.id, v_account.organization_id);
  v_people := smartgov.gov_people_unit_ids(v_account);

  select r.id, r.photo_oid, r.photo_mime into v_roster, v_oid, v_mime
    from smartgov.roster r
   where r.organization_id = v_account.organization_id
     and lower(r.email) = v_email;

  if v_roster is null then
    return jsonb_build_object('ok', true, 'base64', null, 'mime', null);
  end if;

  if v_reviewer then
    v_allowed := true;
  else
    select exists (
      select 1
        from smartgov.unit_memberships m
       where m.roster_id = v_roster
         and m.end_date is null
         and m.unit_id = any (v_people)
    ) into v_allowed;
  end if;

  if not v_allowed then
    return jsonb_build_object('ok', true, 'base64', null, 'mime', null);
  end if;

  if v_oid is null then
    return jsonb_build_object('ok', true, 'base64', null, 'mime', null);
  end if;

  v_bytes := lo_get(v_oid);

  return jsonb_build_object(
    'ok', true,
    'base64', regexp_replace(encode(v_bytes, 'base64'), E'\n', '', 'g'),
    'mime', coalesce(v_mime, 'image/jpeg'));
exception
  when undefined_object then
    return jsonb_build_object('ok', true, 'base64', null, 'mime', null);
end;
$$;

revoke all on function smartgov.show_structure_holder_photo(uuid, uuid, text) from public;

create or replace function public.show_structure_holder_photo(
  p_session_token text,
  p_unit_id       uuid,
  p_email         text
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
  select smartgov.show_structure_holder_photo(
    smartgov.structure_session_id(p_session_token), p_unit_id, p_email);
$$;

revoke all on function public.show_structure_holder_photo(text, uuid, text) from public;
grant execute on function public.show_structure_holder_photo(text, uuid, text) to anon, authenticated;

notify pgrst, 'reload schema';
