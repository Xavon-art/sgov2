-- The public feed and the university calendar.
--
-- Why this is a read over proposals rather than a new table: an announcement is
-- already a proposal that reached `published`, and a duplicate table would drift
-- from it the first time an officer edits a description. Same for the calendar --
-- `event_date` is already on the proposal.
--
-- The rule that matters: an LSG officer sees only what USG has published. Nothing
-- here creates a way to read a proposal in any other state, so the feed cannot
-- become a side channel around `list_proposals`. USG additionally sees its own
-- drafts and unpublished work, which is what it needs to prepare a post.
--
-- The calendar is scoped the same way, so an event date on a proposal that was
-- never published does not appear on an officer's phone.
--
-- House rule, unchanged: no RLS policy, no grant. Read-only functions, but they are
-- still `security definer` because they resolve the caller from the session token.

-- ------------------------------------------------------------------- the feed
create or replace function smartgov.list_feed(p_session_token text, p_limit int)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_is_usg  boolean;
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  v_is_usg := v_account.account_scope = 'owner'
             or smartgov.is_org_reviewer(v_account.id, v_account.organization_id);

  return jsonb_build_object(
    'ok', true,
    'scope', case when v_is_usg then 'organization' else 'unit' end,
    'posts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'title', p.title,
        'description', p.description,
        'activityType', p.activity_type,
        'eventDate', p.event_date,
        'venue', p.venue,
        'status', p.status,
        'unitId', p.unit_id,
        'unitName', (select gu.name from public.governance_units gu where gu.id = p.unit_id),
        -- Only meaningful to USG: an LSG officer never sees anything but
        -- published, so this is null in every payload they can receive.
        'publishedAt', case when v_is_usg then p.created_at end,
        'isUpcoming', (p.event_date is not null and p.event_date >= current_date)
      ) order by p.event_date desc nulls last, p.created_at desc)
        from smartgov.proposals p
       where p.organization_id = v_account.organization_id
         and (v_is_usg or p.status = 'published')
         and (v_is_usg or p.unit_id is null or p.unit_id in (
               select u from (
                 select smartgov.lsg_unit_ids(v_account.id, v_account.organization_id) as u
               ) s
         ))
       limit greatest(1, least(coalesce(p_limit, 50), 200))
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function smartgov.list_feed(text, int) from public;

-- ------------------------------------------------------------------- the calendar
-- Events by month, so the screen can ask for one month at a time instead of
-- shipping every date the organization has ever entered. `p_month` is the first
-- day of the month; `p_days` defaults to that whole month plus a little either
-- side, so an event on the 1st still shows under the previous view.
--
-- Grouped by day in SQL rather than in the browser: the payload is a map of date to
-- events, which means an officer's phone receives one object per day that has
-- something on it, and nothing for the days that do not.
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
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  v_is_usg := v_account.account_scope = 'owner'
             or smartgov.is_org_reviewer(v_account.id, v_account.organization_id);

  v_from := coalesce(p_month, date_trunc('month', current_date)::date);
  v_to := v_from + coalesce(p_days, 42) - 1;

  return jsonb_build_object(
    'ok', true,
    'from', v_from,
    'to', v_to,
    'days', coalesce((
      select jsonb_object_agg(d.day, d.events order by d.day)
        from (
          select p.event_date as day,
                 jsonb_agg(jsonb_build_object(
                   'id', p.id,
                   'title', p.title,
                   'venue', p.venue,
                   'activityType', p.activity_type,
                   'unitName', (select gu.name from public.governance_units gu where gu.id = p.unit_id)
                 ) order by p.created_at) as events
            from smartgov.proposals p
           where p.organization_id = v_account.organization_id
             and p.event_date between v_from and v_to
             and (v_is_usg or p.status = 'published')
             and (v_is_usg or p.unit_id is null or p.unit_id in (
                   select u from (
                     select smartgov.lsg_unit_ids(v_account.id, v_account.organization_id) as u
                   ) s
             ))
           group by p.event_date
        ) d
    ), '{}'::jsonb)
  );
end;
$$;

revoke all on function smartgov.list_calendar(text, date, int) from public;

-- ------------------------------------------------------------------- public forwarders

create or replace function public.list_feed(p_session_token text, p_limit int)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.list_feed(p_session_token, p_limit); $$;
revoke all on function public.list_feed(text, int) from public;
grant execute on function public.list_feed(text, int) to anon, authenticated;

create or replace function public.list_calendar(p_session_token text, p_month date, p_days int)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.list_calendar(p_session_token, p_month, p_days); $$;
revoke all on function public.list_calendar(text, date, int) from public;
grant execute on function public.list_calendar(text, date, int) to anon, authenticated;