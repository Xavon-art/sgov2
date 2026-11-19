-- 20260101003230_unified_calendar.sql
-- Unified calendar: approved proposal events and visible events.
-- Replaces smartgov.list_calendar body while keeping the signature.

create or replace function smartgov.list_calendar(p_session_token text, p_month date, p_days int)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_is_usg  boolean;
  v_from    date;
  v_to      date;
  v_unit    uuid;
  v_type    text;
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  v_is_usg := smartgov.is_usg_side(v_account);
  v_unit := case when v_is_usg then null else smartgov.my_lsg_unit(v_account) end;
  select u.unit_type::text into v_type from public.governance_units u where u.id = v_unit;

  v_from := coalesce(p_month, date_trunc('month', current_date)::date);
  v_to := v_from + greatest(1, least(coalesce(p_days, 42), 400)) - 1;

  return jsonb_build_object(
    'ok', true,
    'from', v_from,
    'to', v_to,
    'days', coalesce((
      select jsonb_object_agg(d.day, d.items order by d.day)
      from (
        select c.day,
               jsonb_agg(jsonb_build_object(
                 'id', c.item_id,
                 'itemId', c.item_id,
                 'source', c.source,
                 'title', c.title,
                 'venue', c.venue,
                 'activityType', c.activity_type,
                 'unitName', c.unit_name,
                 'date', c.day,
                 'time', c.event_time,
                 'timezone', c.event_timezone,
                 'status', c.status,
                 'honorStatus', c.honor_status
               ) order by c.sort_key, c.title) as items
        from (
          -- Approved proposal events, org/unit scoped.
          select
            p.event_date::date as day,
            p.id::text as item_id,
            'proposal'::text as source,
            p.title,
            p.venue,
            p.activity_type::text as activity_type,
            (select gu.name from public.governance_units gu where gu.id = p.unit_id) as unit_name,
            null::text as event_time,
            null::text as event_timezone,
            p.status::text as status,
            null::text as honor_status,
            p.created_at as sort_key
          from smartgov.proposals p
          where p.organization_id = v_account.organization_id
            and p.event_date is not null
            and p.event_date between v_from and v_to
            and p.status = 'approved'
            and (
              v_is_usg
              or p.unit_id is null
              or p.unit_id = v_unit
              or p.unit_id in (select smartgov.lsg_unit_ids(v_account.id, v_account.organization_id))
            )

          union all

          -- Visible events, preserving list_events scoping and excluding
          -- cancelled, rejected, and not_honored entries.
          select
            e.event_date::date as day,
            e.id::text as item_id,
            'event'::text as source,
            e.title,
            e.venue,
            null::text as activity_type,
            (select gu.name from public.governance_units gu where gu.id = e.unit_id) as unit_name,
            e.event_time::text as event_time,
            e.event_timezone::text as event_timezone,
            e.status::text as status,
            e.honor_status::text as honor_status,
            e.created_at as sort_key
          from smartgov.events e
          where e.organization_id = v_account.organization_id
            and e.event_date between v_from and v_to
            and e.cancelled_at is null
            and coalesce(e.status, '') <> 'cancelled'
            and coalesce(e.status, '') <> 'rejected'
            and coalesce(e.honor_status, '') <> 'not_honored'
            and (
              v_is_usg
              or e.source = 'lsg'
              or e.scope in ('university', 'org')
              or (e.scope = 'unit' and e.unit_id = v_unit)
              or (e.scope = 'unit_type' and exists (
                    select 1 from smartgov.event_scopes s
                     where s.event_id = e.id and lower(s.unit_type::text) = lower(coalesce(v_type, ''))))
              or (e.scope = 'units' and exists (
                    select 1 from smartgov.event_scopes s
                     where s.event_id = e.id and s.unit_id = v_unit))
            )
            and (
              v_is_usg
              or e.source = 'usg'
              or e.created_by = v_account.id
              or e.unit_id = v_unit
            )
        ) c
        group by c.day
      ) d
    ), '{}'::jsonb)
  );
end;
$$;

revoke all on function smartgov.list_calendar(text, date, int) from public;

create or replace function public.list_calendar(p_session_token text, p_month date, p_days int)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.list_calendar(p_session_token, p_month, p_days); $$;
revoke all on function public.list_calendar(text, date, int) from public;
grant execute on function public.list_calendar(text, date, int) to anon, authenticated;
