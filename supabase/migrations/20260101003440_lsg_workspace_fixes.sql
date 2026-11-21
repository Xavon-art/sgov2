create or replace function smartgov.gov_persist_holder_photo(
  p_organization uuid,
  p_holder       jsonb
)
returns void
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_email    text := lower(btrim(coalesce(p_holder->>'email', '')));
  v_photo    bytea;
  v_new_oid  oid;
  v_old_oid  oid;
  v_roster_id uuid;
begin
  if v_email = '' or coalesce(p_holder->>'photo', '') = '' then
    return;
  end if;

  begin
    v_photo := decode(p_holder->>'photo', 'base64');
  exception when others then
    return;
  end;

  if length(v_photo) = 0 or length(v_photo) > 524288 then
    return;
  end if;

  select id, photo_oid
    into v_roster_id, v_old_oid
    from smartgov.roster
   where organization_id = p_organization
     and lower(email) = v_email;

  if v_roster_id is null then
    return;
  end if;

  v_new_oid := lo_from_bytea(0, v_photo);

  if v_old_oid is not null and v_old_oid <> v_new_oid then
    begin
      perform lo_unlink(v_old_oid);
    exception when others then
      null;
    end;
  end if;

  update smartgov.roster
     set photo_oid   = v_new_oid,
         photo_mime  = 'image/jpeg',
         photo_bytes = length(v_photo)
   where id = v_roster_id;
end;
$$;

revoke all on function smartgov.gov_persist_holder_photo(uuid, jsonb) from public;

alter table smartgov.budget_requests
  add column if not exists actual_spent numeric(12,2);

do $$
begin
  alter table smartgov.budget_requests
    add constraint budget_requests_actual_spent_check
    check (actual_spent is null or actual_spent >= 0);
exception when duplicate_object then
  null;
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
           or (b.unit_id is not null and b.unit_id in (select smartgov.lsg_unit_ids(v_account.id, v_account.organization_id)))
         )
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function smartgov.list_budgets(text) from public;

