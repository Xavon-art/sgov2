create table if not exists smartgov.event_report_requirements (
  event_id  uuid not null references smartgov.events (id) on delete cascade,
  unit_id   uuid not null references public.governance_units (id) on delete cascade,
  required  boolean not null default true,
  created_at timestamptz not null default now(),
  unique (event_id, unit_id)
);

create index if not exists event_report_requirements_unit_idx
  on smartgov.event_report_requirements (unit_id, required)
  where required;

alter table smartgov.event_report_requirements enable row level security;
revoke all on smartgov.event_report_requirements from public, anon, authenticated;

create or replace function smartgov.sync_event_report_requirements(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_event smartgov.events%rowtype;
begin
  select * into v_event from smartgov.events where id = p_event_id;
  if v_event.id is null then
    return;
  end if;

  update smartgov.event_report_requirements r
     set required = false
   where r.event_id = p_event_id;

  insert into smartgov.event_report_requirements (event_id, unit_id, required)
  select distinct p_event_id, u.id, true
    from public.governance_units u
   where u.organization_id = v_event.organization_id
     and lower(u.unit_type::text) <> 'usg'
     and (
       (
         v_event.source = 'lsg'
         and (
           u.id = v_event.unit_id
           or u.id = (
             select s.unit_id from smartgov.event_scopes s
              where s.event_id = v_event.id and s.unit_id is not null
              limit 1
           )
           or u.id = (
             select smartgov.my_lsg_unit(a) from smartgov.accounts a
              where a.id = v_event.created_by
           )
         )
       )
       or (
         v_event.source <> 'lsg'
         and (
           v_event.scope in ('university', 'org')
           or (
             v_event.scope = 'unit'
             and u.id = coalesce(
               v_event.unit_id,
               (select s.unit_id from smartgov.event_scopes s
                 where s.event_id = v_event.id and s.unit_id is not null
                 limit 1)
             )
           )
           or (
             v_event.scope = 'units'
             and exists (
               select 1 from smartgov.event_scopes s
                where s.event_id = v_event.id and s.unit_id = u.id
             )
           )
           or (
             v_event.scope = 'unit_type'
             and exists (
               select 1 from smartgov.event_scopes s
                where s.event_id = v_event.id
                  and lower(s.unit_type) = lower(u.unit_type::text)
             )
           )
         )
       )
     )
  on conflict (event_id, unit_id) do update set required = true;
end;
$$;
revoke all on function smartgov.sync_event_report_requirements(uuid) from public;

select smartgov.sync_event_report_requirements(e.id) from smartgov.events e;

-- Guard the rename so re-applying this migration after a partial run does not
-- fail with "function create_event_v2_base ... already exists".
do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'smartgov' and p.proname = 'create_event_v2' and p.pronargs = 13
  ) and not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'smartgov' and p.proname = 'create_event_v2_base' and p.pronargs = 13
  ) then
    alter function smartgov.create_event_v2(text, text, text, date, time, text, text, text, uuid[], text[], jsonb, uuid, text)
      rename to create_event_v2_base;
  end if;
end $$;

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
  v_result jsonb;
begin
  v_result := smartgov.create_event_v2_base(
    p_session_token, p_title, p_description, p_event_date, p_event_time,
    p_timezone, p_venue, p_scope, p_unit_ids, p_unit_types, p_files,
    p_link_request, p_claim_note
  );
  if coalesce((v_result ->> 'ok')::boolean, false)
     and nullif(v_result ->> 'eventId', '') is not null then
    perform smartgov.sync_event_report_requirements((v_result ->> 'eventId')::uuid);
  end if;
  return v_result;
end;
$$;
revoke all on function smartgov.create_event_v2(text, text, text, date, time, text, text, text, uuid[], text[], jsonb, uuid, text) from public;

do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'smartgov' and p.proname = 'update_event' and p.pronargs = 8
  ) and not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'smartgov' and p.proname = 'update_event_base' and p.pronargs = 8
  ) then
    alter function smartgov.update_event(text, uuid, text, text, date, time, text, text)
      rename to update_event_base;
  end if;
end $$;

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
  v_result jsonb;
begin
  v_result := smartgov.update_event_base(
    p_session_token, p_event_id, p_title, p_description, p_event_date,
    p_event_time, p_timezone, p_venue
  );
  if coalesce((v_result ->> 'ok')::boolean, false) then
    perform smartgov.sync_event_report_requirements(p_event_id);
  end if;
  return v_result;
