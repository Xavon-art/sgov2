create index if not exists budget_requests_org_created_idx
  on smartgov.budget_requests (organization_id, created_at desc);

create index if not exists budget_requests_org_status_created_idx
  on smartgov.budget_requests (organization_id, status, created_at desc);

create index if not exists budget_requests_org_unit_status_created_idx
  on smartgov.budget_requests (organization_id, unit_id, status, created_at desc);

create index if not exists budget_requests_org_event_status_idx
  on smartgov.budget_requests (organization_id, event_id, status)
  where event_id is not null;

create or replace function smartgov.review_budget(
  p_session_token  text,
  p_budget_id      uuid,
  p_decision       text,
  p_approved_total numeric,
  p_remark         text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_budget  smartgov.budget_requests%rowtype;
  v_remark  text;
  v_amount  numeric;
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if not (
    v_account.account_scope = 'owner'
    or smartgov.is_org_reviewer(v_account.id, v_account.organization_id)
  ) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if p_decision not in ('approved', 'returned', 'rejected') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  v_remark := btrim(coalesce(p_remark, ''));

  if p_decision <> 'approved' and v_remark = '' then
    return jsonb_build_object('ok', false, 'reason', 'remark_required');
  end if;

  select b.* into v_budget
    from smartgov.budget_requests b
   where b.id = p_budget_id
     and b.organization_id = v_account.organization_id;

  if v_budget.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if v_budget.status not in ('submitted', 'returned') then
    return jsonb_build_object('ok', false, 'reason', 'already_decided');
  end if;

  if p_decision = 'approved' then
    v_amount := coalesce(p_approved_total, v_budget.requested_total);

    if v_amount < 0 or v_amount > v_budget.requested_total then
      return jsonb_build_object('ok', false, 'reason', 'invalid_amount');
    end if;
  else
    v_amount := null;
  end if;

  update smartgov.budget_requests
     set status = p_decision,
         approved_total = v_amount,
         decided_by = v_account.id,
         decided_at = now(),
         decision_remark = nullif(v_remark, '')
   where id = v_budget.id;

  if p_decision = 'approved' and v_budget.event_id is not null then
    update smartgov.budget_requests
       set actual_spent = 0
     where id = v_budget.id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'id', v_budget.id,
    'status', p_decision,
    'approvedTotal', v_amount,
    'requestedTotal', v_budget.requested_total
  );
end;
$$;

revoke all on function smartgov.review_budget(text, uuid, text, numeric, text) from public;

create or replace function smartgov.list_budgets(p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account  smartgov.accounts%rowtype;
  v_is_usg   boolean;
  v_unit_ids uuid[];
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  v_is_usg := v_account.account_scope = 'owner'
              or smartgov.is_org_reviewer(v_account.id, v_account.organization_id);

  select coalesce(array_agg(u), '{}'::uuid[])
    into v_unit_ids
    from smartgov.lsg_unit_ids(v_account.id, v_account.organization_id) u;

  return jsonb_build_object(
    'ok', true,
    'scope', case when v_is_usg then 'organization' else 'unit' end,
    'budgets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id,
        'proposalId', b.proposal_id,
        'proposalTitle', (select pr.title from smartgov.proposals pr where pr.id = b.proposal_id),
        'eventId', b.event_id,
        'eventTitle', (select e.title from smartgov.events e where e.id = b.event_id),
        'eventDate', (select e.event_date from smartgov.events e where e.id = b.event_id),
        'title', b.title,
        'status', b.status,
        'unitId', b.unit_id,
        'unitName', (select gu.name from public.governance_units gu where gu.id = b.unit_id),
        'requestedTotal', b.requested_total,
        'approvedTotal', b.approved_total,
        'actualSpent', b.actual_spent,
        'decisionRemark', b.decision_remark,
        'itemCount', (select count(*) from smartgov.budget_items bi where bi.budget_request_id = b.id),
        'createdAt', b.created_at
      ) order by b.created_at desc)
        from smartgov.budget_requests b
       where b.organization_id = v_account.organization_id
         and (
           v_is_usg
           or b.requested_by = v_account.id
           or (b.unit_id is not null and b.unit_id = any (v_unit_ids))
           or b.status = 'approved'
         )
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function smartgov.list_budgets(text) from public;

