-- SmartGov: rate limit and tighten organization creation.
--
-- Two changes to `public.create_organization`, both found by exercising the
-- function directly through PostgREST rather than through the app.
--
-- 1. RATE LIMITING. Every other write in the app consults
--    `smartgov.consume_rate_limit` inside the function that does the writing, so
--    the ceiling holds for a caller holding the publishable key and going
--    straight to PostgREST -- which never touches the Next.js route handlers.
--    `create_organization` was the one exception: it had no limit in either
--    layer, so anyone with the anon key could create organizations without
--    limit. The per-IP limiter in `src/lib/rate-limit.ts` bounds a single host,
--    but it is per instance and is stepped around entirely by calling PostgREST
--    directly, so the binding limit has to live here.
--
-- 2. AT LEAST ONE GOVERNANCE UNIT. `units: []` was accepted, producing an
--    organization with no org chart and a dashboard that can never show
--    anything. The route handler rejects it, but PostgREST does not go through
--    the route handler, so the database has to. This is the shape of the
--    pre-existing `lalalalla` row, which has no members and no units.
--
-- Same function body otherwise, including the collision handling, because this
-- is a `create or replace` and must stay signature- and behaviour-compatible
-- with what the app already calls.

create or replace function public.create_organization(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_org_id     uuid;
  v_unit_id    uuid;
  v_charter    text;
  v_slug       text;
  v_model      public.governance_model;
  v_units      jsonb;
  v_item       jsonb;
  v_ids        uuid[] := '{}'::uuid[];
  v_parent     uuid;
  v_parent_idx int;
  v_missing    text;
  v_email      text;
begin
  -- ------------------------------------------------------------- validate
  v_missing := (
    select string_agg(field, ', ')
    from unnest(array[
      'organizationName', 'governanceModel', 'academicYear', 'universityName',
      'charterNumber', 'officerName', 'officerEmail', 'officerRole'
    ]) as field
    where coalesce(btrim(p_payload ->> field), '') = ''
  );

  if v_missing is not null then
    raise exception 'Missing required field(s): %', v_missing
      using errcode = '22023';
  end if;

  begin
    v_model := (p_payload ->> 'governanceModel')::public.governance_model;
  exception when invalid_text_representation then
    raise exception 'Invalid governance model: %', p_payload ->> 'governanceModel'
      using errcode = '22023';
  end;

  v_email := lower(trim(p_payload ->> 'officerEmail'));

  -- Charged before any write, and keyed on the officer address as well as
  -- globally: the per-address ceiling stops one mailbox creating a stream of
  -- councils, and the global one bounds the volume regardless of how many
  -- addresses a caller rotates through. Both are windowed, so a determined
  -- caller can still average 2 per hour, which is the intent -- a real student
  -- council sets up once.
  if not smartgov.consume_rate_limit(
       'org:email:' || v_email, 3, interval '1 hour')
     or not smartgov.consume_rate_limit(
       'org:global', 200, interval '1 hour') then
    raise exception 'Too many organizations created. Please try again later.'
      using errcode = 'P0001';
  end if;

  -- ---------------------------------------------------------- identifiers
  -- Identically named councils are common, so never fail on a collision;
  -- disambiguate instead and report the final values back to the client.
  v_slug := left(
    coalesce(nullif(btrim(p_payload ->> 'slug'), ''), 'student-organization'),
    48
  );
  if exists (select 1 from public.organizations o where o.slug = v_slug) then
    v_slug := v_slug || '-' || substr(md5(random()::text), 1, 6);
  end if;

  v_charter := left(btrim(p_payload ->> 'charterNumber'), 64);
  if exists (select 1 from public.organizations o where o.charter_number = v_charter) then
    v_charter := v_charter || '-' || substr(md5(random()::text), 1, 4);
  end if;

  -- ------------------------------------------------------ org + founding member
  insert into public.organizations (
    slug, name, description, governance_model, status, charter_number,
    academic_year, accent, university_name, campus_name, college, seal_name
  )
  values (
    v_slug,
    btrim(p_payload ->> 'organizationName'),
    nullif(btrim(coalesce(p_payload ->> 'description', '')), ''),
    v_model,
    'active',
    v_charter,
    btrim(p_payload ->> 'academicYear'),
    coalesce(nullif(btrim(coalesce(p_payload ->> 'accent', '')), ''), '#16324f'),
    btrim(p_payload ->> 'universityName'),
    case when v_model = 'federated'
      then nullif(btrim(coalesce(p_payload ->> 'campusName', '')), '') end,
    case when v_model = 'federated'
      then nullif(btrim(coalesce(p_payload ->> 'college', '')), '') end,
    nullif(btrim(coalesce(p_payload ->> 'sealName', '')), '')
  )
  returning id into v_org_id;

  insert into public.organization_members (
    organization_id, full_name, email, role, is_founding
  )
  values (
    v_org_id,
    btrim(p_payload ->> 'officerName'),
    v_email,
    (p_payload ->> 'officerRole')::public.member_role,
    true
  );

  -- ------------------------------------------------------------- org chart
  -- Each unit may carry a zero-based `parentIndex` pointing at an earlier entry
  -- in the same array, which keeps the self-referencing tree flat on the wire.
  v_units := coalesce(p_payload -> 'units', '[]'::jsonb);
  if jsonb_typeof(v_units) <> 'array' then
    raise exception 'units must be a JSON array' using errcode = '22023';
  end if;

  if jsonb_array_length(v_units) = 0 then
    raise exception 'At least one governance unit is required'
      using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(v_units)
  loop
    if coalesce(btrim(v_item ->> 'name'), '') = '' then
      raise exception 'units[].name is required' using errcode = '22023';
    end if;

    v_parent_idx := nullif(v_item ->> 'parentIndex', '')::int;
    v_parent := null;

    if v_parent_idx is not null then
      if v_parent_idx < 0
         or v_parent_idx >= coalesce(array_length(v_ids, 1), 0) then
        raise exception 'units[].parentIndex % does not reference an earlier unit',
          v_parent_idx using errcode = '22023';
      end if;
      v_parent := v_ids[v_parent_idx + 1];
    end if;

    insert into public.governance_units (
      organization_id, parent_id, name, unit_type
    )
    values (
      v_org_id,
      v_parent,
      btrim(v_item ->> 'name'),
      (v_item ->> 'unitType')::public.unit_type
    )
    returning id into v_unit_id;

    v_ids := v_ids || v_unit_id;
  end loop;

  return jsonb_build_object(
    'organizationId', v_org_id,
    'charterNumber', v_charter,
    'slug', v_slug,
    'unitCount', coalesce(array_length(v_ids, 1), 0)
  );
end;
$$;

-- `search_path` now names `extensions` because the rate-limit call above
-- resolves `consume_rate_limit` in the `smartgov` schema, and a future pgcrypto
 -- call in this body would otherwise fail the same way `login_account` did in
-- 003: this project installs pgcrypto into `extensions`, not `public`.

revoke all on function public.create_organization(jsonb) from public;
grant execute on function public.create_organization(jsonb) to anon, authenticated;