end;
$$;
revoke all on function smartgov.update_event(text, uuid, text, text, date, time, text, text) from public;

create or replace function smartgov.can_file_accomplishment(
  p_account smartgov.accounts,
  p_event_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
  select exists (
    select 1
      from smartgov.events e
     where e.id = p_event_id
       and e.organization_id = p_account.organization_id
       and e.cancelled_at is null
       and e.honor_status <> 'not_honored'
       and not smartgov.is_usg_side(p_account)
       and exists (
         select 1
           from smartgov.event_report_requirements r
          where r.event_id = e.id
            and r.unit_id = smartgov.my_lsg_unit(p_account)
            and r.required
       )
  );
$$;
revoke all on function smartgov.can_file_accomplishment(smartgov.accounts, uuid) from public;

do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'smartgov' and p.proname = 'list_events' and p.pronargs = 1
  ) and not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'smartgov' and p.proname = 'list_events_base' and p.pronargs = 1
  ) then
    alter function smartgov.list_events(text) rename to list_events_base;
  end if;
end $$;

create or replace function smartgov.list_events(p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_result  jsonb;
  v_account smartgov.accounts%rowtype;
  v_usg     boolean;
  v_unit    uuid;
  v_events  jsonb;
begin
  v_result := smartgov.list_events_base(p_session_token);
  if not coalesce((v_result ->> 'ok')::boolean, false) then
    return v_result;
  end if;

  v_account := smartgov.authenticate(p_session_token);
  v_usg := smartgov.is_usg_side(v_account);
  v_unit := smartgov.my_lsg_unit(v_account);

  select jsonb_agg(q.enriched order by q.ord) into v_events
    from (
      select e.ord,
             e.value || jsonb_build_object(
               'canAssign', false,
               'canReport', case when v_usg then false else smartgov.can_file_accomplishment(v_account, (e.value ->> 'id')::uuid) end,
               'requiredForMyUnit', case
                 when v_unit is null then false
                 else exists (
                   select 1 from smartgov.event_report_requirements r
                    where r.event_id = (e.value ->> 'id')::uuid
                      and r.unit_id = v_unit
                      and r.required
                 )
               end,
               'reportStatus', rep.status,
               'reportId', rep.id,
               'reportRequiredUnits', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'unitId', r.unit_id,
                          'unitName', u.name,
                          'required', r.required,
                          'reportStatus', rr.status,
                          'reportId', rr.id
                        ) order by u.name)
                   from smartgov.event_report_requirements r
                   join public.governance_units u on u.id = r.unit_id
                   left join lateral (
                     select x.id, x.status
                       from smartgov.accomplishment_reports x
                      where x.event_id = r.event_id
                        and x.reporting_unit_id = r.unit_id
                      order by x.created_at desc
                      limit 1
                   ) rr on true
                  where r.event_id = (e.value ->> 'id')::uuid
                    and r.required
               ), '[]'::jsonb)
             ) as enriched
        from jsonb_array_elements(coalesce(v_result -> 'events', '[]'::jsonb)) with ordinality as e(value, ord)
        left join lateral (
          select x.id, x.status
            from smartgov.accomplishment_reports x
           where x.event_id = (e.value ->> 'id')::uuid
             and v_unit is not null
             and x.reporting_unit_id = v_unit
           order by x.created_at desc
           limit 1
        ) rep on true
    ) q;

  return jsonb_build_object('ok', true, 'events', coalesce(v_events, '[]'::jsonb));
end;
$$;
revoke all on function smartgov.list_events(text) from public;

do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'smartgov' and p.proname = 'submit_accomplishment_report_v2' and p.pronargs = 6
  ) and not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'smartgov' and p.proname = 'submit_accomplishment_report_v2_base' and p.pronargs = 6
  ) then
    alter function smartgov.submit_accomplishment_report_v2(text, uuid, text, text, uuid, text[])
      rename to submit_accomplishment_report_v2_base;
  end if;
end $$;

create or replace function smartgov.submit_accomplishment_report_v2(
  p_session_token text,
  p_event_id uuid,
  p_narrative text,
  p_highlights text default '',
  p_attachment_submission_id uuid default null,
  p_file_paths text[] default '{}'
)
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
  if smartgov.is_usg_side(v_account) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  return smartgov.submit_accomplishment_report_v2_base(
    p_session_token, p_event_id, p_narrative, p_highlights,
    p_attachment_submission_id, p_file_paths
  );
end;
$$;
revoke all on function smartgov.submit_accomplishment_report_v2(text, uuid, text, text, uuid, text[]) from public;