create or replace function smartgov.lsg_budget_dashboard(p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account       smartgov.accounts%rowtype;
  v_unit_ids      uuid[];
  v_total_spent   numeric := 0;
  v_remaining     numeric := 0;
  v_periods       jsonb;
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  if smartgov.is_usg_side(v_account) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  select coalesce(array_agg(u), '{}'::uuid[])
    into v_unit_ids
    from smartgov.lsg_unit_ids(v_account.id, v_account.organization_id) u;

  select coalesce(sum(case when b.event_id is not null then coalesce(b.actual_spent, b.approved_total) else b.approved_total end), 0)
    into v_total_spent
    from smartgov.budget_requests b
   where b.organization_id = v_account.organization_id
     and b.status = 'approved'
     and (
       b.status = 'approved'
       or b.requested_by = v_account.id
       or (b.unit_id is not null and b.unit_id = any (v_unit_ids))
     );

  select coalesce(
    sum(case when b.status = 'approved' then coalesce(b.approved_total, 0) - coalesce(b.actual_spent, 0) else b.requested_total - coalesce(b.approved_total, 0) end),
    0)
    into v_remaining
    from smartgov.budget_requests b
   where b.organization_id = v_account.organization_id
     and b.status in ('submitted', 'returned', 'approved')
     and (
       b.status = 'approved'
       or b.requested_by = v_account.id
       or (b.unit_id is not null and b.unit_id = any (v_unit_ids))
     );

  select coalesce(jsonb_agg(jsonb_build_object(
           'label', p.school_year || ' ' || p.semester,
           'schoolYear', p.school_year,
           'semester', p.semester,
           'requested', p.requested,
           'approved', p.approved,
           'spent', p.spent
         ) order by p.school_year, p.semester), '[]'::jsonb)
    into v_periods
    from (
      select case when extract(month from date_trunc('month', b.created_at)) <= 6
                  then extract(year from b.created_at)::text || '-' || ((extract(year from b.created_at)::int + 1)::text)
                  else (extract(year from b.created_at)::int - 1)::text || '-' || extract(year from b.created_at)::text
             end as school_year,
             case when extract(month from date_trunc('month', b.created_at)) <= 6
                  then 'Semester 1' else 'Semester 2' end as semester,
             sum(b.requested_total) as requested,
             sum(coalesce(b.approved_total, 0)) as approved,
             sum(case when b.status = 'approved' then coalesce(b.actual_spent, b.approved_total) else 0 end) as spent
        from smartgov.budget_requests b
       where b.organization_id = v_account.organization_id
         and (
           b.status = 'approved'
           or b.requested_by = v_account.id
           or (b.unit_id is not null and b.unit_id = any (v_unit_ids))
         )
       group by 1, 2
    ) p;

  return jsonb_build_object(
    'ok', true,
    'totalSpent', v_total_spent,
    'requestCount', (
      select count(*) from smartgov.budget_requests b
       where b.organization_id = v_account.organization_id
         and b.status <> 'rejected'
         and (
           b.status = 'approved'
           or b.requested_by = v_account.id
           or (b.unit_id is not null and b.unit_id = any (v_unit_ids))
         )
    ),
    'approvedCount', (
      select count(*) from smartgov.budget_requests b
       where b.organization_id = v_account.organization_id
         and b.status = 'approved'
         and (
           b.status = 'approved'
           or b.requested_by = v_account.id
           or (b.unit_id is not null and b.unit_id = any (v_unit_ids))
         )
    ),
    'remaining', v_remaining,
    'periods', v_periods
  );
end;
$$;

revoke all on function smartgov.lsg_budget_dashboard(text) from public;
