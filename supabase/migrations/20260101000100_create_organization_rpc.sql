-- SmartGov: single atomic write path for organization creation.
--
-- Why this exists instead of a plain `anon` INSERT policy:
-- on this project's Postgres a bare `FOR INSERT ... WITH CHECK (true)` policy
-- is still rejected at runtime ("new row violates row-level security policy"),
-- and the only shape that does admit the row is `FOR ALL ... USING (true)`,
-- which would hand the publishable key full read/update/delete on every table.
-- Rather than weaken the tables, creation goes through a SECURITY DEFINER
-- function owned by `postgres`, which bypasses RLS by design.
--
-- Resulting posture:
--   * RLS stays enabled on all four tables with ZERO policies, so `anon` has
--     no direct access to any of them.
--   * `anon` may only EXECUTE this one function, which validates its input and
--     writes the organization, its founding member, and its governance units in
--     a single transaction (the previous three-request flow could leave an
--     organization row behind when a later insert failed).
--   * Server-side collision handling keeps `slug` and `charter_number` unique
--     even when two students create identically named councils.

-- ---------------------------------------------------------------- policies
-- Remove the insert policies from 20260101000000_init_smartgov.sql (both the
-- original names and the FOR ALL variants) so the tables are fully locked down.
drop policy if exists "anon may create organizations"       on public.organizations;
drop policy if exists "anon may create members"             on public.organization_members;
drop policy if exists "anon may create organization_members" on public.organization_members;
drop policy if exists "anon may create units"               on public.governance_units;
drop policy if exists "anon may create governance_units"     on public.governance_units;

-- Defence in depth: RLS with no policies already denies everything, but drop
-- the table grants too so there is no second thing to get wrong later.
revoke all on table public.organizations       from anon;
revoke all on table public.organization_members from anon;
revoke all on table public.governance_units     from anon;
revoke all on table public.submissions          from anon;

-- ---------------------------------------------------------------- function
create or replace function public.create_organization(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
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
    lower(btrim(p_payload ->> 'officerEmail')),
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

-- Only the function is reachable; the tables stay closed.
revoke all on function public.create_organization(jsonb) from public;
grant execute on function public.create_organization(jsonb) to anon, authenticated;