create or replace function smartgov.budget_detail(
  p_session_token text,
  p_budget_id     uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_budget  smartgov.budget_requests%rowtype;
  v_is_usg  boolean;
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  select b.* into v_budget
    from smartgov.budget_requests b
   where b.id = p_budget_id
     and b.organization_id = v_account.organization_id;

  if v_budget.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  v_is_usg := v_account.account_scope = 'owner'
              or smartgov.is_org_reviewer(v_account.id, v_account.organization_id);

  if not (
    v_is_usg
    or v_budget.requested_by = v_account.id
    or (v_budget.unit_id is not null and v_budget.unit_id in (select smartgov.lsg_unit_ids(v_account.id, v_account.organization_id)))
  ) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  return jsonb_build_object(
    'ok', true,
    'id', v_budget.id,
    'proposalId', v_budget.proposal_id,
    'eventId', v_budget.event_id,
    'eventTitle', (select e.title from smartgov.events e where e.id = v_budget.event_id),
    'eventDate', (select e.event_date from smartgov.events e where e.id = v_budget.event_id),
    'title', v_budget.title,
    'justification', v_budget.justification,
    'status', v_budget.status,
    'unitId', v_budget.unit_id,
    'unitName', (select gu.name from public.governance_units gu where gu.id = v_budget.unit_id),
    'requestedTotal', v_budget.requested_total,
    'approvedTotal', v_budget.approved_total,
    'actualSpent', v_budget.actual_spent,
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

revoke all on function smartgov.budget_detail(text, uuid) from public;

create or replace function smartgov.set_budget_actual_spent(
  p_session_token text,
  p_budget_id     uuid,
  p_actual_spent  numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_account smartgov.accounts%rowtype;
  v_budget  smartgov.budget_requests%rowtype;
  v_is_usg  boolean;
begin
  v_account := smartgov.authenticate(p_session_token);

  if v_account.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  select b.* into v_budget
    from smartgov.budget_requests b
   where b.id = p_budget_id
     and b.organization_id = v_account.organization_id;

  if v_budget.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  v_is_usg := v_account.account_scope = 'owner'
              or smartgov.is_org_reviewer(v_account.id, v_account.organization_id);

  if not (
    v_is_usg
    or v_budget.requested_by = v_account.id
    or (v_budget.unit_id is not null and v_budget.unit_id in (select smartgov.lsg_unit_ids(v_account.id, v_account.organization_id)))
  ) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if v_budget.status <> 'approved' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_status');
  end if;

  if p_actual_spent is null or p_actual_spent < 0 or p_actual_spent > v_budget.approved_total then
    return jsonb_build_object('ok', false, 'reason', 'invalid_amount');
  end if;

  update smartgov.budget_requests
     set actual_spent = p_actual_spent
   where id = v_budget.id;

  return jsonb_build_object(
    'ok', true,
    'actualSpent', p_actual_spent,
    'remaining', v_budget.approved_total - p_actual_spent
  );
end;
$$;

revoke all on function smartgov.set_budget_actual_spent(text, uuid, numeric) from public;

create or replace function public.set_budget_actual_spent(
  p_session_token text,
  p_budget_id     uuid,
  p_actual_spent  numeric
)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.set_budget_actual_spent(p_session_token, p_budget_id, p_actual_spent); $$;

revoke all on function public.set_budget_actual_spent(text, uuid, numeric) from public;
grant execute on function public.set_budget_actual_spent(text, uuid, numeric) to anon, authenticated;

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
     and (b.unit_id is null or b.unit_id = any (v_unit_ids));

  select coalesce(
    sum(case when b.status = 'approved' then coalesce(b.approved_total, 0) - coalesce(b.actual_spent, 0) else b.requested_total - coalesce(b.approved_total, 0) end),
    0)
    into v_remaining
    from smartgov.budget_requests b
   where b.organization_id = v_account.organization_id
     and b.status in ('submitted', 'returned', 'approved')
     and (b.unit_id is null or b.unit_id = any (v_unit_ids));

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
         and (b.unit_id is null or b.unit_id = any (v_unit_ids))
       group by 1, 2
    ) p;

  return jsonb_build_object(
    'ok', true,
    'totalSpent', v_total_spent,
    'requestCount', (
      select count(*) from smartgov.budget_requests b
       where b.organization_id = v_account.organization_id
         and b.status <> 'rejected'
         and (b.unit_id is null or b.unit_id = any (v_unit_ids))
    ),
    'approvedCount', (
      select count(*) from smartgov.budget_requests b
       where b.organization_id = v_account.organization_id
         and b.status = 'approved'
         and (b.unit_id is null or b.unit_id = any (v_unit_ids))
    ),
    'remaining', v_remaining,
    'periods', v_periods
  );
end;
$$;

revoke all on function smartgov.lsg_budget_dashboard(text) from public;

create or replace function public.lsg_budget_dashboard(p_session_token text)
returns jsonb language sql security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.lsg_budget_dashboard(p_session_token); $$;

revoke all on function public.lsg_budget_dashboard(text) from public;
grant execute on function public.lsg_budget_dashboard(text) to anon, authenticated;

create or replace function smartgov.public_feedback_response_status(p_response_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, smartgov, pg_temp
as $$
declare
  v_status text;
  v_submitted_at timestamptz;
  v_acknowledged_at timestamptz;
begin
  select r.status, r.submitted_at, r.acknowledged_at
    into v_status, v_submitted_at, v_acknowledged_at
    from smartgov.feedback_responses r
   where r.id = p_response_id;

  if v_status is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  return jsonb_build_object(
    'ok', true,
    'status', v_status,
    'submittedAt', v_submitted_at,
    'acknowledgedAt', v_acknowledged_at
  );
end;
$$;

revoke all on function smartgov.public_feedback_response_status(uuid) from public;

create or replace function public.public_feedback_response_status(p_response_id uuid)
returns jsonb language sql stable security definer
set search_path = public, extensions, smartgov, pg_temp
as $$ select smartgov.public_feedback_response_status(p_response_id); $$;

revoke all on function public.public_feedback_response_status(uuid) from public;
grant execute on function public.public_feedback_response_status(uuid) to anon, authenticated;
