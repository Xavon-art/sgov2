create or replace function smartgov.budget_number_text(p_value text)
returns numeric
language sql immutable
as $$ select case when btrim(coalesce(p_value, '')) ~ '^-?[0-9]+([.][0-9]+)?$' then btrim(p_value)::numeric else null end; $$;

create or replace function smartgov.budget_is_usg(p_account smartgov.accounts)
returns boolean
language sql stable
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.is_usg(p_account.id, p_account.organization_id); $$;

create or replace function smartgov.budget_default_period_id(p_organization uuid)
returns uuid
language sql stable
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
  select bp.id from smartgov.budget_periods bp
   where bp.organization_id = p_organization
   order by case when bp.status = 'open' then 0 else 1 end, bp.starts_on desc, bp.created_at desc
   limit 1;
$$;

create or replace function smartgov.budget_committed(
  p_period_id uuid,
  p_unit_id uuid,
  p_exclude_request_id uuid default null
)
returns numeric
language sql stable
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
  select coalesce(sum(case when b.status = 'approved' then coalesce(b.approved_total, 0) else b.requested_total end), 0)
    from smartgov.budget_requests b
   where b.period_id = p_period_id
     and b.unit_id = p_unit_id
     and b.status in ('pending', 'draft', 'under_review', 'returned', 'approved')
     and b.id <> coalesce(p_exclude_request_id, '00000000-0000-0000-0000-000000000000'::uuid);
$$;

create or replace function smartgov.budget_expense_total(p_request_id uuid)
returns numeric
language sql stable
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
  select coalesce(sum(be.amount), 0) from smartgov.budget_expenses be where be.request_id = p_request_id;
$$;

create or replace function smartgov.budget_audit(
  p_account smartgov.accounts,
  p_action text,
  p_target_type text,
  p_target_id uuid,
  p_detail jsonb
)
returns void
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
begin
  insert into smartgov.audit_log (organization_id, actor_id, action, target_type, target_id, detail)
  values (p_account.organization_id, p_account.id, p_action, p_target_type, p_target_id, coalesce(p_detail, '{}'::jsonb));
end;
$$;

create or replace function smartgov.budget_notify_unit(
  p_organization uuid,
  p_unit_id uuid,
  p_kind text,
  p_title text,
  p_body text,
  p_link text
)
returns void
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
begin
  insert into smartgov.notifications (account_id, organization_id, kind, title, body, link)
  select distinct a.id, p_organization, p_kind, p_title, p_body, p_link
    from smartgov.unit_memberships m
    join smartgov.roster r on r.id = m.roster_id and r.account_id is not null
    join smartgov.accounts a on a.id = r.account_id
   where m.unit_id = p_unit_id
     and (m.end_date is null or m.end_date >= current_date)
     and a.status = 'active';
end;
$$;

