-- 03100 -- Events and acts calendar.
--
-- A shared calendar of upcoming events. Any officer (USG or LSG) can record
-- an event. An LSG officer can "claim" an event as an approved act for their
-- unit, attaching support files; the USG office then honors or rejects the
-- claim with a note. USG can also post organization-wide or unit-scoped events.

create table if not exists smartgov.events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  created_by uuid not null references smartgov.accounts (id) on delete cascade,
  title text not null,
  description text,
  event_date date not null,
  scope text not null default 'unit' check (scope in ('org', 'unit')),
  unit_id uuid,
  status text not null default 'upcoming'
    check (status in ('upcoming', 'claimed', 'honored', 'rejected')),
  support_files jsonb not null default '[]'::jsonb,
  claim_note text,
  decision_note text,
  decided_by uuid references smartgov.accounts (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists events_org_date_idx on smartgov.events (organization_id, event_date);


-- ---------------------------------------------------------------------------
-- 1. create_event
-- ---------------------------------------------------------------------------
create or replace function smartgov.create_event(
  p_session_token text,
  p_title text,
  p_description text,
  p_event_date date,
  p_scope text,
  p_unit_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_id uuid;
  v_scope text := coalesce(nullif(trim(p_scope), ''), 'unit');
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if v_account.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;
  if p_title is null or length(trim(p_title)) < 1 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_title');
  end if;
  if p_event_date is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;
  if v_scope not in ('org', 'unit') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  insert into smartgov.events (organization_id, created_by, title, description, event_date, scope, unit_id)
  values (v_account.organization_id, v_account.id, trim(p_title),
          nullif(trim(coalesce(p_description, '')), ''), p_event_date, v_scope, p_unit_id)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'eventId', v_id);
end;
$$;

revoke all on function smartgov.create_event(text, text, text, date, text, uuid) from public;


-- ---------------------------------------------------------------------------
-- 2. list_events
-- ---------------------------------------------------------------------------
create or replace function smartgov.list_events(p_session_token text)
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
    'events', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', e.id,
          'title', e.title,
          'description', e.description,
          'eventDate', e.event_date,
          'scope', e.scope,
          'unitId', e.unit_id,
          'status', e.status,
          'supportFiles', e.support_files,
          'claimNote', e.claim_note,
          'decisionNote', e.decision_note,
          'createdAt', e.created_at,
          'createdBy', e.created_by,
          'canDecide', (v_account.account_scope = 'owner')
        ) order by e.event_date asc, e.created_at desc
      )
      from smartgov.events e
      where e.organization_id = v_account.organization_id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function smartgov.list_events(text) from public;


-- ---------------------------------------------------------------------------
-- 3. claim_event (LSG attaches support files + marks claimed)
-- ---------------------------------------------------------------------------
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
  v_event smartgov.events%rowtype;
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
  if v_event.created_by <> v_account.id and v_account.account_scope <> 'owner' then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  update smartgov.events
     set status = 'claimed',
         support_files = coalesce(p_support_files, support_files),
         claim_note = nullif(trim(coalesce(p_claim_note, '')), '')
   where id = v_event.id;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function smartgov.claim_event(text, uuid, jsonb, text) from public;


-- ---------------------------------------------------------------------------
-- 4. decide_event (USG honors or rejects)
-- ---------------------------------------------------------------------------
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
  v_account smartgov.accounts%rowtype;
  v_event smartgov.events%rowtype;
  v_decision text := lower(trim(coalesce(p_decision, '')));
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if v_account.account_scope <> 'owner' then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if v_decision not in ('honored', 'rejected') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  select * into v_event from smartgov.events
    where id = p_event_id and organization_id = v_account.organization_id;
  if v_event.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  update smartgov.events
     set status = v_decision,
         decision_note = nullif(trim(coalesce(p_note, '')), ''),
         decided_by = v_account.id,
         decided_at = now()
   where id = v_event.id;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function smartgov.decide_event(text, uuid, text, text) from public;


-- ---------------------------------------------------------------------------
-- 5. delete_event
-- ---------------------------------------------------------------------------
create or replace function smartgov.delete_event(p_session_token text, p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_event smartgov.events%rowtype;
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
  if v_event.created_by <> v_account.id and v_account.account_scope <> 'owner' then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  delete from smartgov.events where id = v_event.id;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function smartgov.delete_event(text, uuid) from public;


-- ---------------------------------------------------------------------------
-- 6. PostgREST forwarders.
-- ---------------------------------------------------------------------------
create or replace function public.create_event(p_session_token text, p_title text, p_description text, p_event_date date, p_scope text, p_unit_id uuid)
returns jsonb language sql security definer set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.create_event(p_session_token, p_title, p_description, p_event_date, p_scope, p_unit_id); $$;
revoke all on function public.create_event(text, text, text, date, text, uuid) from public;
grant execute on function public.create_event(text, text, text, date, text, uuid) to anon, authenticated;

create or replace function public.list_events(p_session_token text)
returns jsonb language sql security definer set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.list_events(p_session_token); $$;
revoke all on function public.list_events(text) from public;
grant execute on function public.list_events(text) to anon, authenticated;

create or replace function public.claim_event(p_session_token text, p_event_id uuid, p_support_files jsonb, p_claim_note text)
returns jsonb language sql security definer set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.claim_event(p_session_token, p_event_id, p_support_files, p_claim_note); $$;
revoke all on function public.claim_event(text, uuid, jsonb, text) from public;
grant execute on function public.claim_event(text, uuid, jsonb, text) to anon, authenticated;

create or replace function public.decide_event(p_session_token text, p_event_id uuid, p_decision text, p_note text)
returns jsonb language sql security definer set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.decide_event(p_session_token, p_event_id, p_decision, p_note); $$;
revoke all on function public.decide_event(text, uuid, text, text) from public;
grant execute on function public.decide_event(text, uuid, text, text) to anon, authenticated;

create or replace function public.delete_event(p_session_token text, p_event_id uuid)
returns jsonb language sql security definer set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.delete_event(p_session_token, p_event_id); $$;
revoke all on function public.delete_event(text, uuid) from public;
grant execute on function public.delete_event(text, uuid) to anon, authenticated;