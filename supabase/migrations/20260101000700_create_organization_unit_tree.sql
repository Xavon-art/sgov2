-- SmartGov: write the unit tree when a federated organization is created.
--
-- A full replacement of the function in 00400, carried over whole so that
-- migration's hardening survives: the rate limit is charged before any write,
-- `slug` and `charter_number` still disambiguate rather than fail, and the
-- raised messages still name the fields that were rejected.
--
-- What changes is the org chart. Today a federated organization gets whichever
-- units the client happened to send, named whatever the client called them,
-- with a flat `parentIndex` array to describe the tree. That put the structure
-- of a university in a browser payload and left the database with no way to
-- know which units exist. A USG now declares its colleges, campuses, and
-- departments, and this function writes the USG row and then one child per
-- declaration. The `usg` root is derived rather than declared, so a client
-- cannot omit it, and every federated organization ends up with the same
-- one-level shape the rest of the design assumes. This is a narrowing rather
-- than an addition: 00400 could already write an N-row tree, and this removes
-- the ability to write a deeper one, on purpose, because a permission model
-- that is provably two levels is worth more here than an arbitrary tree the
-- scoping rules would then have to reason about.
--
-- TWO PAYLOAD SHAPES, ON PURPOSE. The unit type is read as
-- `coalesce(unit ->> 'type', unit ->> 'unitType')`, and a federated payload
-- containing no `college`/`campus`/`department` element is treated as the
-- legacy shape: one `usg` root row and no children, with no error. That is the
-- shape the deployed client sends today -- `[{ name, unitType: "usg" }]` -- and
-- raising on it would roll back every federated signup the moment this
-- migration is applied, which is the wrong order to break production in. The
-- legacy branch is a rollout affordance, not a second permanent contract: it
-- exists only because the client and the database cannot be deployed in one
-- atomic step, and it should be deleted once `submit.ts` only ever sends
-- `type`. Do not extend it, and do not read it as a supported input shape.
--
-- The unit-name duplicate check is new rather than extended. There was never
-- one: 00400 validated that `units[].name` was non-empty and nothing else, and
-- the collisions it did handle were on the organization's own `slug` and
-- `charter_number`, which it disambiguates instead of rejecting. This one
-- rejects, because two identically named units in one chart is a data-entry
-- mistake the wizard already catches and the database should agree with rather
-- than silently store. It compares the incoming names against each other; the
-- organization is created moments earlier, so there is nothing pre-existing in
-- `governance_units` to compare them to.

