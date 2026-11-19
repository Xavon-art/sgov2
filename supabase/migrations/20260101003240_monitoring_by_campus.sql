create or replace function smartgov.monitoring_by_campus(p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_empty_statuses jsonb := jsonb_build_object(
    'pending', 0,
    'under_review', 0,
    'approved', 0,
    'returned', 0,
    'rejected', 0,
    'cancelled', 0
  );
  v_module_keys jsonb := '["proposals","budgets","events","documents","tasks","requests","surveys","structures","resolutions"]'::jsonb;
  v_module_labels jsonb := jsonb_build_object(
    'proposals', 'Proposals',
    'budgets', 'Budgets',
    'events', 'Events',
    'documents', 'Documents',
    'tasks', 'Tasks',
    'requests', 'Requests',
    'surveys', 'Surveys',
    'structures', 'Structures',
    'resolutions', 'Resolutions'
  );
  v_campuses jsonb;
  v_totals jsonb;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if not smartgov.is_usg_side(v_account) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  with recursive roots as (
    select gu.id
      from public.governance_units gu
     where gu.organization_id = v_account.organization_id
       and gu.unit_type = 'usg'
  ),
  top_units as (
    select gu.id as unit_id, gu.id as campus_id, gu.name as campus_name
      from public.governance_units gu
      join roots r on gu.parent_id = r.id
     where gu.organization_id = v_account.organization_id
       and gu.unit_type in ('campus', 'college', 'department')
    union all
    select child.id, parent.campus_id, parent.campus_name
      from public.governance_units child
      join top_units parent on child.parent_id = parent.unit_id
     where child.organization_id = v_account.organization_id
  ),
  mapped_units as (
    select r.id as unit_id, r.id as campus_id, 'All campuses'::text as campus_name
      from roots r
    union
    select gu.id, coalesce(t.campus_id, r.id), coalesce(t.campus_name, 'All campuses'::text)
      from public.governance_units gu
      cross join roots r
      left join top_units t on t.unit_id = gu.id
     where gu.organization_id = v_account.organization_id
  ),
  campus_rows as (
    select distinct campus_id, campus_name from top_units
    union
    select id, 'All campuses'::text from roots
  ),
  module_rows as (
    select 'proposals'::text as module_key,
           coalesce(mu.campus_id, r.id) as campus_id,
           coalesce(mu.campus_name, 'All campuses'::text) as campus_name,
           case p.status
             when 'under_review' then 'under_review'
             when 'requirements_requested' then 'returned'
             when 'returned' then 'returned'
             when 'approved' then 'approved'
             when 'published' then 'approved'
             when 'rejected' then 'rejected'
             else 'pending'
           end as status_family
      from smartgov.proposals p
      cross join roots r
      left join mapped_units mu on mu.unit_id = p.unit_id
     where p.organization_id = v_account.organization_id
    union all
    select 'budgets'::text,
           coalesce(mu.campus_id, r.id),
           coalesce(mu.campus_name, 'All campuses'::text),
           case b.status
             when 'returned' then 'returned'
             when 'approved' then 'approved'
             when 'rejected' then 'rejected'
             else 'pending'
           end
      from smartgov.budget_requests b
      cross join roots r
      left join mapped_units mu on mu.unit_id = b.unit_id
     where b.organization_id = v_account.organization_id
    union all
    select 'events'::text,
           coalesce(mu.campus_id, r.id),
           coalesce(mu.campus_name, 'All campuses'::text),
           case
             when e.cancelled_at is not null or e.status = 'cancelled' then 'cancelled'
             when e.status = 'rejected' or e.honor_status = 'not_honored' then 'rejected'
             when e.status = 'honored' or e.honor_status = 'honored' then 'approved'
             when e.status = 'claimed' then 'under_review'
             else 'pending'
           end
      from smartgov.events e
      cross join roots r
      left join mapped_units mu on mu.unit_id = e.unit_id
     where e.organization_id = v_account.organization_id
    union all
    select 'documents'::text,
           coalesce(mu.campus_id, r.id),
           coalesce(mu.campus_name, 'All campuses'::text),
           case d.approval_status
             when 'approved' then 'approved'
             when 'rejected' then 'rejected'
             else 'pending'
           end
      from smartgov.document_catalog d
      cross join roots r
      left join smartgov.proposals dp on d.group_kind = 'requirement' and d.group_id = dp.id
      left join smartgov.events de on d.group_kind = 'event' and d.group_id = de.id
      left join smartgov.resolutions dr on d.group_kind = 'resolution' and d.group_id = dr.id
      left join mapped_units mu on mu.unit_id = coalesce(dp.unit_id, de.unit_id, dr.unit_id)
     where d.organization_id = v_account.organization_id
    union all
    select 'tasks'::text,
           coalesce(mu.campus_id, r.id),
           coalesce(mu.campus_name, 'All campuses'::text),
           case
             when t.closed_at is not null or ta.status = 'done' then 'approved'
             when ta.status = 'in_progress' then 'under_review'
             else 'pending'
           end
      from smartgov.tasks t
      join smartgov.task_assignments ta on ta.task_id = t.id
      cross join roots r
      left join mapped_units mu on mu.unit_id = ta.unit_id
     where t.organization_id = v_account.organization_id
    union all
    select 'requests'::text,
           coalesce(mu.campus_id, r.id),
           coalesce(mu.campus_name, 'All campuses'::text),
           case pr.status
             when 'granted' then 'approved'
             when 'declined' then 'rejected'
             when 'withdrawn' then 'cancelled'
             when 'expired' then 'cancelled'
             else 'pending'
           end
      from smartgov.personal_requests pr
      cross join roots r
      left join mapped_units mu on mu.unit_id = pr.unit_id
     where pr.organization_id = v_account.organization_id
    union all
    select 'surveys'::text,
           coalesce(mu.campus_id, r.id),
           coalesce(mu.campus_name, 'All campuses'::text),
           case s.status
             when 'closed' then 'approved'
             else 'pending'
           end
      from smartgov.surveys s
      cross join roots r
      left join mapped_units mu on false
     where s.organization_id = v_account.organization_id
    union all
    select 'structures'::text,
           coalesce(mu.campus_id, r.id),
           coalesce(mu.campus_name, 'All campuses'::text),
           case gs.status
             when 'approved' then 'approved'
             when 'returned' then 'returned'
             when 'rejected' then 'rejected'
             when 'superseded' then 'cancelled'
             else 'pending'
           end
      from smartgov.gov_structures gs
      cross join roots r
      left join mapped_units mu on mu.unit_id = gs.unit_id
     where gs.organization_id = v_account.organization_id
    union all
    select 'resolutions'::text,
           coalesce(mu.campus_id, r.id),
           coalesce(mu.campus_name, 'All campuses'::text),
           case res.status
             when 'under_review' then 'under_review'
             when 'approved' then 'approved'
             when 'published' then 'approved'
             when 'returned' then 'returned'
             when 'rejected' then 'rejected'
             else 'pending'
           end
      from smartgov.resolutions res
      cross join roots r
      left join mapped_units mu on mu.unit_id = res.unit_id
     where res.organization_id = v_account.organization_id
  ),
  family_counts as (
    select module_key, campus_id, campus_name, status_family, count(*)::int as n
      from module_rows
     group by module_key, campus_id, campus_name, status_family
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'unitId', c.campus_id,
        'unitName', c.campus_name,
        'totals', v_empty_statuses || coalesce((
          select jsonb_object_agg(fc.status_family, fc.n)
            from family_counts fc
           where fc.campus_id = c.campus_id
        ), '{}'::jsonb),
        'modules', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'key', k.key,
              'label', v_module_labels ->> k.key,
              'total', coalesce((
                select sum(fc.n)::int
                  from family_counts fc
                 where fc.campus_id = c.campus_id
                   and fc.module_key = k.key
              ), 0),
              'statuses', v_empty_statuses || coalesce((
                select jsonb_object_agg(fc.status_family, fc.n)
                  from family_counts fc
                 where fc.campus_id = c.campus_id
                   and fc.module_key = k.key
              ), '{}'::jsonb)
            ) order by k.ord
          )
            from jsonb_array_elements_text(v_module_keys) with ordinality as k(key, ord)
        ), '[]'::jsonb)
      ) order by c.campus_name
    ),
    '[]'::jsonb
  ),
  v_empty_statuses || coalesce((
    select jsonb_object_agg(f.status_family, f.total)
      from (
        select status_family, sum(n)::int as total
          from family_counts
         group by status_family
      ) f
  ), '{}'::jsonb)
    into v_campuses, v_totals
    from campus_rows c;

  return jsonb_build_object(
    'ok', true,
    'campuses', v_campuses,
    'totals', v_totals
  );
end;
$$;

revoke all on function smartgov.monitoring_by_campus(text) from public;

create or replace function public.monitoring_by_campus(p_session_token text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.monitoring_by_campus(p_session_token); $$;
revoke all on function public.monitoring_by_campus(text) from public;
grant execute on function public.monitoring_by_campus(text) to anon, authenticated;
