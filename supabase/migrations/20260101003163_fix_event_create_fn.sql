-- 03163 -- guard event file payloads and cast the unit enum before lower().

create or replace function smartgov.create_event_v2(
  p_session_token text,
  p_title text,
  p_description text,
  p_event_date date,
  p_event_time time,
  p_timezone text,
  p_venue text,
  p_scope text,
  p_unit_ids uuid[],
  p_unit_types text[],
  p_files jsonb,
  p_link_request uuid,
  p_claim_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account  smartgov.accounts%rowtype;
  v_usg      boolean;
  v_unit     uuid;
  v_id       uuid;
  v_scope    text := lower(trim(coalesce(p_scope, 'university')));
  v_file     jsonb;
  v_target   uuid;
  v_type     text;
  v_kind     text;
  v_title    text;
  v_body     text;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if v_account.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;
  if p_title is null or length(btrim(p_title)) < 3 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_title');
  end if;
  if p_event_date is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  v_usg := smartgov.is_usg_side(v_account);
  v_unit := smartgov.my_lsg_unit(v_account);

  if not v_usg and v_unit is null then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if v_scope = 'org' then v_scope := 'university'; end if;
  if v_usg and v_scope not in ('university', 'unit_type', 'units', 'unit') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  -- An LSG can only add an event for its own unit; it cannot mint a
  -- university-wide event or one for a sibling.
  if not v_usg then
    v_scope := 'unit';
  end if;

  if p_link_request is not null then
    if not exists (
      select 1 from smartgov.personal_requests r
       where r.id = p_link_request
         and r.status = 'granted'
         and (v_usg or r.unit_id = v_unit)
    ) then
      return jsonb_build_object('ok', false, 'reason', 'invalid_request');
    end if;
  end if;

  insert into smartgov.events (
    organization_id, created_by, title, description, event_date, event_time,
    event_timezone, venue, scope, unit_id, status, honor_status, source,
    support_files, claim_note, linked_request
  )
  values (
    v_account.organization_id,
    v_account.id,
    btrim(p_title),
    nullif(btrim(coalesce(p_description, '')), ''),
    p_event_date,
    p_event_time,
    nullif(btrim(coalesce(p_timezone, '')), ''),
    nullif(btrim(coalesce(p_venue, '')), ''),
    v_scope,
    case when v_scope = 'unit' then coalesce(v_unit, p_unit_ids[1]) else null end,
    case when v_usg then 'upcoming' else 'claimed' end,
    case when v_usg then 'honored' else 'pending' end,
    case when v_usg then 'usg' else 'lsg' end,
    coalesce(p_files, '[]'::jsonb),
    nullif(btrim(coalesce(p_claim_note, '')), ''),
    p_link_request
  )
  returning id into v_id;

  -- Scope rows.
  if v_scope = 'unit_type' then
    foreach v_type in array coalesce(p_unit_types, '{}'::text[]) loop
      insert into smartgov.event_scopes (event_id, unit_type) values (v_id, lower(v_type));
    end loop;
  elsif v_scope = 'units' then
    foreach v_target in array coalesce(p_unit_ids, '{}'::uuid[]) loop
      if exists (
        select 1 from public.governance_units u
         where u.id = v_target and u.organization_id = v_account.organization_id
      ) then
        insert into smartgov.event_scopes (event_id, unit_id) values (v_id, v_target);
      end if;
    end loop;
  elsif v_scope = 'unit' and coalesce(v_unit, p_unit_ids[1]) is not null then
    insert into smartgov.event_scopes (event_id, unit_id)
    values (v_id, coalesce(v_unit, p_unit_ids[1]));
  end if;

  -- Support links, stored twice: the legacy jsonb for old readers and the
  -- structured table for the new detail panel.
  for v_file in select value from jsonb_array_elements(case when jsonb_typeof(coalesce(p_files, '[]'::jsonb)) = 'array' then coalesce(p_files, '[]'::jsonb) else '[]'::jsonb end) loop
    if length(btrim(coalesce(v_file->>'url', ''))) > 0 then
      insert into smartgov.event_files (event_id, url, original_name, uploaded_by)
      values (
        v_id,
        btrim(v_file->>'url'),
        coalesce(nullif(btrim(v_file->>'name'), ''), 'Support file'),
        v_account.id
      );
    end if;
  end loop;

  v_title := case when v_usg then 'New university event' else 'New event claim' end;
  v_body  := btrim(p_title) || ' Â· ' || to_char(p_event_date, 'YYYY-MM-DD')
             || case when p_event_time is not null then ' ' || to_char(p_event_time, 'HH24:MI') else '' end;

  if v_usg then
    -- Notify the units the event is addressed to.
    for v_target in
      select distinct a.id
        from smartgov.accounts a
        join smartgov.roster r on r.account_id = a.id
        join smartgov.unit_memberships m on m.roster_id = r.id
        join public.governance_units u on u.id = m.unit_id
       where a.organization_id = v_account.organization_id
         and a.status = 'active'
         and (m.end_date is null or m.end_date >= current_date)
         and (
           v_scope = 'university'
           or (v_scope = 'unit_type' and lower(u.unit_type::text) = any (
                 select lower(t) from unnest(coalesce(p_unit_types, '{}'::text[])) t))
           or (v_scope = 'units' and u.id = any (coalesce(p_unit_ids, '{}'::uuid[])))
           or (v_scope = 'unit' and u.id = coalesce(v_unit, p_unit_ids[1]))
         )
    loop
      insert into smartgov.notifications (account_id, organization_id, kind, title, body, link)
      values (v_target, v_account.organization_id, 'event_published', v_title, v_body, '/lsg/events');
    end loop;
  else
    for v_target in
      select a.id from smartgov.accounts a
       where a.organization_id = v_account.organization_id
         and a.status = 'active'
         and (a.account_scope = 'owner' or smartgov.is_org_reviewer(a.id, a.organization_id))
    loop
      insert into smartgov.notifications (account_id, organization_id, kind, title, body, link)
      values (v_target, v_account.organization_id, 'event_claim', v_title, v_body, '/usg/events');
    end loop;
  end if;

  insert into smartgov.audit_log (organization_id, actor_id, action, target_type, target_id, detail)
  values (v_account.organization_id, v_account.id,
          case when v_usg then 'event.created' else 'event.claimed' end,
          'event', v_id,
          jsonb_build_object('title', btrim(p_title), 'scope', v_scope));

  return jsonb_build_object('ok', true, 'eventId', v_id);
end;
$$;
