-- 03160 -- Events and Acts, second pass.
--
-- The first events slice shipped a date-only calendar with two scopes and a
-- single status column. This pass gives it the shape the mission describes:
--
--   * a real date + time + IANA timezone, a venue, and support links;
--   * USG scope by whole university, unit type, selected units, or one unit;
--   * LSG-added events that are claims awaiting honour, never silently
--     university-approved;
--   * honour / not-honour with a required reason for a refusal;
--   * strict visibility: an LSG sees USG events addressed to it and its own
--     events, never another LSG's.
--
-- Everything is additive. `create_event` keeps its old signature and delegates,
-- so an old client cannot break while the new one rolls out.

-- ---------------------------------------------------------------- new columns
alter table smartgov.events
  add column if not exists event_time      time,
  add column if not exists event_timezone  text,
  add column if not exists venue           text,
  add column if not exists honor_status    text not null default 'pending',
  add column if not exists honor_reason    text,
  add column if not exists cancelled_at    timestamptz,
  add column if not exists updated_at      timestamptz not null default now(),
  add column if not exists source          text not null default 'usg',
  add column if not exists linked_request  uuid references smartgov.personal_requests (id) on delete set null;

alter table smartgov.events drop constraint if exists events_scope_check;
alter table smartgov.events
  add constraint events_scope_check
  check (scope in ('university', 'unit_type', 'units', 'unit', 'org'));

alter table smartgov.events drop constraint if exists events_status_check;
alter table smartgov.events
  add constraint events_status_check
  check (status in ('upcoming', 'claimed', 'honored', 'rejected', 'cancelled'));

alter table smartgov.events drop constraint if exists events_honor_status_check;
alter table smartgov.events
  add constraint events_honor_status_check
  check (honor_status in ('pending', 'honored', 'not_honored'));

alter table smartgov.events drop constraint if exists events_source_check;
alter table smartgov.events
  add constraint events_source_check
  check (source in ('usg', 'lsg'));

create index if not exists events_honor_idx
  on smartgov.events (organization_id, honor_status);

