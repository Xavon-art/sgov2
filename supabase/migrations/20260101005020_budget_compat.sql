create or replace function smartgov.submit_budget(
  p_session_token text,
  p_proposal_id uuid,
  p_title text,
  p_justification text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
begin
  return smartgov.submit_unit_budget_request(
    p_session_token, null, null, p_title, p_justification, p_items, null, p_proposal_id
  );
end;
$$;

create or replace function smartgov.submit_event_budget(
  p_session_token text,
  p_event_id uuid,
  p_title text,
  p_justification text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
begin
  return smartgov.submit_unit_budget_request(
    p_session_token, null, null, p_title, p_justification, p_items, p_event_id, null
  );
end;
$$;

create or replace function smartgov.budget_detail(
  p_session_token text,
  p_budget_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_budget smartgov.budget_requests%rowtype;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then return jsonb_build_object('ok', false, 'reason', 'unauthenticated'); end if;

  select b.* into v_budget
    from smartgov.budget_requests b
   where b.id = p_budget_id and b.organization_id = v_account.organization_id;
  if v_budget.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;

  if not smartgov.budget_is_usg(v_account)
     and not (v_budget.unit_id = any (select smartgov.lsg_unit_ids(v_account.id, v_account.organization_id))) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  return jsonb_build_object(
    'ok', true,
    'id', v_budget.id,
    'proposalId', v_budget.proposal_id,
    'eventId', v_budget.event_id,
    'unitId', v_budget.unit_id,
    'periodId', v_budget.period_id,
    'title', v_budget.title,
    'justification', v_budget.justification,
    'status', v_budget.status,
    'unitName', (select gu.name from public.governance_units gu where gu.id = v_budget.unit_id),
    'periodLabel', (select bp.label from smartgov.budget_periods bp where bp.id = v_budget.period_id),
    'requestedTotal', v_budget.requested_total,
    'approvedTotal', v_budget.approved_total,
    'actualSpent', v_budget.actual_spent,
    'spent', smartgov.budget_expense_total(v_budget.id),
    'decisionRemark', v_budget.decision_remark,
    'decidedAt', v_budget.decided_at,
    'createdAt', v_budget.created_at,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', bi.id,
        'label', bi.label,
        'quantity', bi.quantity,
        'unitCost', bi.unit_cost,
        'subtotal', bi.subtotal
      ) order by bi.position)
        from smartgov.budget_items bi
       where bi.budget_request_id = v_budget.id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function smartgov.list_budgets(p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_usg boolean;
  v_units uuid[];
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then return jsonb_build_object('ok', false, 'reason', 'unauthenticated'); end if;

  v_usg := smartgov.budget_is_usg(v_account);
  select coalesce(array_agg(u), '{}'::uuid[]) into v_units from smartgov.lsg_unit_ids(v_account.id, v_account.organization_id) u;

  return jsonb_build_object(
    'ok', true,
    'scope', case when v_usg then 'organization' else 'unit' end,
    'budgets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id,
        'proposalId', b.proposal_id,
        'eventId', b.event_id,
        'unitId', b.unit_id,
        'periodId', b.period_id,
        'title', b.title,
        'status', b.status,
        'unitName', (select gu.name from public.governance_units gu where gu.id = b.unit_id),
        'periodLabel', (select bp.label from smartgov.budget_periods bp where bp.id = b.period_id),
        'requestedTotal', b.requested_total,
        'approvedTotal', b.approved_total,
        'actualSpent', b.actual_spent,
        'spent', smartgov.budget_expense_total(b.id),
        'decisionRemark', b.decision_remark,
        'itemCount', (select count(*) from smartgov.budget_items bi where bi.budget_request_id = b.id),
        'createdAt', b.created_at
      ) order by b.created_at desc)
        from smartgov.budget_requests b
       where b.organization_id = v_account.organization_id
         and (v_usg or b.unit_id = any (v_units))
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function smartgov.set_budget_actual_spent(
  p_session_token text,
  p_budget_id uuid,
  p_actual_spent numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_budget smartgov.budget_requests%rowtype;
  v_spent numeric;
  v_difference numeric;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then return jsonb_build_object('ok', false, 'reason', 'unauthenticated'); end if;

  select b.* into v_budget
    from smartgov.budget_requests b
   where b.id = p_budget_id and b.organization_id = v_account.organization_id;
  if v_budget.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if not smartgov.budget_is_usg(v_account)
     and not (v_budget.unit_id = any (select smartgov.lsg_unit_ids(v_account.id, v_account.organization_id))) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if v_budget.status <> 'approved' then return jsonb_build_object('ok', false, 'reason', 'invalid_status'); end if;
  if p_actual_spent is null or p_actual_spent < 0 or p_actual_spent > v_budget.approved_total then
    return jsonb_build_object('ok', false, 'reason', 'invalid_amount');
  end if;

  v_spent := smartgov.budget_expense_total(p_budget_id);
  if p_actual_spent < v_spent then return jsonb_build_object('ok', false, 'reason', 'invalid_amount'); end if;
  v_difference := p_actual_spent - v_spent;

  if v_difference > 0 then
    insert into smartgov.budget_expenses (organization_id, unit_id, request_id, amount, description, recorded_by)
    values (v_account.organization_id, v_budget.unit_id, p_budget_id, v_difference, 'Recorded spending', v_account.id);
  end if;

  update smartgov.budget_requests set actual_spent = p_actual_spent where id = p_budget_id;

  return jsonb_build_object(
    'ok', true,
    'budgetId', p_budget_id,
    'actualSpent', p_actual_spent,
    'remaining', v_budget.approved_total - p_actual_spent
  );
end;
$$;

create or replace function smartgov.lsg_budget_dashboard(p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_units uuid[];
  v_period uuid;
  v_allocated numeric := 0;
  v_approved numeric := 0;
  v_spent numeric := 0;
  v_committed numeric := 0;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then return jsonb_build_object('ok', false, 'reason', 'unauthenticated'); end if;
  if smartgov.budget_is_usg(v_account) then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;

  select coalesce(array_agg(u), '{}'::uuid[]) into v_units from smartgov.lsg_unit_ids(v_account.id, v_account.organization_id) u;
  v_period := smartgov.budget_default_period_id(v_account.organization_id);

  select coalesce(sum(coalesce(ba.allocated_amount, 0)), 0) into v_allocated
    from unnest(v_units) u(unit_id)
    left join smartgov.budget_allocations ba on ba.period_id = v_period and ba.unit_id = u.unit_id;

  select coalesce(sum(coalesce(b.approved_total, 0)), 0), coalesce(sum(coalesce(b.actual_spent, 0)), 0)
    into v_approved, v_spent
    from smartgov.budget_requests b
   where b.period_id = v_period and b.unit_id = any (v_units) and b.status = 'approved';

  select coalesce(sum(smartgov.budget_committed(v_period, u.unit_id, null)), 0) into v_committed
    from unnest(v_units) u(unit_id);

  return jsonb_build_object(
    'ok', true,
    'totalSpent', v_spent,
    'allocated', v_allocated,
    'approved', v_approved,
    'committed', v_committed,
    'remaining', v_allocated - v_committed,
    'remainingApproved', v_approved - v_spent,
    'requestCount', (
      select count(*) from smartgov.budget_requests b
       where b.period_id = v_period and b.unit_id = any (v_units) and b.status <> 'rejected'
    ),
    'approvedCount', (
      select count(*) from smartgov.budget_requests b
       where b.period_id = v_period and b.unit_id = any (v_units) and b.status = 'approved'
    ),
    'periods', coalesce((
      select jsonb_agg(jsonb_build_object(
        'label', bp.label,
        'startsOn', bp.starts_on,
        'endsOn', bp.ends_on,
        'requested', (select coalesce(sum(b.requested_total), 0) from smartgov.budget_requests b where b.period_id = bp.id and b.unit_id = any (v_units) and b.status <> 'rejected'),
        'approved', (select coalesce(sum(coalesce(b.approved_total, 0)), 0) from smartgov.budget_requests b where b.period_id = bp.id and b.unit_id = any (v_units) and b.status = 'approved'),
        'spent', (select coalesce(sum(coalesce(b.actual_spent, 0)), 0) from smartgov.budget_requests b where b.period_id = bp.id and b.unit_id = any (v_units) and b.status = 'approved')
      ) order by bp.starts_on desc)
        from smartgov.budget_periods bp
       where bp.organization_id = v_account.organization_id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function smartgov.budget_summary(p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_period uuid;
  v_requested numeric;
  v_approved numeric;
  v_committed numeric;
  v_spent numeric;
  v_allocated numeric;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then return jsonb_build_object('ok', false, 'reason', 'unauthenticated'); end if;
  if not smartgov.budget_is_usg(v_account) then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  v_period := smartgov.budget_default_period_id(v_account.organization_id);

  select coalesce(sum(b.requested_total), 0), coalesce(sum(coalesce(b.approved_total, 0)), 0), coalesce(sum(coalesce(b.actual_spent, 0)), 0)
    into v_requested, v_approved, v_spent
    from smartgov.budget_requests b
   where b.organization_id = v_account.organization_id and b.period_id = v_period and b.status <> 'rejected';

  select coalesce(sum(ba.allocated_amount), 0) into v_allocated
    from smartgov.budget_allocations ba where ba.period_id = v_period;

  select coalesce(sum(smartgov.budget_committed(v_period, gu.id, null)), 0) into v_committed
    from public.governance_units gu where gu.organization_id = v_account.organization_id;

  return jsonb_build_object(
    'ok', true,
    'units', coalesce((
      select jsonb_agg(jsonb_build_object(
        'unitId', u.unit_id,
        'unitName', u.unit_name,
        'allocated', u.allocated,
        'requested', u.requested,
        'approved', u.approved,
        'committed', smartgov.budget_committed(v_period, u.unit_id, null),
        'spent', u.spent,
        'remaining', u.allocated - smartgov.budget_committed(v_period, u.unit_id, null),
        'openCount', u.open_count
      ) order by u.requested desc)
        from (
          select gu.id as unit_id,
                 gu.name as unit_name,
                 coalesce(ba.allocated_amount, 0) as allocated,
                 coalesce(ur.requested, 0) as requested,
                 coalesce(ur.approved, 0) as approved,
                 coalesce(ur.spent, 0) as spent,
                 coalesce(ur.open_count, 0) as open_count
            from public.governance_units gu
            left join smartgov.budget_allocations ba on ba.period_id = v_period and ba.unit_id = gu.id
            left join (
              select b.unit_id,
                     sum(b.requested_total) as requested,
                     sum(coalesce(b.approved_total, 0)) as approved,
                     sum(coalesce(b.actual_spent, 0)) as spent,
                     count(*) filter (where b.status in ('under_review', 'returned')) as open_count
                from smartgov.budget_requests b
               where b.period_id = v_period and b.status <> 'rejected'
               group by b.unit_id
            ) ur on ur.unit_id = gu.id
           where gu.organization_id = v_account.organization_id
        ) u
    ), '[]'::jsonb),
    'totals', jsonb_build_object(
      'allocated', v_allocated,
      'requested', v_requested,
      'approved', v_approved,
      'committed', v_committed,
      'spent', v_spent,
      'remaining', v_allocated - v_committed
    )
  );
end;
$$;

create or replace function smartgov.record_budget_spend_total(
  p_session_token text,
  p_budget_id uuid,
  p_actual_spent numeric,
  p_description text,
  p_receipt_file text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_budget smartgov.budget_requests%rowtype;
  v_spent numeric;
  v_difference numeric;
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then return jsonb_build_object('ok', false, 'reason', 'unauthenticated'); end if;

  select b.* into v_budget
    from smartgov.budget_requests b
   where b.id = p_budget_id and b.organization_id = v_account.organization_id;
  if v_budget.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if not smartgov.budget_is_usg(v_account)
     and not (v_budget.unit_id = any (select smartgov.lsg_unit_ids(v_account.id, v_account.organization_id))) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if v_budget.status <> 'approved' then return jsonb_build_object('ok', false, 'reason', 'invalid_status'); end if;
  if p_actual_spent is null or p_actual_spent < 0 or p_actual_spent > v_budget.approved_total then
    return jsonb_build_object('ok', false, 'reason', 'spending_exceeded');
  end if;

  v_spent := smartgov.budget_expense_total(p_budget_id);
  if p_actual_spent < v_spent then return jsonb_build_object('ok', false, 'reason', 'spending_exceeded'); end if;
  v_difference := p_actual_spent - v_spent;

  if v_difference > 0 then
    insert into smartgov.budget_expenses (organization_id, unit_id, request_id, amount, description, receipt_file, recorded_by)
    values (v_account.organization_id, v_budget.unit_id, p_budget_id, v_difference,
            coalesce(v_description, 'Recorded spending'), nullif(btrim(coalesce(p_receipt_file, '')), ''), v_account.id);
  end if;

  update smartgov.budget_requests set actual_spent = p_actual_spent where id = p_budget_id;

  perform smartgov.budget_audit(v_account, 'budget_request.spending_recorded', 'budget_request', p_budget_id,
    jsonb_build_object('unitId', v_budget.unit_id, 'actualSpent', p_actual_spent, 'receiptFile', p_receipt_file));

  return jsonb_build_object(
    'ok', true,
    'budgetId', p_budget_id,
    'actualSpent', p_actual_spent,
    'remaining', v_budget.approved_total - p_actual_spent
  );
end;
$$;

create or replace function public.record_budget_spend_total(
  p_session_token text, p_budget_id uuid, p_actual_spent numeric, p_description text, p_receipt_file text
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.record_budget_spend_total($1, $2, $3, $4, $5); $$;

revoke all on function public.record_budget_spend_total(text, uuid, numeric, text, text) from public;
grant execute on function public.record_budget_spend_total(text, uuid, numeric, text, text) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