create or replace function public.create_organization(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_org_id     uuid;
  v_root_id    uuid;
  v_charter    text;
  v_slug       text;
  v_name       text;
  v_model      public.governance_model;
  v_units      jsonb;
  v_unit       jsonb;
  v_unit_count integer := 0;
  -- Whether at least one element declares a child tier. False means the
  -- payload is the legacy shape; see the note at the top of this file.
  v_children   boolean := false;
  v_missing    text;
  v_bad_name   text;
  v_bad_type   text;
  v_dupes      text;
  v_email      text;
begin
  -- ROLLOUT: this body accepts two payload shapes, and the branch that handles
  -- the older one is deliberately temporary. The per-element type is
  -- `coalesce(type, unitType)`; a federated payload with no
  -- `college`/`campus`/`department` element anywhere is read as the legacy
  -- shape and gets the single `usg` root row that the deployed client works
  -- with today, rather than a raised 22023. The client that sends the new
  -- `{name, type}` shape is a later change, and this migration must be safe to
  -- apply on either side of it -- before it, after it, or in between. When the
  -- client only ever sends `type`, delete the legacy branch below and make the
  -- `v_children` check an unconditional validation. Anyone tightening this
  -- function by removing the fallback is reintroducing a landmine for a client
  -- that is still in production.
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

  -- The `usg` root row is named after the organization, and the unitary
  -- `council` row likewise, so the name is bound once and used for both the
  -- organization and its single unit.
  v_name := btrim(p_payload ->> 'organizationName');

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
    v_name,
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
  v_units := coalesce(p_payload -> 'units', '[]'::jsonb);
  if jsonb_typeof(v_units) <> 'array' then
    raise exception 'units must be a JSON array' using errcode = '22023';
  end if;

  -- Only federated reads `units`. A unitary organization has no local tier, so
  -- its single `council` row is derived from the organization name and the
  -- array is never inspected -- which is what lets the deployed unitary payload
  -- (`unitType: "council"`, not a value in the child-tier allowlist below) keep
  -- working, and lets a unitary client send nothing at all.
  if v_model = 'federated' then
    if jsonb_array_length(v_units) = 0 then
      raise exception 'At least one governance unit is required'
        using errcode = '22023';
    end if;

    v_bad_name := (
      select string_agg(coalesce(btrim(e.value ->> 'name'), ''), ', ')
      from jsonb_array_elements(v_units) as e(value)
      where coalesce(btrim(e.value ->> 'name'), '') = ''
    );

    if v_bad_name is not null then
      raise exception 'units[].name is required' using errcode = '22023';
    end if;

    -- The shape discriminator. A federated payload that declares no child tier
    -- at all is the legacy one, and there is nothing in it to validate -- see
    -- the ROLLOUT note above. Once this is true, every element is checked,
    -- including one that arrives under `unitType`, because a payload mixing the
    -- two keys is malformed rather than legacy.
    v_children := exists (
      select 1
      from jsonb_array_elements(v_units) as e(value)
      where coalesce(e.value ->> 'type', e.value ->> 'unitType', '')
            in ('college', 'campus', 'department')
    );

    -- Cast through the enum rather than interpolating, so a type the enum does
    -- not contain fails the whole transaction instead of inserting a unit that
    -- no query can match. The allowlist turns what would be a bare 22P02 into
    -- a message the API can show, and the index is named because "college or
    -- campus or department" is not enough to find the offending row in a list
    -- the client cannot see the index of.
    if v_children then
      v_bad_type := (
        select string_agg(
                 format('units[%s] = %s', e.ordinality - 1,
                        coalesce(e.value ->> 'type', e.value ->> 'unitType', '')),
                 ', ' order by e.ordinality)
        from jsonb_array_elements(v_units) with ordinality as e(value, ordinality)
        where coalesce(e.value ->> 'type', e.value ->> 'unitType', '')
              not in ('college', 'campus', 'department')
      );

      if v_bad_type is not null then
        raise exception 'units[].type must be college, campus, or department: %',
          v_bad_type using errcode = '22023';
      end if;
    end if;

    v_dupes := (
      select string_agg(name, ', ')
      from (
        select btrim(e.value ->> 'name') as name
        from jsonb_array_elements(v_units) as e(value)
        group by btrim(e.value ->> 'name')
        having count(*) > 1
      ) duplicates
    );

    if v_dupes is not null then
      raise exception 'Duplicate governance unit name(s): %', v_dupes
        using errcode = '22023';
    end if;
  end if;

  -- Federated: the USG row is the root, and every declared college, campus,
  -- or department hangs off it as its Local Student Government. Depth is one;
  -- `parent_id` stays in the schema for a future that needs more, but nothing
  -- writes a second level yet. The legacy payload gets the root alone, which is
  -- exactly what 00400 produced for the client that is deployed today.
  v_root_id := null;

  if v_model = 'federated' then
    insert into public.governance_units (organization_id, name, unit_type, parent_id)
    values (v_org_id, v_name, 'usg', null)
    returning id into v_root_id;

    v_unit_count := 1;

    if v_children then
      for v_unit in
        select jsonb_array_elements(coalesce(v_units, '[]'::jsonb))
      loop
        insert into public.governance_units (organization_id, name, unit_type, parent_id)
        values (
          v_org_id,
          btrim(v_unit ->> 'name'),
          coalesce(v_unit ->> 'type', v_unit ->> 'unitType')::public.unit_type,
          v_root_id
        );

        v_unit_count := v_unit_count + 1;
      end loop;
    end if;
  else
    -- Unitary: one council, no children, and nothing to declare.
    insert into public.governance_units (organization_id, name, unit_type, parent_id)
    values (v_org_id, v_name, 'council', null);

    v_unit_count := 1;
  end if;

  return jsonb_build_object(
    'organizationId', v_org_id,
    'charterNumber', v_charter,
    'slug', v_slug,
    'unitCount', v_unit_count
  );
end;
$$;

-- `search_path` still names `extensions` for the reason 00400 gave: the
-- rate-limit call resolves `consume_rate_limit` in the `smartgov` schema, and a
-- future pgcrypto call in this body would otherwise fail the way `login_account`
-- did in 003. This project installs pgcrypto into `extensions`, not `public`.

revoke all on function public.create_organization(jsonb) from public;
grant execute on function public.create_organization(jsonb) to anon, authenticated;