create or replace function smartgov.list_budget_periods(p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then return jsonb_build_object('ok', false, 'reason', 'unauthenticated'); end if;

  return jsonb_build_object(
    'ok', true,
    'periods', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', bp.id,
        'label', bp.label,
        'startsOn', bp.starts_on,
        'endsOn', bp.ends_on,
        'status', bp.status,
        'isDefault', bp.id = smartgov.budget_default_period_id(v_account.organization_id)
      ) order by bp.starts_on desc)
        from smartgov.budget_periods bp
       where bp.organization_id = v_account.organization_id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function smartgov.set_budget_allocation(
  p_session_token text,
  p_period_id uuid,
  p_unit_id uuid,
  p_amount numeric,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_period smartgov.budget_periods%rowtype;
  v_unit public.governance_units%rowtype;
  v_note text := btrim(coalesce(p_note, ''));
  v_previous numeric(14,2);
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then return jsonb_build_object('ok', false, 'reason', 'unauthenticated'); end if;
  if not smartgov.budget_is_usg(v_account) then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if p_amount is null or p_amount < 0 then return jsonb_build_object('ok', false, 'reason', 'invalid_amount'); end if;
  if length(v_note) < 2 then return jsonb_build_object('ok', false, 'reason', 'remark_required'); end if;

  select bp.* into v_period from smartgov.budget_periods bp where bp.id = p_period_id and bp.organization_id = v_account.organization_id;
  if v_period.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;

  select gu.* into v_unit from public.governance_units gu where gu.id = p_unit_id and gu.organization_id = v_account.organization_id;
  if v_unit.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;

  select ba.allocated_amount into v_previous from smartgov.budget_allocations ba where ba.period_id = p_period_id and ba.unit_id = p_unit_id;

  insert into smartgov.budget_allocations (period_id, unit_id, allocated_amount, set_by, set_at, note)
  values (p_period_id, p_unit_id, p_amount, v_account.id, now(), v_note)
  on conflict (period_id, unit_id)
  do update set allocated_amount = excluded.allocated_amount,
                set_by = excluded.set_by,
                set_at = excluded.set_at,
                note = excluded.note;

  perform smartgov.budget_audit(
    v_account,
    case when v_previous is null then 'budget_allocation.set' else 'budget_allocation.adjusted' end,
    'governance_unit',
    p_unit_id,
    jsonb_build_object('periodId', p_period_id, 'previousAmount', v_previous, 'allocatedAmount', p_amount, 'remark', v_note)
  );

  return jsonb_build_object('ok', true, 'allocatedAmount', p_amount, 'previousAmount', v_previous);
end;
$$;

create or replace function smartgov.bulk_set_budget_allocations(
  p_session_token text,
  p_period_id uuid,
  p_items jsonb,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_note text := btrim(coalesce(p_note, ''));
  v_item jsonb;
  v_unit_id uuid;
  v_amount numeric;
  v_rows integer := 0;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then return jsonb_build_object('ok', false, 'reason', 'unauthenticated'); end if;
  if not smartgov.budget_is_usg(v_account) then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if length(v_note) < 2 then return jsonb_build_object('ok', false, 'reason', 'remark_required'); end if;
  if not exists (select 1 from smartgov.budget_periods bp where bp.id = p_period_id and bp.organization_id = v_account.organization_id) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if coalesce(jsonb_typeof(p_items), '') <> 'array' then return jsonb_build_object('ok', false, 'reason', 'invalid_items'); end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_unit_id := nullif(v_item ->> 'unitId', '')::uuid;
    v_amount := case
      when jsonb_typeof(v_item -> 'amount') = 'number' then (v_item ->> 'amount')::numeric
      else smartgov.budget_number_text(v_item ->> 'amount')
    end;
    if v_unit_id is null or v_amount is null or v_amount < 0
       or not exists (select 1 from public.governance_units gu where gu.id = v_unit_id and gu.organization_id = v_account.organization_id) then
      return jsonb_build_object('ok', false, 'reason', 'invalid_items');
    end if;
    v_rows := v_rows + 1;
  end loop;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    perform smartgov.set_budget_allocation(
      p_session_token,
      p_period_id,
      nullif(v_item ->> 'unitId', '')::uuid,
      case when jsonb_typeof(v_item -> 'amount') = 'number' then (v_item ->> 'amount')::numeric else smartgov.budget_number_text(v_item ->> 'amount') end,
      v_note
    );
  end loop;

  return jsonb_build_object('ok', true, 'updated', v_rows);
end;
$$;

create or replace function smartgov.review_budget(
  p_session_token text,
  p_budget_id uuid,
  p_decision text,
  p_approved_total numeric,
  p_remark text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_budget smartgov.budget_requests%rowtype;
  v_decision text := lower(btrim(coalesce(p_decision, '')));
  v_remark text := btrim(coalesce(p_remark, ''));
  v_amount numeric;
  v_allocated numeric;
  v_committed numeric;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then return jsonb_build_object('ok', false, 'reason', 'unauthenticated'); end if;
  if not smartgov.budget_is_usg(v_account) then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if v_decision = 'declined' then v_decision := 'rejected'; end if;
  if v_decision not in ('approved', 'returned', 'rejected') then return jsonb_build_object('ok', false, 'reason', 'invalid_request'); end if;
  if v_decision in ('returned', 'rejected') and length(v_remark) < 2 then
    return jsonb_build_object('ok', false, 'reason', 'remark_required');
  end if;

  select b.* into v_budget
    from smartgov.budget_requests b
   where b.id = p_budget_id and b.organization_id = v_account.organization_id;
  if v_budget.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_budget.status not in ('under_review', 'returned') then
    return jsonb_build_object('ok', false, 'reason', 'already_decided');
  end if;

  if v_decision = 'approved' then
    v_amount := coalesce(p_approved_total, v_budget.requested_total);
    if v_amount < 0 or v_amount > v_budget.requested_total then
      return jsonb_build_object('ok', false, 'reason', 'invalid_amount');
    end if;
    v_allocated := coalesce((select ba.allocated_amount from smartgov.budget_allocations ba where ba.period_id = v_budget.period_id and ba.unit_id = v_budget.unit_id), 0);
    v_committed := smartgov.budget_committed(v_budget.period_id, v_budget.unit_id, v_budget.id);
    if v_amount > v_allocated - v_committed then
      return jsonb_build_object('ok', false, 'reason', 'allocation_exceeded');
    end if;
  else
    v_amount := null;
  end if;

  update smartgov.budget_requests
     set status = v_decision,
         approved_total = v_amount,
         decision_remark = nullif(v_remark, ''),
         decided_by = v_account.id,
         decided_at = now(),
         actual_spent = case when v_decision = 'approved' then 0 else actual_spent end
   where id = v_budget.id;

  perform smartgov.budget_audit(
    v_account,
    'budget_request.reviewed',
    'budget_request',
    v_budget.id,
    jsonb_build_object('unitId', v_budget.unit_id, 'periodId', v_budget.period_id, 'decision', v_decision, 'approvedTotal', v_amount, 'remark', v_remark)
  );

  perform smartgov.budget_notify_unit(
    v_account.organization_id,
    v_budget.unit_id,
    'budget_' || v_decision,
    'Budget ' || v_decision,
    v_budget.title || ' was ' || v_decision || '.' || case when v_remark = '' then '' else ' Remark: ' || v_remark end,
    '/lsg/budget'
  );

  return jsonb_build_object(
    'ok', true,
    'id', v_budget.id,
    'status', v_decision,
    'approvedTotal', v_amount,
    'requestedTotal', v_budget.requested_total
  );
end;
$$;

create or replace function smartgov.list_budget_units(
  p_session_token text,
  p_period_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_period uuid;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then return jsonb_build_object('ok', false, 'reason', 'unauthenticated'); end if;
  if not smartgov.budget_is_usg(v_account) then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  v_period := coalesce(p_period_id, smartgov.budget_default_period_id(v_account.organization_id));
  if not exists (select 1 from smartgov.budget_periods bp where bp.id = v_period and bp.organization_id = v_account.organization_id) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  return jsonb_build_object(
    'ok', true,
    'periodId', v_period,
    'units', coalesce((
      select jsonb_agg(jsonb_build_object(
        'unitId', gu.id,
        'unitName', gu.name,
        'unitType', gu.unit_type::text,
        'campusName', parent.name,
        'allocated', coalesce(ba.allocated_amount, 0),
        'requested', coalesce(ur.requested, 0),
        'approved', coalesce(ur.approved, 0),
        'committed', smartgov.budget_committed(v_period, gu.id, null),
        'spent', coalesce(ur.spent, 0),
        'remainingAllocation', coalesce(ba.allocated_amount, 0) - smartgov.budget_committed(v_period, gu.id, null),
        'remainingApproved', coalesce(ur.approved, 0) - coalesce(ur.spent, 0)
      ) order by parent.name nulls last, gu.name)
        from public.governance_units gu
        left join public.governance_units parent on parent.id = gu.parent_id
        left join smartgov.budget_allocations ba on ba.period_id = v_period and ba.unit_id = gu.id
        left join (
          select b.unit_id,
                 sum(b.requested_total) as requested,
                 sum(coalesce(b.approved_total, 0)) as approved,
                 sum(coalesce(b.actual_spent, 0)) as spent
            from smartgov.budget_requests b
           where b.period_id = v_period and b.status <> 'rejected'
           group by b.unit_id
        ) ur on ur.unit_id = gu.id
       where gu.organization_id = v_account.organization_id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function smartgov.list_budget_requests_filtered(
  p_session_token text,
  p_period_id uuid,
  p_campus text,
  p_unit_type text,
  p_unit_id uuid,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_period uuid;
  v_campus text := nullif(btrim(coalesce(p_campus, '')), '');
  v_type text := nullif(btrim(coalesce(p_unit_type, '')), '');
  v_status text := nullif(btrim(coalesce(p_status, '')), '');
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then return jsonb_build_object('ok', false, 'reason', 'unauthenticated'); end if;
  if not smartgov.budget_is_usg(v_account) then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  v_period := coalesce(p_period_id, smartgov.budget_default_period_id(v_account.organization_id));
  if not exists (select 1 from smartgov.budget_periods bp where bp.id = v_period and bp.organization_id = v_account.organization_id) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  return jsonb_build_object(
    'ok', true,
    'periodId', v_period,
    'budgets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id,
        'unitId', b.unit_id,
        'unitName', gu.name,
        'unitType', gu.unit_type::text,
        'campusName', parent.name,
        'periodLabel', bp.label,
        'title', b.title,
        'status', b.status,
        'requestedTotal', b.requested_total,
        'approvedTotal', b.approved_total,
        'spent', smartgov.budget_expense_total(b.id),
        'decisionRemark', b.decision_remark,
        'createdAt', b.created_at
      ) order by b.created_at desc)
        from smartgov.budget_requests b
        join public.governance_units gu on gu.id = b.unit_id
        left join public.governance_units parent on parent.id = gu.parent_id
        join smartgov.budget_periods bp on bp.id = b.period_id
       where b.organization_id = v_account.organization_id
         and b.period_id = v_period
         and (p_unit_id is null or b.unit_id = p_unit_id)
         and (v_status is null or v_status = 'all' or b.status = v_status)
         and (v_type is null or gu.unit_type::text = v_type)
         and (v_campus is null or gu.name ilike '%' || v_campus || '%' or parent.name ilike '%' || v_campus || '%')
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function smartgov.budget_export_data(
  p_session_token text,
  p_period_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_period uuid;
  v_row record;
  v_csv text := 'id,period,unit,status,requested,approved,spent,created_at' || chr(10);
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then return jsonb_build_object('ok', false, 'reason', 'unauthenticated'); end if;
  if not smartgov.budget_is_usg(v_account) then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  v_period := coalesce(p_period_id, smartgov.budget_default_period_id(v_account.organization_id));
  if not exists (select 1 from smartgov.budget_periods bp where bp.id = v_period and bp.organization_id = v_account.organization_id) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  for v_row in
    select b.id, bp.label as period, gu.name as unit, b.status, b.requested_total,
           coalesce(b.approved_total, 0) as approved, smartgov.budget_expense_total(b.id) as spent, b.created_at
      from smartgov.budget_requests b
      join smartgov.budget_periods bp on bp.id = b.period_id
      join public.governance_units gu on gu.id = b.unit_id
     where b.organization_id = v_account.organization_id and b.period_id = v_period
     order by b.created_at desc
  loop
    v_csv := v_csv || v_row.id::text || ','
      || '"' || replace(v_row.period, '"', '""') || '",'
      || '"' || replace(v_row.unit, '"', '""') || '",'
      || v_row.status || ','
      || v_row.requested_total::text || ','
      || v_row.approved::text || ','
      || v_row.spent::text || ','
      || v_row.created_at::text || chr(10);
  end loop;

  return jsonb_build_object('ok', true, 'periodId', v_period, 'csv', v_csv);
end;
$$;

create or replace function smartgov.list_usg_expenses(
  p_session_token text,
  p_period_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_period uuid;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then return jsonb_build_object('ok', false, 'reason', 'unauthenticated'); end if;
  if not smartgov.budget_is_usg(v_account) then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  v_period := coalesce(p_period_id, smartgov.budget_default_period_id(v_account.organization_id));
  if not exists (select 1 from smartgov.budget_periods bp where bp.id = v_period and bp.organization_id = v_account.organization_id) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  return jsonb_build_object(
    'ok', true,
    'expenses', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ue.id,
        'periodId', ue.period_id,
        'amount', ue.amount,
        'description', ue.description,
        'receiptFile', ue.receipt_file,
        'recordedBy', (select a.display_name from smartgov.accounts a where a.id = ue.recorded_by),
        'recordedAt', ue.recorded_at
      ) order by ue.recorded_at desc)
        from smartgov.usg_expenses ue
       where ue.organization_id = v_account.organization_id and ue.period_id = v_period
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function smartgov.create_usg_expense(
  p_session_token text,
  p_period_id uuid,
  p_amount numeric,
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
  v_id uuid;
  v_description text := btrim(coalesce(p_description, ''));
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then return jsonb_build_object('ok', false, 'reason', 'unauthenticated'); end if;
  if not smartgov.budget_is_usg(v_account) then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if p_amount is null or p_amount <= 0 then return jsonb_build_object('ok', false, 'reason', 'invalid_amount'); end if;
  if length(v_description) < 1 or length(v_description) > 240 then return jsonb_build_object('ok', false, 'reason', 'invalid_request'); end if;
  if not exists (select 1 from smartgov.budget_periods bp where bp.id = p_period_id and bp.organization_id = v_account.organization_id) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  insert into smartgov.usg_expenses (organization_id, period_id, amount, description, receipt_file, recorded_by)
  values (v_account.organization_id, p_period_id, p_amount, v_description, nullif(btrim(coalesce(p_receipt_file, '')), ''), v_account.id)
  returning id into v_id;

  perform smartgov.budget_audit(v_account, 'usg_expense.created', 'usg_expense', v_id,
    jsonb_build_object('periodId', p_period_id, 'amount', p_amount, 'description', v_description));

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

create or replace function smartgov.update_usg_expense(
  p_session_token text,
  p_expense_id uuid,
  p_amount numeric,
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
  v_description text := btrim(coalesce(p_description, ''));
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then return jsonb_build_object('ok', false, 'reason', 'unauthenticated'); end if;
  if not smartgov.budget_is_usg(v_account) then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if p_amount is null or p_amount <= 0 then return jsonb_build_object('ok', false, 'reason', 'invalid_amount'); end if;
  if length(v_description) < 1 or length(v_description) > 240 then return jsonb_build_object('ok', false, 'reason', 'invalid_request'); end if;
  if not exists (select 1 from smartgov.usg_expenses ue where ue.id = p_expense_id and ue.organization_id = v_account.organization_id) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  update smartgov.usg_expenses
     set amount = p_amount,
         description = v_description,
         receipt_file = nullif(btrim(coalesce(p_receipt_file, '')), '')
   where id = p_expense_id;

  perform smartgov.budget_audit(v_account, 'usg_expense.updated', 'usg_expense', p_expense_id,
    jsonb_build_object('amount', p_amount, 'description', v_description));

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function smartgov.delete_usg_expense(
  p_session_token text,
  p_expense_id uuid
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
  if v_account.id is null then return jsonb_build_object('ok', false, 'reason', 'unauthenticated'); end if;
  if not smartgov.budget_is_usg(v_account) then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if not exists (select 1 from smartgov.usg_expenses ue where ue.id = p_expense_id and ue.organization_id = v_account.organization_id) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  delete from smartgov.usg_expenses where id = p_expense_id;
  perform smartgov.budget_audit(v_account, 'usg_expense.deleted', 'usg_expense', p_expense_id, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function smartgov.get_unit_budget_overview(
  p_session_token text,
  p_unit_id uuid,
  p_period_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_unit uuid;
  v_period uuid;
  v_allocated numeric;
  v_requested numeric;
  v_approved numeric;
  v_spent numeric;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then return jsonb_build_object('ok', false, 'reason', 'unauthenticated'); end if;

  if p_unit_id is not null then
    if not (p_unit_id = any (select smartgov.lsg_unit_ids(v_account.id, v_account.organization_id))) then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
    v_unit := p_unit_id;
  else
    select u into v_unit from smartgov.lsg_unit_ids(v_account.id, v_account.organization_id) u order by u limit 1;
  end if;
  if v_unit is null then return jsonb_build_object('ok', false, 'reason', 'no_unit'); end if;
  if not exists (select 1 from public.governance_units gu where gu.id = v_unit and gu.organization_id = v_account.organization_id) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  v_period := coalesce(p_period_id, smartgov.budget_default_period_id(v_account.organization_id));
  if not exists (select 1 from smartgov.budget_periods bp where bp.id = v_period and bp.organization_id = v_account.organization_id) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  v_allocated := coalesce((select ba.allocated_amount from smartgov.budget_allocations ba where ba.period_id = v_period and ba.unit_id = v_unit), 0);
  select coalesce(sum(b.requested_total), 0), coalesce(sum(coalesce(b.approved_total, 0)), 0), coalesce(sum(coalesce(b.actual_spent, 0)), 0)
    into v_requested, v_approved, v_spent
    from smartgov.budget_requests b
   where b.period_id = v_period and b.unit_id = v_unit and b.status <> 'rejected';

  return jsonb_build_object(
    'ok', true,
    'unitId', v_unit,
    'periodId', v_period,
    'allocated', v_allocated,
    'requested', v_requested,
    'approved', v_approved,
    'spent', v_spent,
    'committed', smartgov.budget_committed(v_period, v_unit, null),
    'remainingAllocation', v_allocated - smartgov.budget_committed(v_period, v_unit, null),
    'remainingApproved', v_approved - v_spent,
    'requestCount', (select count(*) from smartgov.budget_requests b where b.period_id = v_period and b.unit_id = v_unit and b.status <> 'rejected')
  );
end;
$$;

create or replace function smartgov.submit_unit_budget_request(
  p_session_token text,
  p_unit_id uuid,
  p_period_id uuid,
  p_title text,
  p_justification text,
  p_items jsonb,
  p_event_id uuid default null,
  p_proposal_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_unit uuid;
  v_period uuid;
  v_title text := btrim(coalesce(p_title, ''));
  v_budget uuid;
  v_total numeric;
  v_allocated numeric;
  v_committed numeric;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then return jsonb_build_object('ok', false, 'reason', 'unauthenticated'); end if;
  if smartgov.budget_is_usg(v_account) then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if length(v_title) < 4 or length(v_title) > 140 then return jsonb_build_object('ok', false, 'reason', 'invalid_title'); end if;
  if p_event_id is not null and p_proposal_id is not null then return jsonb_build_object('ok', false, 'reason', 'invalid_request'); end if;

  if p_unit_id is not null then
    if not (p_unit_id = any (select smartgov.lsg_unit_ids(v_account.id, v_account.organization_id))) then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
    v_unit := p_unit_id;
  elsif p_event_id is not null then
    select e.unit_id into v_unit
      from smartgov.events e
     where e.id = p_event_id and e.organization_id = v_account.organization_id;
  else
    select u into v_unit from smartgov.lsg_unit_ids(v_account.id, v_account.organization_id) u order by u limit 1;
  end if;
  if v_unit is null then return jsonb_build_object('ok', false, 'reason', 'no_unit'); end if;

  if not exists (select 1 from public.governance_units gu where gu.id = v_unit and gu.organization_id = v_account.organization_id) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if p_event_id is not null then
    if not exists (select 1 from smartgov.events e where e.id = p_event_id and e.organization_id = v_account.organization_id and e.unit_id = v_unit) then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
  end if;
  if p_proposal_id is not null then
    if not exists (select 1 from smartgov.proposals pr where pr.id = p_proposal_id and pr.organization_id = v_account.organization_id and pr.unit_id = v_unit and pr.status in ('submitted', 'returned')) then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
  end if;

  v_period := coalesce(p_period_id, smartgov.budget_default_period_id(v_account.organization_id));
  if not exists (select 1 from smartgov.budget_periods bp where bp.id = v_period and bp.organization_id = v_account.organization_id) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if not exists (select 1 from smartgov.budget_periods bp where bp.id = v_period and bp.status = 'open') then
    return jsonb_build_object('ok', false, 'reason', 'period_closed');
  end if;

  v_allocated := coalesce((select ba.allocated_amount from smartgov.budget_allocations ba where ba.period_id = v_period and ba.unit_id = v_unit), 0);
  v_committed := smartgov.budget_committed(v_period, v_unit, null);

  insert into smartgov.budget_requests (
    organization_id, proposal_id, event_id, unit_id, period_id, requested_by, title, justification, status
  )
  values (
    v_account.organization_id, p_proposal_id, p_event_id, v_unit, v_period, v_account.id, v_title,
    btrim(coalesce(p_justification, '')), 'under_review'
  )
  returning id into v_budget;

  v_total := smartgov.budget_write_items(v_budget, p_items);
  if v_total is null or v_total <= 0 then
    delete from smartgov.budget_requests where id = v_budget;
    return jsonb_build_object('ok', false, 'reason', 'invalid_items');
  end if;
  if v_total > v_allocated - v_committed then
    delete from smartgov.budget_requests where id = v_budget;
    return jsonb_build_object('ok', false, 'reason', 'allocation_exceeded');
  end if;

  update smartgov.budget_requests set requested_total = v_total where id = v_budget;

  perform smartgov.budget_audit(v_account, 'budget_request.submitted', 'budget_request', v_budget,
    jsonb_build_object('unitId', v_unit, 'periodId', v_period, 'requestedTotal', v_total));

  insert into smartgov.notifications (account_id, organization_id, kind, title, body, link)
  select a.id, v_account.organization_id, 'budget_submitted', 'Budget request submitted',
         v_title || ' needs review from ' || (select gu.name from public.governance_units gu where gu.id = v_unit) || '.',
         '/usg/budget'
    from smartgov.accounts a
   where a.organization_id = v_account.organization_id
     and a.status = 'active'
     and smartgov.is_usg(a.id, a.organization_id);

  return jsonb_build_object(
    'ok', true,
    'budgetId', v_budget,
    'requestedTotal', v_total,
    'unitId', v_unit,
    'periodId', v_period
  );
end;
$$;

create or replace function smartgov.record_unit_budget_expense(
  p_session_token text,
  p_unit_id uuid,
  p_request_id uuid,
  p_amount numeric,
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
  v_request smartgov.budget_requests%rowtype;
  v_description text := btrim(coalesce(p_description, ''));
  v_spent numeric;
  v_id uuid;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then return jsonb_build_object('ok', false, 'reason', 'unauthenticated'); end if;
  if p_unit_id is null then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if not (p_unit_id = any (select smartgov.lsg_unit_ids(v_account.id, v_account.organization_id))) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if p_amount is null or p_amount <= 0 then return jsonb_build_object('ok', false, 'reason', 'invalid_amount'); end if;
  if length(v_description) < 1 or length(v_description) > 240 then return jsonb_build_object('ok', false, 'reason', 'invalid_request'); end if;

  select b.* into v_request
    from smartgov.budget_requests b
   where b.id = p_request_id and b.unit_id = p_unit_id and b.organization_id = v_account.organization_id;
  if v_request.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_request.status <> 'approved' then return jsonb_build_object('ok', false, 'reason', 'invalid_status'); end if;

  v_spent := smartgov.budget_expense_total(p_request_id);
  if p_amount > coalesce(v_request.approved_total, 0) - v_spent then
    return jsonb_build_object('ok', false, 'reason', 'spending_exceeded');
  end if;

  insert into smartgov.budget_expenses (organization_id, unit_id, request_id, amount, description, receipt_file, recorded_by)
  values (v_account.organization_id, p_unit_id, p_request_id, p_amount, v_description, nullif(btrim(coalesce(p_receipt_file, '')), ''), v_account.id)
  returning id into v_id;

  update smartgov.budget_requests set actual_spent = v_spent + p_amount where id = p_request_id;

  perform smartgov.budget_audit(v_account, 'budget_expense.recorded', 'budget_request', p_request_id,
    jsonb_build_object('unitId', p_unit_id, 'amount', p_amount, 'description', v_description, 'receiptFile', p_receipt_file));

  return jsonb_build_object('ok', true, 'id', v_id, 'actualSpent', v_spent + p_amount,
                            'remaining', v_request.approved_total - v_spent - p_amount);
end;
$$;

create or replace function smartgov.record_budget_expense_by_request(
  p_session_token text,
  p_request_id uuid,
  p_amount numeric,
  p_description text,
  p_receipt_file text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_unit uuid;
begin
  select unit_id into v_unit from smartgov.budget_requests where id = p_request_id;
  if v_unit is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  return smartgov.record_unit_budget_expense(p_session_token, v_unit, p_request_id, p_amount, p_description, p_receipt_file);
end;
$$;

create or replace function smartgov.list_unit_budget_expenses(
  p_session_token text,
  p_unit_id uuid,
  p_period_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_unit uuid;
  v_period uuid;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then return jsonb_build_object('ok', false, 'reason', 'unauthenticated'); end if;

  if p_unit_id is not null then
    if not (p_unit_id = any (select smartgov.lsg_unit_ids(v_account.id, v_account.organization_id))) then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
    v_unit := p_unit_id;
  else
    select u into v_unit from smartgov.lsg_unit_ids(v_account.id, v_account.organization_id) u order by u limit 1;
  end if;
  if v_unit is null then return jsonb_build_object('ok', false, 'reason', 'no_unit'); end if;

  v_period := coalesce(p_period_id, smartgov.budget_default_period_id(v_account.organization_id));

  return jsonb_build_object(
    'ok', true,
    'expenses', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', be.id,
        'requestId', be.request_id,
        'amount', be.amount,
        'description', be.description,
        'receiptFile', be.receipt_file,
        'recordedBy', (select a.display_name from smartgov.accounts a where a.id = be.recorded_by),
        'recordedAt', be.recorded_at
      ) order by be.recorded_at desc)
         from smartgov.budget_expenses be
         join smartgov.budget_requests br on br.id = be.request_id
        where be.unit_id = v_unit
          and be.organization_id = v_account.organization_id
          and br.period_id = v_period

    ), '[]'::jsonb)
  );
end;
$$;

create or replace function smartgov.list_unit_budget_requests(
  p_session_token text,
  p_unit_id uuid,
  p_period_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_unit uuid;
  v_period uuid;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then return jsonb_build_object('ok', false, 'reason', 'unauthenticated'); end if;

  if p_unit_id is not null then
    if not (p_unit_id = any (select smartgov.lsg_unit_ids(v_account.id, v_account.organization_id))) then
      return jsonb_build_object('ok', false, 'reason', 'forbidden');
    end if;
    v_unit := p_unit_id;
  else
    select u into v_unit from smartgov.lsg_unit_ids(v_account.id, v_account.organization_id) u order by u limit 1;
  end if;
  if v_unit is null then return jsonb_build_object('ok', false, 'reason', 'no_unit'); end if;

  v_period := coalesce(p_period_id, smartgov.budget_default_period_id(v_account.organization_id));

  return jsonb_build_object(
    'ok', true,
    'budgets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id,
        'title', b.title,
        'status', b.status,
        'requestedTotal', b.requested_total,
        'approvedTotal', b.approved_total,
        'spent', smartgov.budget_expense_total(b.id),
        'decisionRemark', b.decision_remark,
        'createdAt', b.created_at
      ) order by b.created_at desc)
         from smartgov.budget_requests b
        where b.unit_id = v_unit and b.period_id = v_period and b.organization_id = v_account.organization_id

    ), '[]'::jsonb)
  );
end;
$$;

create or replace function smartgov.budget_parent_rollup(
  p_session_token text,
  p_unit_id uuid,
  p_period_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_period uuid;
  v_can boolean;
  v_unit public.governance_units%rowtype;
begin
  v_account := smartgov.authenticate(p_session_token);
  if v_account.id is null then return jsonb_build_object('ok', false, 'reason', 'unauthenticated'); end if;

  select gu.* into v_unit from public.governance_units gu where gu.id = p_unit_id and gu.organization_id = v_account.organization_id;
  if v_unit.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  v_can := smartgov.budget_is_usg(v_account) or (p_unit_id = any (select smartgov.lsg_unit_ids(v_account.id, v_account.organization_id)));
  if not v_can then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  v_period := coalesce(p_period_id, smartgov.budget_default_period_id(v_account.organization_id));
  if not exists (select 1 from smartgov.budget_periods bp where bp.id = v_period and bp.organization_id = v_account.organization_id) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  return jsonb_build_object(
    'ok', true,
    'unitId', p_unit_id,
    'unitName', v_unit.name,
    'periodId', v_period,
    'rollupOnly', true,
    'children', coalesce((
      with recursive tree as (
        select gu.id from public.governance_units gu where gu.id = p_unit_id
        union
        select gu.id from public.governance_units gu join tree t on gu.parent_id = t.id
      )
      select jsonb_agg(jsonb_build_object(
        'unitId', gu.id,
        'unitName', gu.name,
        'unitType', gu.unit_type::text,
        'allocated', coalesce(ba.allocated_amount, 0),
        'approved', coalesce(ur.approved, 0),
        'spent', coalesce(ur.spent, 0),
        'remainingAllocation', coalesce(ba.allocated_amount, 0) - smartgov.budget_committed(v_period, gu.id, null)
      ) order by gu.name)
        from tree t
        join public.governance_units gu on gu.id = t.id
        left join smartgov.budget_allocations ba on ba.period_id = v_period and ba.unit_id = gu.id
        left join (
          select b.unit_id, sum(coalesce(b.approved_total, 0)) as approved, sum(coalesce(b.actual_spent, 0)) as spent
            from smartgov.budget_requests b
           where b.period_id = v_period and b.status = 'approved'
           group by b.unit_id
        ) ur on ur.unit_id = gu.id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.list_budget_periods(p_session_token text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.list_budget_periods($1); $$;

create or replace function public.set_budget_allocation(
  p_session_token text, p_period_id uuid, p_unit_id uuid, p_amount numeric, p_note text
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.set_budget_allocation($1, $2, $3, $4, $5); $$;

create or replace function public.bulk_set_budget_allocations(
  p_session_token text, p_period_id uuid, p_items jsonb, p_note text
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.bulk_set_budget_allocations($1, $2, $3, $4); $$;

create or replace function public.list_budget_units(p_session_token text, p_period_id uuid)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.list_budget_units($1, $2); $$;

create or replace function public.list_budget_requests_filtered(
  p_session_token text, p_period_id uuid, p_campus text, p_unit_type text, p_unit_id uuid, p_status text
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.list_budget_requests_filtered($1, $2, $3, $4, $5, $6); $$;

create or replace function public.budget_export_data(p_session_token text, p_period_id uuid)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.budget_export_data($1, $2); $$;

create or replace function public.list_usg_expenses(p_session_token text, p_period_id uuid)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.list_usg_expenses($1, $2); $$;

create or replace function public.create_usg_expense(
  p_session_token text, p_period_id uuid, p_amount numeric, p_description text, p_receipt_file text
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.create_usg_expense($1, $2, $3, $4, $5); $$;

create or replace function public.update_usg_expense(
  p_session_token text, p_expense_id uuid, p_amount numeric, p_description text, p_receipt_file text
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.update_usg_expense($1, $2, $3, $4, $5); $$;

create or replace function public.delete_usg_expense(p_session_token text, p_expense_id uuid)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.delete_usg_expense($1, $2); $$;

create or replace function public.get_unit_budget_overview(
  p_session_token text, p_unit_id uuid, p_period_id uuid
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.get_unit_budget_overview($1, $2, $3); $$;

create or replace function public.submit_unit_budget_request(
  p_session_token text, p_unit_id uuid, p_period_id uuid, p_title text, p_justification text, p_items jsonb,
  p_event_id uuid default null, p_proposal_id uuid default null
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.submit_unit_budget_request($1, $2, $3, $4, $5, $6, $7, $8); $$;

create or replace function public.record_unit_budget_expense(
  p_session_token text, p_unit_id uuid, p_request_id uuid, p_amount numeric, p_description text, p_receipt_file text
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.record_unit_budget_expense($1, $2, $3, $4, $5, $6); $$;

create or replace function public.record_budget_expense_by_request(
  p_session_token text, p_request_id uuid, p_amount numeric, p_description text, p_receipt_file text
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.record_budget_expense_by_request($1, $2, $3, $4, $5); $$;

create or replace function public.list_unit_budget_expenses(
  p_session_token text, p_unit_id uuid, p_period_id uuid
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.list_unit_budget_expenses($1, $2, $3); $$;

create or replace function public.list_unit_budget_requests(
  p_session_token text, p_unit_id uuid, p_period_id uuid
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.list_unit_budget_requests($1, $2, $3); $$;

create or replace function public.budget_parent_rollup(
  p_session_token text, p_unit_id uuid, p_period_id uuid
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.budget_parent_rollup($1, $2, $3); $$;

revoke all on function public.list_budget_periods(text) from public;
revoke all on function public.set_budget_allocation(text, uuid, uuid, numeric, text) from public;
revoke all on function public.bulk_set_budget_allocations(text, uuid, jsonb, text) from public;
revoke all on function public.list_budget_units(text, uuid) from public;
revoke all on function public.list_budget_requests_filtered(text, uuid, text, text, uuid, text) from public;
revoke all on function public.budget_export_data(text, uuid) from public;
revoke all on function public.list_usg_expenses(text, uuid) from public;
revoke all on function public.create_usg_expense(text, uuid, numeric, text, text) from public;
revoke all on function public.update_usg_expense(text, uuid, numeric, text, text) from public;
revoke all on function public.delete_usg_expense(text, uuid) from public;
revoke all on function public.get_unit_budget_overview(text, uuid, uuid) from public;
revoke all on function public.submit_unit_budget_request(text, uuid, uuid, text, text, jsonb, uuid, uuid) from public;
revoke all on function public.record_unit_budget_expense(text, uuid, uuid, numeric, text, text) from public;
revoke all on function public.record_budget_expense_by_request(text, uuid, numeric, text, text) from public;
revoke all on function public.list_unit_budget_expenses(text, uuid, uuid) from public;
revoke all on function public.list_unit_budget_requests(text, uuid, uuid) from public;
revoke all on function public.budget_parent_rollup(text, uuid, uuid) from public;

grant execute on function public.list_budget_periods(text) to anon, authenticated, service_role;
grant execute on function public.set_budget_allocation(text, uuid, uuid, numeric, text) to anon, authenticated, service_role;
grant execute on function public.bulk_set_budget_allocations(text, uuid, jsonb, text) to anon, authenticated, service_role;
grant execute on function public.list_budget_units(text, uuid) to anon, authenticated, service_role;
grant execute on function public.list_budget_requests_filtered(text, uuid, text, text, uuid, text) to anon, authenticated, service_role;
grant execute on function public.budget_export_data(text, uuid) to anon, authenticated, service_role;
grant execute on function public.list_usg_expenses(text, uuid) to anon, authenticated, service_role;
grant execute on function public.create_usg_expense(text, uuid, numeric, text, text) to anon, authenticated, service_role;
grant execute on function public.update_usg_expense(text, uuid, numeric, text, text) to anon, authenticated, service_role;
grant execute on function public.delete_usg_expense(text, uuid) to anon, authenticated, service_role;
grant execute on function public.get_unit_budget_overview(text, uuid, uuid) to anon, authenticated, service_role;
grant execute on function public.submit_unit_budget_request(text, uuid, uuid, text, text, jsonb, uuid, uuid) to anon, authenticated, service_role;
grant execute on function public.record_unit_budget_expense(text, uuid, uuid, numeric, text, text) to anon, authenticated, service_role;
grant execute on function public.record_budget_expense_by_request(text, uuid, numeric, text, text) to anon, authenticated, service_role;
grant execute on function public.list_unit_budget_expenses(text, uuid, uuid) to anon, authenticated, service_role;
grant execute on function public.list_unit_budget_requests(text, uuid, uuid) to anon, authenticated, service_role;
grant execute on function public.budget_parent_rollup(text, uuid, uuid) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
