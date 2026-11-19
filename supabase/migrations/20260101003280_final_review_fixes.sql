create or replace function smartgov.set_document_metadata(
  p_session_token text,
  p_submission_id uuid,
  p_title text,
  p_description text,
  p_keywords text,
  p_group_kind text,
  p_group_id uuid,
  p_group_label text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account   smartgov.accounts%rowtype;
  v_usg       boolean;
  v_row       record;
  v_existing  smartgov.document_catalog%rowtype;
  v_title     text := btrim(coalesce(p_title, ''));
  v_desc      text := btrim(coalesce(p_description, ''));
  v_keywords  text := btrim(coalesce(p_keywords, ''));
  v_kind      text := lower(btrim(coalesce(p_group_kind, 'requirement')));
  v_label     text := nullif(btrim(coalesce(p_group_label, '')), '');
  v_group_id  uuid := p_group_id;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  if v_account.organization_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_organization');
  end if;

  if length(v_title) < 2 or length(v_title) > 160 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_title');
  end if;
  if length(v_desc) > 2000 or length(v_keywords) > 500 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  select * into v_existing
    from smartgov.document_catalog
   where submission_id = p_submission_id;

  if found then
    if nullif(btrim(coalesce(p_group_kind, '')), '') is null then
      v_kind := lower(btrim(v_existing.group_kind));
    end if;
    if v_existing.group_kind in ('event', 'resolution')
       and v_kind = lower(btrim(v_existing.group_kind))
       and v_group_id is null then
      v_group_id := v_existing.group_id;
    end if;
  end if;

  if v_kind not in ('requirement', 'resolution', 'event') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;
  if v_label is not null and length(v_label) > 160 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  select isub.id, isub.requirement_item_id, isub.original_name,
         p.created_by, p.unit_id, ri.label as item_label, d.uploaded_by
    into v_row
    from smartgov.item_submissions isub
    join smartgov.proposal_versions pv on pv.id = isub.version_id
    join smartgov.proposals p on p.id = pv.proposal_id
    join smartgov.requirement_items ri on ri.id = isub.requirement_item_id
    join smartgov.document_uploads d on d.storage_path = isub.storage_path
   where isub.id = p_submission_id
     and isub.submission_kind = 'file'
     and p.organization_id = v_account.organization_id;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  v_usg := v_account.account_scope = 'owner'
        or smartgov.is_org_reviewer(v_account.id, v_account.organization_id);

  if not (
    v_usg
    or v_row.created_by = v_account.id
    or v_row.uploaded_by = v_account.id
  ) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if v_kind = 'requirement' then
    if v_group_id is null then
      v_group_id := v_row.requirement_item_id;
    elsif not exists (
      select 1 from smartgov.requirement_items ri
       where ri.id = v_group_id
         and ri.organization_id = v_account.organization_id
    ) then
      return jsonb_build_object('ok', false, 'reason', 'not_found');
    end if;
    if v_label is null then
      v_label := v_row.item_label;
    end if;
  elsif v_kind = 'resolution' then
    if v_group_id is not null and not exists (
      select 1 from smartgov.resolutions r
       where r.id = v_group_id
         and r.organization_id = v_account.organization_id
    ) then
      return jsonb_build_object('ok', false, 'reason', 'not_found');
    end if;
  elsif v_kind = 'event' then
    if v_group_id is not null and not exists (
      select 1 from smartgov.events e
       where e.id = v_group_id
         and e.organization_id = v_account.organization_id
    ) then
      return jsonb_build_object('ok', false, 'reason', 'not_found');
    end if;
  end if;

  insert into smartgov.document_catalog (
    submission_id, organization_id, title, description, keywords,
    group_kind, group_id, group_label
  ) values (
    p_submission_id, v_account.organization_id, v_title, v_desc, v_keywords,
    v_kind, v_group_id, v_label
  )
  on conflict (submission_id) do update
    set title = excluded.title,
        description = excluded.description,
        keywords = excluded.keywords,
        group_kind = excluded.group_kind,
        group_id = excluded.group_id,
        group_label = excluded.group_label,
        approval_status = 'pending',
        approval_remark = null,
        approved_by = null,
        approved_at = null,
        updated_at = now();

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function smartgov.set_document_metadata(text, uuid, text, text, text, text, uuid, text) from public;

create or replace function public.set_document_metadata(
  p_session_token text,
  p_submission_id uuid,
  p_title text,
  p_description text,
  p_keywords text,
  p_group_kind text,
  p_group_id uuid,
  p_group_label text
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.set_document_metadata(
  p_session_token, p_submission_id, p_title, p_description, p_keywords,
  p_group_kind, p_group_id, p_group_label
); $$;
revoke all on function public.set_document_metadata(text, uuid, text, text, text, text, uuid, text) from public;
grant execute on function public.set_document_metadata(text, uuid, text, text, text, text, uuid, text) to anon, authenticated;

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
      left join smartgov.item_submissions dis on dis.id = d.submission_id
      left join smartgov.proposal_versions dpv on dpv.id = dis.version_id
      left join smartgov.proposals dp on dp.id = dpv.proposal_id
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