-- ------------------------------------------------------------- scope + files
create table if not exists smartgov.event_scopes (
  id        uuid primary key default gen_random_uuid(),
  event_id  uuid not null references smartgov.events (id) on delete cascade,
  unit_type text,
  unit_id   uuid references public.governance_units (id) on delete cascade
);
create unique index if not exists event_scopes_unique
  on smartgov.event_scopes (event_id, coalesce(unit_type, ''), coalesce(unit_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists event_scopes_unit_idx on smartgov.event_scopes (unit_id);
revoke all on smartgov.event_scopes from public, anon, authenticated;

create table if not exists smartgov.event_files (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references smartgov.events (id) on delete cascade,
  storage_path  text,
  url           text,
  original_name text not null,
  mime_type     text,
  size_bytes    bigint,
  uploaded_by   uuid references smartgov.accounts (id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists event_files_event_idx on smartgov.event_files (event_id);
revoke all on smartgov.event_files from public, anon, authenticated;

-- ------------------------------------------------------------- helpers
create or replace function smartgov.is_usg_side(p_account smartgov.accounts)
returns boolean
language sql
stable
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
  select p_account.account_scope = 'owner'
      or smartgov.is_org_reviewer(p_account.id, p_account.organization_id);
$$;
revoke all on function smartgov.is_usg_side(smartgov.accounts) from public;

create or replace function smartgov.my_lsg_unit(p_account smartgov.accounts)
returns uuid
language sql
stable
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
  select t.u from (select smartgov.lsg_unit_ids(p_account.id, p_account.organization_id) as u) t
   where t.u is not null
   order by t.u
   limit 1;
$$;
revoke all on function smartgov.my_lsg_unit(smartgov.accounts) from public;

-- ------------------------------------------------------------- create v2
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
  for v_file in select * from jsonb_array_elements(coalesce(p_files, '[]'::jsonb)) loop
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
  v_body  := btrim(p_title) || ' · ' || to_char(p_event_date, 'YYYY-MM-DD')
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
           or (v_scope = 'unit_type' and lower(u.unit_type) = any (
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
revoke all on function smartgov.create_event_v2(text, text, text, date, time, text, text, text, uuid[], text[], jsonb, uuid, text) from public;

-- Legacy entry point: keeps the old six-argument call working.
create or replace function smartgov.create_event(
  p_session_token text,
  p_title text,
  p_description text,
  p_event_date date,
  p_scope text,
  p_unit_id uuid
)
returns jsonb
language sql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
  select smartgov.create_event_v2(
    p_session_token, p_title, p_description, p_event_date,
    null, null, null,
    case when p_scope = 'org' then 'university' else 'unit' end,
    case when p_unit_id is null then '{}'::uuid[] else array[p_unit_id] end,
    '{}'::text[], '[]'::jsonb, null, null
  );
$$;
revoke all on function smartgov.create_event(text, text, text, date, text, uuid) from public;

-- ------------------------------------------------------------- list v2
create or replace function smartgov.list_events(p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_usg     boolean;
  v_unit    uuid;
  v_type    text;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if v_account.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;

  v_usg := smartgov.is_usg_side(v_account);
  v_unit := smartgov.my_lsg_unit(v_account);
  select u.unit_type into v_type from public.governance_units u where u.id = v_unit;

  return jsonb_build_object(
    'ok', true,
    'events', coalesce((
      select jsonb_agg(row order by (row->>'eventDate') asc, (row->>'createdAt') desc)
      from (
        select jsonb_build_object(
          'id', e.id,
          'title', e.title,
          'description', e.description,
          'eventDate', e.event_date,
          'eventTime', e.event_time,
          'timezone', e.event_timezone,
          'venue', e.venue,
          'scope', e.scope,
          'unitId', e.unit_id,
          'status', e.status,
          'honorStatus', e.honor_status,
          'honorReason', e.honor_reason,
          'source', e.source,
          'supportFiles', e.support_files,
          'files', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', f.id, 'name', f.original_name, 'url', f.url,
              'mimeType', f.mime_type, 'sizeBytes', f.size_bytes
            ) order by f.created_at)
            from smartgov.event_files f where f.event_id = e.id
          ), '[]'::jsonb),
          'scopes', coalesce((
            select jsonb_agg(jsonb_build_object('unitType', s.unit_type, 'unitId', s.unit_id))
            from smartgov.event_scopes s where s.event_id = e.id
          ), '[]'::jsonb),
          'claimNote', e.claim_note,
          'decisionNote', e.decision_note,
          'linkedRequest', e.linked_request,
          'cancelledAt', e.cancelled_at,
          'updatedAt', e.updated_at,
          'createdAt', e.created_at,
          'createdBy', e.created_by,
          'canDecide', v_usg and e.source = 'lsg' and e.honor_status = 'pending',
          'canEdit', (e.created_by = v_account.id or v_usg) and e.cancelled_at is null,
          'canClaim', (not v_usg) and e.source = 'lsg' and e.unit_id = v_unit and e.honor_status = 'not_honored'
        ) as row
        from smartgov.events e
        where e.organization_id = v_account.organization_id
          and (
            v_usg
            or e.source = 'lsg'
            or e.scope in ('university', 'org')
            or (e.scope = 'unit' and e.unit_id = v_unit)
            or (e.scope = 'unit_type' and exists (
                  select 1 from smartgov.event_scopes s
                   where s.event_id = e.id and lower(s.unit_type) = lower(coalesce(v_type, ''))))
            or (e.scope = 'units' and exists (
                  select 1 from smartgov.event_scopes s
                   where s.event_id = e.id and s.unit_id = v_unit))
          )
          and (
            v_usg
            or e.source = 'usg'
            or e.created_by = v_account.id
            or e.unit_id = v_unit
          )
      ) q
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function smartgov.list_events(text) from public;

-- ------------------------------------------------------------- decide v2
create or replace function smartgov.decide_event(
  p_session_token text,
  p_event_id uuid,
  p_decision text,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account  smartgov.accounts%rowtype;
  v_event    smartgov.events%rowtype;
  v_decision text := lower(trim(coalesce(p_decision, '')));
  v_note     text := btrim(coalesce(p_note, ''));
  v_target   uuid;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if not smartgov.is_usg_side(v_account) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if v_decision = 'rejected' then v_decision := 'not_honored'; end if;
  if v_decision not in ('honored', 'not_honored') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;
  if v_decision = 'not_honored' and length(v_note) < 3 then
    return jsonb_build_object('ok', false, 'reason', 'reason_required');
  end if;

  select * into v_event from smartgov.events
   where id = p_event_id and organization_id = v_account.organization_id;
  if v_event.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  update smartgov.events
     set status = case when v_decision = 'honored' then 'honored' else 'rejected' end,
         honor_status = v_decision,
         honor_reason = case when v_decision = 'not_honored' then v_note else null end,
         decision_note = nullif(v_note, ''),
         decided_by = v_account.id,
         decided_at = now(),
         updated_at = now()
   where id = v_event.id;

  insert into smartgov.notifications (account_id, organization_id, kind, title, body, link)
  values (
    v_event.created_by, v_account.organization_id,
    case when v_decision = 'honored' then 'event_honored' else 'event_not_honored' end,
    case when v_decision = 'honored' then 'Event honoured' else 'Event not honoured' end,
    v_event.title || case when v_decision = 'not_honored' then ': ' || v_note else ' was honoured.' end,
    '/lsg/events'
  );

  insert into smartgov.audit_log (organization_id, actor_id, action, target_type, target_id, detail)
  values (v_account.organization_id, v_account.id,
          case when v_decision = 'honored' then 'event.honored' else 'event.not_honored' end,
          'event', v_event.id, jsonb_build_object('title', v_event.title, 'reason', v_note));

  return jsonb_build_object('ok', true, 'honorStatus', v_decision);
end;
$$;
revoke all on function smartgov.decide_event(text, uuid, text, text) from public;

-- ------------------------------------------------------------- claim v2
-- Re-claiming a refused event: the LSG edits and resubmits, which sends it
-- back to pending rather than straight to honoured.
create or replace function smartgov.claim_event(
  p_session_token text,
  p_event_id uuid,
  p_support_files jsonb,
  p_claim_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_event   smartgov.events%rowtype;
  v_unit    uuid;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  select * into v_event from smartgov.events
   where id = p_event_id and organization_id = v_account.organization_id;
  if v_event.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  v_unit := smartgov.my_lsg_unit(v_account);

  if not (
    v_event.created_by = v_account.id
    or (v_unit is not null and v_event.unit_id = v_unit)
    or smartgov.is_usg_side(v_account)
  ) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  update smartgov.events
     set status = 'claimed',
         honor_status = 'pending',
         honor_reason = null,
         support_files = coalesce(p_support_files, support_files),
         claim_note = nullif(btrim(coalesce(p_claim_note, '')), ''),
         updated_at = now()
   where id = v_event.id;

  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function smartgov.claim_event(text, uuid, jsonb, text) from public;

-- ------------------------------------------------------------- update
create or replace function smartgov.update_event(
  p_session_token text,
  p_event_id uuid,
  p_title text,
  p_description text,
  p_event_date date,
  p_event_time time,
  p_timezone text,
  p_venue text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_event   smartgov.events%rowtype;
  v_unit    uuid;
  v_usg     boolean;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  select * into v_event from smartgov.events
   where id = p_event_id and organization_id = v_account.organization_id;
  if v_event.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  v_usg := smartgov.is_usg_side(v_account);
  v_unit := smartgov.my_lsg_unit(v_account);
  if not (v_usg or v_event.created_by = v_account.id or (v_unit is not null and v_event.unit_id = v_unit)) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if v_event.cancelled_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  update smartgov.events
     set title = coalesce(nullif(btrim(coalesce(p_title, '')), ''), title),
         description = nullif(btrim(coalesce(p_description, '')), ''),
         event_date = coalesce(p_event_date, event_date),
         event_time = p_event_time,
         event_timezone = nullif(btrim(coalesce(p_timezone, '')), ''),
         venue = nullif(btrim(coalesce(p_venue, '')), ''),
         updated_at = now()
   where id = v_event.id;

  insert into smartgov.audit_log (organization_id, actor_id, action, target_type, target_id, detail)
  values (v_account.organization_id, v_account.id, 'event.updated', 'event', v_event.id,
          jsonb_build_object('title', v_event.title));

  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function smartgov.update_event(text, uuid, text, text, date, time, text, text) from public;

-- ------------------------------------------------------------- cancel
create or replace function smartgov.cancel_event(p_session_token text, p_event_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_event   smartgov.events%rowtype;
  v_unit    uuid;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  select * into v_event from smartgov.events
   where id = p_event_id and organization_id = v_account.organization_id;
  if v_event.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  v_unit := smartgov.my_lsg_unit(v_account);
  if not (smartgov.is_usg_side(v_account) or v_event.created_by = v_account.id
          or (v_unit is not null and v_event.unit_id = v_unit)) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  update smartgov.events
     set status = 'cancelled',
         cancelled_at = now(),
         decision_note = coalesce(nullif(btrim(coalesce(p_reason, '')), ''), decision_note),
         updated_at = now()
   where id = v_event.id;

  insert into smartgov.audit_log (organization_id, actor_id, action, target_type, target_id, detail)
  values (v_account.organization_id, v_account.id, 'event.cancelled', 'event', v_event.id,
          jsonb_build_object('title', v_event.title, 'reason', btrim(coalesce(p_reason, ''))));

  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function smartgov.cancel_event(text, uuid, text) from public;

-- ------------------------------------------------------------- forwarders
create or replace function public.create_event_v2(
  p_session_token text, p_title text, p_description text, p_event_date date,
  p_event_time time, p_timezone text, p_venue text, p_scope text,
  p_unit_ids uuid[], p_unit_types text[], p_files jsonb,
  p_link_request uuid, p_claim_note text
)
returns jsonb language sql security definer set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.create_event_v2(p_session_token, p_title, p_description, p_event_date,
  p_event_time, p_timezone, p_venue, p_scope, p_unit_ids, p_unit_types, p_files, p_link_request, p_claim_note); $$;
revoke all on function public.create_event_v2(text, text, text, date, time, text, text, text, uuid[], text[], jsonb, uuid, text) from public;
grant execute on function public.create_event_v2(text, text, text, date, time, text, text, text, uuid[], text[], jsonb, uuid, text) to anon, authenticated, service_role;

create or replace function public.update_event(
  p_session_token text, p_event_id uuid, p_title text, p_description text,
  p_event_date date, p_event_time time, p_timezone text, p_venue text
)
returns jsonb language sql security definer set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.update_event(p_session_token, p_event_id, p_title, p_description,
  p_event_date, p_event_time, p_timezone, p_venue); $$;
revoke all on function public.update_event(text, uuid, text, text, date, time, text, text) from public;
grant execute on function public.update_event(text, uuid, text, text, date, time, text, text) to anon, authenticated, service_role;

create or replace function public.cancel_event(p_session_token text, p_event_id uuid, p_reason text)
returns jsonb language sql security definer set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.cancel_event(p_session_token, p_event_id, p_reason); $$;
revoke all on function public.cancel_event(text, uuid, text) from public;
grant execute on function public.cancel_event(text, uuid, text) to anon, authenticated, service_role;

-- The legacy forwarders keep their old signatures.
create or replace function public.create_event(p_session_token text, p_title text, p_description text, p_event_date date, p_scope text, p_unit_id uuid)
returns jsonb language sql security definer set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.create_event(p_session_token, p_title, p_description, p_event_date, p_scope, p_unit_id); $$;
revoke all on function public.create_event(text, text, text, date, text, uuid) from public;
grant execute on function public.create_event(text, text, text, date, text, uuid) to anon, authenticated, service_role;
